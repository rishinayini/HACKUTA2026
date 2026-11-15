import { useEffect, useRef, useState, type ReactNode } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { useLiveCall } from "./live";

/**
 * The agent's camera during a live call, watched straight from the call's LiveKit room as a
 * hidden, watch-only participant. Sound stays on FaceTime, so nothing is played here.
 * Shows `fallback` until the picture arrives, and whenever there is no live call.
 */
export default function AgentCamera({ className, fallback }: { className?: string; fallback: ReactNode }) {
  const { active, room: roomName } = useLiveCall();
  const video = useRef<HTMLVideoElement>(null);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    if (!active || !roomName) return;
    let cancelled = false;
    const room = new Room();
    let attached: RemoteTrack | null = null;

    const attach = (track: RemoteTrack) => {
      if (cancelled || attached || track.kind !== Track.Kind.Video || !video.current) return;
      attached = track;
      track.attach(video.current);
      setShowing(true);
    };
    // Only the agent's camera: not the caller's camera, and no audio at all.
    const wanted = (identity: string, kind: Track.Kind) =>
      kind === Track.Kind.Video && !identity.startsWith("chert-bridge");
    const subscribeAll = () => {
      for (const participant of room.remoteParticipants.values())
        for (const publication of participant.trackPublications.values())
          if (wanted(participant.identity, publication.kind)) publication.setSubscribed(true);
    };

    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (wanted(participant.identity, publication.kind)) publication.setSubscribed(true);
    });
    room.on(RoomEvent.TrackSubscribed, (track) => attach(track));
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track !== attached) return;
      track.detach();
      attached = null;
      setShowing(false);
    });

    void (async () => {
      try {
        const response = await fetch(`/api/call/token?room=${encodeURIComponent(roomName)}`);
        if (!response.ok || cancelled) return;
        const { url, token } = (await response.json()) as { url: string; token: string };
        await room.connect(url, token, { autoSubscribe: false });
        if (cancelled) return void room.disconnect();
        subscribeAll();
      } catch {
        // No picture: the fallback stays.
      }
    })();

    return () => {
      cancelled = true;
      attached?.detach();
      setShowing(false);
      void room.disconnect();
    };
  }, [active, roomName]);

  return (
    <>
      <video
        ref={video}
        className={className}
        autoPlay
        muted
        playsInline
        style={{ display: showing ? undefined : "none", objectFit: "cover", borderRadius: 24 }}
        aria-label="Northy's camera"
      />
      {!showing && fallback}
    </>
  );
}
