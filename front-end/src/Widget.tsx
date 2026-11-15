import { useEffect, useRef } from "react";
import { useLiveCall } from "./live";

const shield = "/assets/84fe6.svg";

/**
 * The call screen's "Live transcript" panel on its own, filling a small window (open the app
 * with ?widget=1).
 * It uses the same markup and styles as the panel in App.tsx, so the two always look alike.
 */
export default function Widget() {
  const live = useLiveCall();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = live.active ? "● Live transcript" : "Transcript";
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [live.active, live.messages.length, live.speaking]);

  const started = live.startedAt
    ? `TODAY · ${new Date(live.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : null;

  return (
    <aside className="transcript" style={{ height: "100dvh", borderRadius: 0 }}>
      <div className="transcript-title">
        <div>
          <span className="meeting-live-dot" style={live.active ? undefined : { background: "#8eaf9c", boxShadow: "none" }} />
          <h2>{live.active ? "Live transcript" : live.seen ? "Transcript · call ended" : "Transcript"}</h2>
        </div>
      </div>
      <div className="private-banner">
        <img src={shield} alt="" /> Secure and visible only to you
      </div>
      <div className="message-list">
        {started && <time>{started}</time>}
        {live.messages.length === 0 && (
          <time>
            {live.active ? "Listening…" : "The transcript appears here when a FaceTime call starts."}
          </time>
        )}
        {live.messages.map((message, index) => (
          <div className={`message ${message.from}`} key={`${message.from}-${index}`}>
            <strong>{message.from === "ai" ? "Northy · AI" : "You"}</strong>
            <p>{message.text}</p>
          </div>
        ))}
        {live.speaking && <small>Northy is speaking…</small>}
        <div ref={end} />
      </div>
    </aside>
  );
}
