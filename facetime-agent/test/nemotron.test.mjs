// Tests for the delegation rules, against a mock provider: no network and no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNemotron } from '../nemotron.mjs';
import { createCallContext } from '../context.mjs';

const env = { NVIDIA_API_KEY: 'test-key', NEMOTRON_MODEL: 'test-model', NEMOTRON_TIMEOUT_MS: '200' };
const args = { task: 'Plan the rollout', visual_context: 'three boxes joined by arrows', known_facts: 'none' };
const reply = (message, status = 200) => new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 5, completion_tokens: 7 } }), { status });
/** A provider that answers only when release() is called, and honours the abort signal. */
function slowProvider() {
  let release;
  const fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    release = () => resolve(reply({ content: 'late answer' }));
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: signal.reason?.name ?? 'AbortError' })));
  });
  return { fetch, release: () => release?.() };
}

test('returns the answer and drops the reasoning text', async () => {
  let sent;
  const nemotron = createNemotron({ env, fetch: async (url, init) => { sent = { url, init }; return reply({ content: '<think>secret</think>Do it in two steps.', reasoning_content: 'private chain' }); } });
  const result = await nemotron.ask(args);
  assert.deepEqual({ ok: result.ok, answer: result.answer }, { ok: true, answer: 'Do it in two steps.' });
  assert.ok(!JSON.stringify(result).includes('private chain') && !JSON.stringify(result).includes('secret'));
  assert.equal(sent.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  const body = JSON.parse(sent.init.body);
  assert.equal(body.model, 'test-model');
  assert.ok(body.max_tokens > 0);
  assert.equal(sent.init.headers.authorization, 'Bearer test-key');
});

test('packages the visual context and recent transcript with times', async () => {
  let t = 0; const context = createCallContext({ now: () => t });
  context.add('user', 'What should I do first?'); t = 2500; context.add('agent', 'Let me think.');
  let body;
  const nemotron = createNemotron({ env, context, fetch: async (_u, init) => { body = JSON.parse(init.body); return reply({ content: 'ok' }); } });
  await nemotron.ask(args);
  const user = body.messages.at(-1).content;
  assert.match(user, /three boxes joined by arrows/);
  assert.match(user, /\[0\.0s user\] What should I do first\?/);
  assert.match(user, /\[2\.5s agent\] Let me think\./);
  assert.equal(context.recent({ kinds: ['visual'] }).length, 1);
});

test('a review round gets the diagram now, the diagram before, and the advice already given', async () => {
  const context = createCallContext();
  context.add('diagram', 'Steps: oldest'); context.add('diagram', 'Steps: Login, Feed');
  let body;
  const nemotron = createNemotron({ env, context, fetch: async (_u, init) => { body = JSON.parse(init.body); return reply({ content: 'Add a database.' }); } });
  await nemotron.ask(args);
  context.add('diagram', 'Steps: Login, Feed, Postgres');
  await nemotron.ask(args);
  const user = body.messages.at(-1).content;
  assert.match(user, /as it is now[^\n]*\nSteps: Login, Feed, Postgres/);
  assert.match(user, /reading before this one:\nSteps: Login, Feed\n/);
  assert.match(user, /already gave[^\n]*\n- Add a database\./);
  assert.doesNotMatch(user, /Steps: oldest/);
});

test('without a diagram reading, answers are not kept as diagram advice', async () => {
  const context = createCallContext();
  const nemotron = createNemotron({ env, context, fetch: async () => reply({ content: 'A plan.' }) });
  await nemotron.ask(args);
  assert.equal(context.recent({ kinds: ['advice'] }).length, 0);
});

test('when the full answer is slow, a quick answer without reasoning is asked for and used', async () => {
  const bodies = [];
  const fetch = (_url, init) => { const body = JSON.parse(init.body); bodies.push(body);
    return body.chat_template_kwargs ? Promise.resolve(reply({ content: 'quick answer' })) : new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))); };
  const nemotron = createNemotron({ env: { ...env, NEMOTRON_HEDGE_MS: '20' }, fetch });
  const result = await nemotron.ask(args);
  assert.equal(result.answer, 'quick answer');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].chat_template_kwargs.enable_thinking, false);
  assert.equal(nemotron.busy, false);
});

test('a second call while one is running is told busy at once', async () => {
  const provider = slowProvider();
  const nemotron = createNemotron({ env: { ...env, NEMOTRON_TIMEOUT_MS: '2000' }, fetch: provider.fetch });
  const first = nemotron.ask(args);
  assert.equal(nemotron.busy, true);
  assert.equal((await nemotron.ask(args)).error, 'busy');
  provider.release();
  assert.equal((await first).ok, true);
  assert.equal(nemotron.busy, false);
});

test('times out with a structured error and frees the slot', async () => {
  const nemotron = createNemotron({ env, fetch: slowProvider().fetch });
  const result = await nemotron.ask(args);
  assert.deepEqual({ ok: result.ok, error: result.error }, { ok: false, error: 'timeout' });
  assert.equal(nemotron.busy, false);
});

test('cancellation aborts the request', async () => {
  const controller = new AbortController();
  const nemotron = createNemotron({ env: { ...env, NEMOTRON_TIMEOUT_MS: '2000' }, fetch: slowProvider().fetch });
  const pending = nemotron.ask(args, controller.signal);
  controller.abort();
  assert.equal((await pending).error, 'cancelled');
  assert.equal(nemotron.busy, false);
});

test('an answer that arrives after cancellation is discarded', async () => {
  const controller = new AbortController();
  const nemotron = createNemotron({ env, fetch: async () => { controller.abort(); return reply({ content: 'obsolete' }); } });
  const result = await nemotron.ask(args, controller.signal);
  assert.equal(result.error, 'cancelled');
  assert.ok(!JSON.stringify(result).includes('obsolete'));
});

test('provider errors and missing settings are structured', async () => {
  assert.equal((await createNemotron({ env, fetch: async () => reply({}, 429) }).ask(args)).error, 'rate_limited');
  assert.equal((await createNemotron({ env, fetch: async () => reply({}, 401) }).ask(args)).error, 'not_authorized');
  assert.equal((await createNemotron({ env, fetch: async () => reply({}, 500) }).ask(args)).error, 'upstream_error');
  assert.equal((await createNemotron({ env, fetch: async () => { throw new TypeError('network'); } }).ask(args)).error, 'unreachable');
  assert.equal((await createNemotron({ env, fetch: async () => reply({ content: '' }) }).ask(args)).error, 'empty_answer');
  assert.equal((await createNemotron({ env: {}, fetch: async () => reply({ content: 'x' }) }).ask(args)).error, 'not_configured');
  assert.equal((await createNemotron({ env, fetch: async () => reply({ content: 'x' }) }).ask({ ...args, task: ' ' })).error, 'bad_request');
});
