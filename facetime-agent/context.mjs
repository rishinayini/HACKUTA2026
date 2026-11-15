// A bounded, in-memory record of one call: what was said, and what the model reported seeing.
//
// Gemini keeps its own conversation history. This buffer exists to package a request for the
// delegated model (nemotron.mjs). It never grows without limit, it is never written to disk, and
// clear() empties it when the call ends. Its log lines carry counts and sizes only, never the text.

const stamp = () => new Date().toISOString().slice(11, 23);

/**
 * @typedef {{ atMs: number, kind: 'user' | 'agent' | 'visual' | 'diagram' | 'advice', text: string }} Entry
 * atMs is milliseconds since the call started, on the agent's monotonic clock.
 */

/**
 * @param {{ maxEntries?: number, maxChars?: number, now?: () => number }} [options]
 * now defaults to a monotonic clock; tests pass their own.
 */
export function createCallContext({ maxEntries = 200, maxChars = 24_000, now = () => performance.now() } = {}) {
  const startedAt = now();
  /** @type {Entry[]} */
  let entries = [];
  let chars = 0, dropped = 0;

  function trim() {
    while (entries.length > maxEntries || (chars > maxChars && entries.length > 1)) {
      chars -= entries[0].text.length;
      entries.shift();
      dropped++;
    }
  }

  return {
    /** Adds one line. Empty text is ignored; one very long line is cut to the buffer's size. */
    add(kind, text) {
      const clean = String(text ?? '').trim().slice(0, maxChars);
      if (!clean) return;
      entries.push({ atMs: Math.round(now() - startedAt), kind, text: clean });
      chars += clean.length;
      trim();
    },
    /** The newest entries, oldest first, optionally only some kinds. A copy: callers cannot change the buffer. */
    recent({ limit = 20, kinds } = {}) {
      const wanted = kinds ? entries.filter(entry => kinds.includes(entry.kind)) : entries;
      return wanted.slice(-limit).map(entry => ({ ...entry }));
    },
    /** Recent lines as plain text for a prompt, each with its time into the call. */
    asText(options) {
      return this.recent(options).map(entry => `[${(entry.atMs / 1000).toFixed(1)}s ${entry.kind}] ${entry.text}`).join('\n');
    },
    stats() { return { entries: entries.length, chars, dropped }; },
    /** One log line with counts only. */
    logStats(label) {
      const { entries: count, chars: size, dropped: gone } = this.stats();
      console.log(`[context] ${stamp()} ${label}: ${count} entries, ${size} characters, ${gone} dropped`);
    },
    clear() { entries = []; chars = 0; },
  };
}
