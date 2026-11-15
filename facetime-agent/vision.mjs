// Lets the model see the caller's camera.
//
// On a FaceTime Video call the Chert bridge can publish the caller's camera into the room as a video
// track (facetime-remote-video), when caller capture is enabled on the line. This file reads that
// track, takes about one frame a second, shrinks it to a JPEG (the agent asks for 1024 pixels wide), and hands it to
// send(). Gemini Live accepts at most about one frame a second, so sending more only costs money.
// The logs record times and sizes only, never the picture.
import sharp from 'sharp';
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';

const stamp = () => new Date().toISOString().slice(11, 23);

/**
 * Sends the caller's camera to send(jpegBase64, capturedAtMs) about once every `everyMs`.
 * Handles the camera arriving late, being turned off, and being replaced. Returns a function that stops it.
 * @param {import('@livekit/rtc-node').Room} room
 * @param {string} callerIdentity the bridge participant, chert-bridge-<call id>
 * @param {(jpegBase64: string, capturedAtMs: number) => void} send
 * @param {{ everyMs?: number, maxWidth?: number, quality?: number, onFullFrame?: (jpeg: Buffer) => void }} [options]
 * onFullFrame gets the picture at full size about five times a second, for the careful diagram read
 * (diagram.mjs): with a shaky hand most frames are blurred, and more frames give a better chance of a sharp one.
 * @returns {() => void}
 */
export function watchCaller(room, callerIdentity, send, { everyMs = 1000, maxWidth = 640, quality = 70, onFullFrame } = {}) {
  let stopped = false;
  let current = 0;          // which track is being read: a replaced track stops the older reader
  let sent = 0;

  async function read(track) {
    const mine = ++current;
    console.log(`[vision] ${stamp()} caller camera connected`);
    const reader = new VideoStream(track).getReader();
    let last = 0, busy = false, lastFull = 0, fullBusy = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stopped || mine !== current) break;
        const now = Date.now();
        if (onFullFrame && !fullBusy && now - lastFull >= 200) {
          lastFull = now; fullBusy = true;
          const rgba = value.frame.convert(VideoBufferType.RGBA);
          sharp(Buffer.from(rgba.data), { raw: { width: rgba.width, height: rgba.height, channels: 4 } }).jpeg({ quality: 90 }).toBuffer()
            .then(full => { if (!stopped && mine === current) onFullFrame(full); })
            .catch(() => {})
            .finally(() => { fullBusy = false; });
        }
        if (busy || now - last < everyMs) continue;   // drop frames in between: only the newest matters
        last = now; busy = true;
        try {
          const rgba = value.frame.convert(VideoBufferType.RGBA);
          const jpeg = await sharp(Buffer.from(rgba.data), { raw: { width: rgba.width, height: rgba.height, channels: 4 } })
            .resize({ width: maxWidth, withoutEnlargement: true })
            .jpeg({ quality })
            .toBuffer();
          if (stopped || mine !== current) break;
          send(jpeg.toString('base64'), now);
          sent++;
          if (sent === 1 || sent % 30 === 0) console.log(`[vision] ${stamp()} frame ${sent} sent, ${rgba.width}x${rgba.height}, ${jpeg.length} bytes as JPEG`);
        } catch (error) {
          console.error(`[vision] ${stamp()} could not send a frame: ${error?.message ?? error}`);
        } finally { busy = false; }
      }
    } finally {
      reader.cancel().catch(() => {});
      if (mine === current) console.log(`[vision] ${stamp()} caller camera stopped after ${sent} frames`);
    }
  }

  const isCallerVideo = (track, participant) => participant?.identity === callerIdentity && track?.kind === TrackKind.KIND_VIDEO;
  const subscribed = (track, _publication, participant) => { if (!stopped && isCallerVideo(track, participant)) void read(track); };
  const unsubscribed = (track, _publication, participant) => { if (isCallerVideo(track, participant)) current++; };
  room.on(RoomEvent.TrackSubscribed, subscribed);
  room.on(RoomEvent.TrackUnsubscribed, unsubscribed);

  // The camera may already be there when the agent starts watching.
  const caller = room.remoteParticipants.get(callerIdentity);
  let found = false;
  for (const publication of caller?.trackPublications.values() ?? []) {
    if (publication.track && publication.kind === TrackKind.KIND_VIDEO) { found = true; void read(publication.track); }
  }
  if (!found) console.log(`[vision] ${stamp()} waiting for the caller's camera (needs FaceTime Video and caller capture on the line)`);

  return () => {
    stopped = true; current++;
    room.off(RoomEvent.TrackSubscribed, subscribed);
    room.off(RoomEvent.TrackUnsubscribed, unsubscribed);
  };
}
