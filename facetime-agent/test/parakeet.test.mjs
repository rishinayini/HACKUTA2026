// Tests for the transcriber's stream handling, against a fake stream: no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriber, parakeetConfigured } from '../parakeet.mjs';

/** A fake provider: records what was written and lets the test send results or end the stream. */
function fake() {
  const streams = [];
  const connect = (onData, onEnd) => { const s = { written: [], ended: false, onData, onEnd, write(m) { this.written.push(m); }, end() { this.ended = true; } }; streams.push(s); return s; };
  return { streams, connect };
}
const env = { NVIDIA_API_KEY: 'k' };
const final = text => ({ results: [{ is_final: true, alternatives: [{ transcript: text }] }] });

test('configured only with a key and not switched off', () => {
  assert.equal(parakeetConfigured({ NVIDIA_API_KEY: 'k' }), true);
  assert.equal(parakeetConfigured({ NVIDIA_API_KEY: 'k', PARAKEET: 'off' }), false);
  assert.equal(parakeetConfigured({}), false);
});

test('sends the config first, then audio, and reports only final phrases', () => {
  const provider = fake(); const heard = [];
  const t = createTranscriber({ env, connect: provider.connect, onFinal: x => heard.push(x) });
  t.write(Buffer.alloc(320)); t.write(Buffer.alloc(320));
  const [s] = provider.streams;
  assert.equal(s.written[0].streaming_config.config.sample_rate_hertz, 16000);
  assert.equal(s.written[0].streaming_config.config.encoding, 'LINEAR_PCM');
  assert.equal(s.written.filter(m => m.audio_content).length, 2);
  s.onData({ results: [{ is_final: false, alternatives: [{ transcript: 'hel' }] }] });
  s.onData(final(' hello there '));
  s.onData(final('   '));
  assert.deepEqual(heard, ['hello there']);
  assert.equal(t.stats().bytes, 640);
});

test('a stream that ends cleanly is reopened on the next audio', () => {
  const provider = fake();
  const t = createTranscriber({ env, connect: provider.connect, onFinal() {} });
  t.write(Buffer.alloc(2)); provider.streams[0].onEnd();
  t.write(Buffer.alloc(2));
  assert.equal(provider.streams.length, 2);
  assert.ok(provider.streams[1].written[0].streaming_config);
  assert.equal(t.active, true);
});

test('gives up after repeated failures and says so once', () => {
  const provider = fake(); let gaveUp = 0;
  const t = createTranscriber({ env, connect: provider.connect, onFinal() {}, onGiveUp: () => gaveUp++ });
  for (let i = 0; i < 5; i++) { t.write(Buffer.alloc(2)); provider.streams.at(-1).onEnd(Object.assign(new Error('x'), { code: 14 })); }
  assert.equal(provider.streams.length, 3);
  assert.equal(gaveUp, 1);
  assert.equal(t.active, false);
});

test('a final phrase resets the failure count', () => {
  const provider = fake();
  const t = createTranscriber({ env, connect: provider.connect, onFinal() {} });
  for (let i = 0; i < 2; i++) { t.write(Buffer.alloc(2)); provider.streams.at(-1).onEnd(new Error('x')); }
  t.write(Buffer.alloc(2)); provider.streams.at(-1).onData(final('ok')); provider.streams.at(-1).onEnd(new Error('x'));
  assert.equal(t.active, true);
});

test('close ends the stream and ignores later audio', () => {
  const provider = fake();
  const t = createTranscriber({ env, connect: provider.connect, onFinal() {} });
  t.write(Buffer.alloc(2)); t.close(); t.write(Buffer.alloc(2));
  assert.equal(provider.streams[0].ended, true);
  assert.equal(provider.streams.length, 1);
});
