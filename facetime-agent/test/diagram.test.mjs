// Mock tests for the careful diagram read: no network, no camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramReader } from '../diagram.mjs';
import { createCallContext } from '../context.mjs';

const env = { DIAGRAM_TIMEOUT_MS: '50' };

test('without a camera frame it says so and asks no model', async () => {
  let calls = 0;
  const reader = createDiagramReader({ env, generate: async () => { calls++; return 'x'; } });
  assert.equal((await reader.read({ question: 'review' })).error, 'no_camera');
  assert.equal(calls, 0);
});

test('sends the largest of the last fifteen frames, with the question, and records the reading', async () => {
  const context = createCallContext();
  let seen;
  const reader = createDiagramReader({ env, context, generate: async request => { seen = request; return 'Steps: A, B'; } });
  for (const size of [900, ...Array(12).fill(10), 30, 20, 15]) reader.addFrame(Buffer.alloc(size));   // the 900-byte frame is too old
  const result = await reader.read({ question: 'what is missing?' });
  assert.equal(result.ok, true);
  assert.equal(result.reading, 'Steps: A, B');
  assert.equal(seen.jpeg.length, 30);
  assert.match(seen.prompt, /what is missing\?/);
  assert.equal(context.recent({ kinds: ['diagram'] }).length, 1);
});

test('when the first model fails, the second one is tried', async () => {
  const asked = [];
  const reader = createDiagramReader({ env, generate: async ({ model }) => { asked.push(model); if (asked.length === 1) throw Object.assign(new Error('quota'), { status: 429 }); return 'Steps: A'; } });
  reader.addFrame(Buffer.alloc(5));
  assert.equal((await reader.read({})).ok, true);
  assert.equal(asked.length, 2);
  assert.notEqual(asked[0], asked[1]);
});

test('a frame with no diagram, and an empty answer, are structured errors', async () => {
  let answer = 'NO DIAGRAM VISIBLE.';
  const reader = createDiagramReader({ env, generate: async () => answer });
  reader.addFrame(Buffer.alloc(5));
  assert.equal((await reader.read({})).error, 'no_diagram');
  answer = '  ';
  assert.equal((await reader.read({})).error, 'empty_answer');
});

test('times out, fails and cancels with structured errors, and frees the slot', async () => {
  let mode = 'hang';
  const reader = createDiagramReader({ env, generate: () => mode === 'hang' ? new Promise(() => {}) : Promise.reject(new Error('boom')) });
  reader.addFrame(Buffer.alloc(5));
  assert.equal((await reader.read({})).error, 'timeout');
  mode = 'fail';
  assert.equal((await reader.read({})).error, 'unreachable');
  mode = 'hang';
  const controller = new AbortController();
  const pending = reader.read({}, controller.signal);
  assert.equal((await reader.read({})).error, 'busy');
  controller.abort();
  assert.equal((await pending).error, 'cancelled');
});
