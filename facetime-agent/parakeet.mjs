// A written transcript of the caller, from NVIDIA's hosted Parakeet speech recogniser.
//
// Gemini still hears the caller directly: nothing here sits between the caller and the live model.
// Parakeet listens to the same call audio on the side and writes what the caller said into the call's
// record (context.mjs), which delegated requests and summaries read. The model runs on NVIDIA's
// servers, so this works the same on any laptop with the NVIDIA key. Call audio goes to NVIDIA.
//
// The connection is NVIDIA Riva's streaming speech API over gRPC (proto/riva/proto/riva_asr.proto).
// If it fails it reconnects a few times and then gives up for the call; the agent then falls back to
// Gemini's own transcript of the caller. Log lines carry counts and times only, never the words.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { AudioStream, RoomEvent, TrackKind } from '@livekit/rtc-node';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 16_000;
const stamp = () => new Date().toISOString().slice(11, 23);

/** True when Parakeet should run: the NVIDIA key is set and PARAKEET is not "off". */
export function parakeetConfigured(env = process.env) {
  return Boolean(env.NVIDIA_API_KEY) && String(env.PARAKEET ?? '').toLowerCase() !== 'off';
}

let Service;
function loadService() {
  if (!Service) {
    const definition = protoLoader.loadSync('riva/proto/riva_asr.proto', { includeDirs: [join(HERE, 'proto')], keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    Service = grpc.loadPackageDefinition(definition).nvidia.riva.asr.RivaSpeechRecognition;
  }
  return Service;
}

/**
 * A streaming transcriber. write() takes 16 kHz mono 16-bit PCM; onFinal gets each finished phrase.
 * @param {{ env?: Record<string, string | undefined>, onFinal: (text: string) => void, onGiveUp?: () => void,
 *   connect?: (onData: (response: object) => void, onEnd: (error?: Error) => void) => { write(message: object): void, end(): void } }} options
 * connect can be replaced in tests; by default it opens the gRPC stream to NVIDIA.
 */
export function createTranscriber({ env = process.env, onFinal, onGiveUp, connect }) {
  const server = env.NVIDIA_ASR_SERVER || 'grpc.nvcf.nvidia.com:443';
  const functionId = env.PARAKEET_FUNCTION_ID || '1598d209-5e27-4d3c-8079-4751568b1081';   // Parakeet CTC 1.1B, streaming
  const maxRestarts = 3;
  let client, stream, closed = false, gaveUp = false, restarts = 0, phrases = 0, bytes = 0, opening = false;

  const open = connect ?? ((onData, onEnd) => {
    client ??= new (loadService())(server, grpc.credentials.createSsl());
    const metadata = new grpc.Metadata();
    metadata.set('function-id', functionId);
    metadata.set('authorization', `Bearer ${env.NVIDIA_API_KEY}`);
    const call = client.StreamingRecognize(metadata);
    call.on('data', onData);
    call.on('error', error => onEnd(error));
    call.on('end', () => onEnd());
    return call;
  });

  function start() {
    if (closed || gaveUp || stream || opening) return;
    opening = true;
    let ended = false;
    const mine = open(
      response => {
        for (const result of response?.results ?? []) {
          const text = String(result?.alternatives?.[0]?.transcript ?? '').trim();
          if (result?.is_final && text) { phrases++; restarts = 0; onFinal(text); }
        }
      },
      error => {
        if (ended) return;
        ended = true;
        if (stream === mine) stream = undefined;
        if (closed) return;
        // A stream that ends on its own (a server time limit) is reopened when audio next arrives.
        if (!error) return;
        restarts++;
        console.log(`[parakeet] ${stamp()} stream failed (${error.code ?? error.name ?? 'error'}), attempt ${restarts} of ${maxRestarts}`);
        if (restarts >= maxRestarts) {
          gaveUp = true;
          console.log(`[parakeet] ${stamp()} giving up for this call; using the live model's transcript instead`);
          onGiveUp?.();
        }
      },
    );
    stream = mine;
    opening = false;
    stream.write({ streaming_config: { interim_results: false, config: {
      encoding: 'LINEAR_PCM', sample_rate_hertz: SAMPLE_RATE, audio_channel_count: 1,
      language_code: env.PARAKEET_LANGUAGE || 'en-US', max_alternatives: 1, enable_automatic_punctuation: true,
    } } });
  }

  return {
    get active() { return !closed && !gaveUp; },
    stats() { return { phrases, bytes, restarts, gaveUp }; },
    /** @param {Buffer | Uint8Array} pcm 16 kHz mono 16-bit little-endian */
    write(pcm) {
      if (closed || gaveUp) return;
      if (!stream) start();
      if (!stream) return;
      try { stream.write({ audio_content: pcm }); bytes += pcm.length; } catch { /* the stream is closing; the next write reopens it */ }
    },
    close() {
      if (closed) return;
      closed = true;
      try { stream?.end(); } catch { /* already closed */ }
      stream = undefined;
      try { client?.close(); } catch { /* already closed */ }
      console.log(`[parakeet] ${stamp()} closed: ${phrases} phrases from ${(bytes / 2 / SAMPLE_RATE).toFixed(0)} s of audio`);
    },
  };
}

/**
 * Feeds the caller's audio track to a transcriber. Handles the track arriving late or being replaced.
 * Returns a function that stops it.
 * @param {import('@livekit/rtc-node').Room} room
 * @param {string} callerIdentity
 * @param {{ write(pcm: Buffer): void, close(): void }} transcriber
 */
export function transcribeCaller(room, callerIdentity, transcriber) {
  let stopped = false, current = 0;
  async function read(track) {
    const mine = ++current;
    console.log(`[parakeet] ${stamp()} listening to the caller`);
    const reader = new AudioStream(track, SAMPLE_RATE, 1).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stopped || mine !== current) break;
        const samples = value.data;
        transcriber.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
      }
    } catch (error) {
      console.log(`[parakeet] ${stamp()} stopped reading the caller's audio (${error?.name ?? 'error'})`);
    } finally { reader.cancel().catch(() => {}); }
  }
  const isCallerAudio = (track, participant) => participant?.identity === callerIdentity && track?.kind === TrackKind.KIND_AUDIO;
  const subscribed = (track, _publication, participant) => { if (!stopped && isCallerAudio(track, participant)) void read(track); };
  const unsubscribed = (track, _publication, participant) => { if (isCallerAudio(track, participant)) current++; };
  room.on(RoomEvent.TrackSubscribed, subscribed);
  room.on(RoomEvent.TrackUnsubscribed, unsubscribed);
  for (const publication of room.remoteParticipants.get(callerIdentity)?.trackPublications.values() ?? []) {
    if (publication.track && publication.kind === TrackKind.KIND_AUDIO) void read(publication.track);
  }
  return () => {
    stopped = true; current++;
    room.off(RoomEvent.TrackSubscribed, subscribed);
    room.off(RoomEvent.TrackUnsubscribed, unsubscribed);
    transcriber.close();
  };
}
