// The live FaceTime call, as the agent reports it through the dev server's /api/call-events feed.
import { useSyncExternalStore } from "react";

export type LiveMessage = { from: "ai" | "you"; text: string; time: string };
export type LiveCall = {
  /** A call is in progress right now. */
  active: boolean;
  /** A real call has been seen since the page loaded, so real data replaces the sample data. */
  seen: boolean;
  startedAt: number | null;
  /** When the last call ended. */
  endedAt: number | null;
  /** The LiveKit room of the call, for watching the agent's camera. */
  room: string | null;
  /** The agent's voice is playing. */
  speaking: boolean;
  messages: LiveMessage[];
};

let state: LiveCall = {
  active: false,
  seen: false,
  startedAt: null,
  endedAt: null,
  room: null,
  speaking: false,
  messages: [],
};
const listeners = new Set<() => void>();
let source: EventSource | null = null;

function set(next: Partial<LiveCall>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function connect() {
  if (source || typeof EventSource === "undefined") return;
  const query = new URLSearchParams(window.location.search);
  const role = query.has("widget") ? "widget" : query.has("mini") ? "mini" : "app";
  source = new EventSource(`/api/call-events?role=${role}`);
  source.onmessage = (message) => {
    let event: {
      type?: string;
      at?: number;
      from?: string;
      text?: string;
      room?: string;
      speaking?: boolean;
    };
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    const at = event.at ?? Date.now();
    if (event.type === "reset")
      set({ active: false, seen: false, startedAt: null, endedAt: null, room: null, speaking: false, messages: [] });
    else if (event.type === "call_started")
      set({ active: true, seen: true, startedAt: at, endedAt: null, room: event.room ?? null, speaking: false, messages: [] });
    else if (event.type === "call_ended") set({ active: false, endedAt: at, speaking: false, room: null });
    else if (event.type === "agent_state") set({ speaking: event.speaking === true });
    else if (event.type === "transcript" && event.text)
      set({
        seen: true,
        messages: [
          ...state.messages,
          { from: event.from === "you" ? "you" : "ai", text: event.text, time: clock(at) },
        ],
      });
  };
}

function subscribe(listener: () => void) {
  connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLiveCall(): LiveCall {
  return useSyncExternalStore(subscribe, () => state);
}

/** Asks this computer to open FaceTime on the agent's line. False when that is not set up here. */
export async function startFaceTimeCall(): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("/api/call/start", { method: "POST" });
    const result = (await response.json()) as { error?: string };
    return response.ok ? { ok: true } : { ok: false, error: result.error };
  } catch {
    return { ok: false, error: "The FaceTime call service is unavailable." };
  }
}

/** Asks the agent to hang up the call in progress. */
export async function endFaceTimeCall(): Promise<void> {
  try {
    await fetch("/api/call/end", { method: "POST" });
  } catch {}
}
