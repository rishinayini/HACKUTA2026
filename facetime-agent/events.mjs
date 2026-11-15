// A local feed of what happens on the current call, for the web app and the transcript widget.
// One JSON object per line in .cache/call-events.jsonl (git-ignored). The file holds the latest
// call only: it is emptied when a call starts. Note that it contains what was said.
import { appendFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

const DIR = new URL('./.cache/', import.meta.url);
const FILE = new URL('call-events.jsonl', DIR);
const HANGUP = new URL('hangup', DIR);
const OFF = String(process.env.CALL_EVENTS ?? '').toLowerCase() === 'off';

/**
 * @param {'call_started' | 'transcript' | 'agent_state' | 'call_ended'} type
 * @param {Record<string, unknown>} [data]
 */
export function emitCallEvent(type, data = {}) {
  if (OFF) return;
  try {
    mkdirSync(DIR, { recursive: true });
    const line = JSON.stringify({ type, at: Date.now(), ...data }) + '\n';
    if (type === 'call_started') writeFileSync(FILE, line); else appendFileSync(FILE, line);
  } catch { /* the feed is optional: never break a call over it */ }
}

/**
 * Calls onHangup once when the web app asks to end the call: its dev server touches
 * .cache/hangup. A request older than this call is thrown away. Returns a function that stops watching.
 * @param {() => unknown} onHangup
 * @returns {() => void}
 */
export function watchHangup(onHangup) {
  if (OFF) return () => {};
  const since = Date.now();
  const timer = setInterval(() => {
    let mtimeMs;
    try { ({ mtimeMs } = statSync(HANGUP)); } catch { return; }
    try { rmSync(HANGUP, { force: true }); } catch { /* try again next tick */ }
    if (mtimeMs < since - 1000) return;
    clearInterval(timer);
    try { onHangup(); } catch { /* the call ended first */ }
  }, 400);
  return () => clearInterval(timer);
}
