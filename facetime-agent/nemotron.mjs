// Delegated reasoning: the live Gemini model hands a task to a hosted NVIDIA Nemotron model.
//
// Gemini calls the ask_nemotron tool with the task, what it currently sees (visual_context) and the
// facts it knows. This file adds the latest careful reading of the caller's diagram (diagram.mjs),
// the reading before it and the advice already given, so that each round of a review builds on the
// last one, and recent transcript lines with their times. It calls NVIDIA's
// OpenAI-compatible chat endpoint, and returns the answer as text. Text only goes to NVIDIA: no audio
// and no camera pictures.
//
// Rules it keeps, from the project plan:
//   - one request at a time; a second call while one is running gets a "busy" result at once
//   - a time limit (10 seconds unless NEMOTRON_TIMEOUT_MS says otherwise)
//   - a cancelled call aborts the request and its late answer is thrown away
//   - the answer length is capped by the prompt, and the model's private reasoning text is never returned
//   - failures come back as structured results the live model can explain, never as a crash
//   - log lines carry times, sizes and codes only, never the task, the transcript or the answer
const stamp = () => new Date().toISOString().slice(11, 23);

/** True when the two settings a request needs are present. */
export function nemotronConfigured(env = process.env) {
  return Boolean(env.NVIDIA_API_KEY) && Boolean(env.NEMOTRON_MODEL);
}

/** The JSON Schema Gemini fills in when it calls the tool. All three fields are required. */
export const askNemotronParameters = {
  type: 'object',
  properties: {
    task: { type: 'string', description: 'The question or task to reason about, stated completely so it makes sense on its own.' },
    visual_context: { type: 'string', description: 'What you currently see on the caller\'s camera that matters for the task: boxes, arrows, labels, their order. Write "nothing relevant visible" if the camera shows nothing useful.' },
    known_facts: { type: 'string', description: 'Facts and instructions from the conversation that the task depends on. Write "none" if there are none.' },
  },
  required: ['task', 'visual_context', 'known_facts'],
};

const SYSTEM = `You are a reasoning assistant working behind a live voice agent. The voice agent is on a video call
and cannot think for long, so it hands you tasks such as planning, analysing a workflow, or summarising.
You get the task, the agent's description of what it sees, known facts, and recent transcript lines with
their time into the call. You cannot see or hear the call yourself: treat the visual description as a
report, not as your own observation. Answer in plain sentences that can be read aloud, at most 120 words,
with no markdown, lists or headings. If the information given is not enough, say what is missing.

When you are given a reading of the caller's diagram, it is usually the outline of a software project
that they are drawing on a whiteboard or paper and improving with your help, one round at a time.
Review the plan itself, and give only the two or three changes that matter most right now:
- What is missing: for example a step, a data store, authentication, an API between two parts, testing,
  deployment, a path for when a step fails, an owner, or a decision with only one way out.
- Tools: every part should name a concrete tool. Where a part has none, or a weak choice, recommend one
  specific tool, not a list: the database, the backend language and framework, the frontend framework,
  hosting, and so on, each with a few words on why it fits this project, its deadline and its team.
- A better alternative where there is one: a different order, parts built side by side, a part merged,
  removed or replaced by a hosted service.
- Name parts by their labels in the reading, and say where on the diagram to add or change something.
- If there is an earlier reading and advice already given, start with what the caller has now fixed, in
  a few words, do not repeat advice they have followed, and move on to the next most important gap.
- When nothing important is left, say plainly that the outline is complete and ready to build, and stop
  suggesting changes. Do not invent problems.
- Ignore how the diagram is drawn: handwriting, arrow directions, layout and legibility are not problems.`;

/**
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch, context?: { asText(options?: object): string, add(kind: string, text: string): void } }} [options]
 * fetch and env can be replaced in tests. context is the call's bounded record (context.mjs).
 * @returns {{ ask(args: { task: string, visual_context: string, known_facts: string }, signal?: AbortSignal): Promise<object>, readonly busy: boolean }}
 */
export function createNemotron({ env = process.env, fetch: request = fetch, context } = {}) {
  const base = (env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
  const timeoutMs = Number(env.NEMOTRON_TIMEOUT_MS) > 0 ? Number(env.NEMOTRON_TIMEOUT_MS) : 10_000;
  // The limit covers the model's private reasoning as well as its answer. With a low limit the reasoning
  // used it all up and the answer came back empty or cut off, so the limit is generous and the reasoning
  // is kept short instead (NEMOTRON_REASONING: low, medium or high). The prompt caps the answer's length.
  const maxTokens = Number(env.NEMOTRON_MAX_TOKENS) > 0 ? Number(env.NEMOTRON_MAX_TOKENS) : 2500;
  const reasoning = env.NEMOTRON_REASONING || 'low';
  const hedgeMs = Number(env.NEMOTRON_HEDGE_MS) > 0 ? Number(env.NEMOTRON_HEDGE_MS) : 10_000;
  let busy = false;
  const fail = (code, message) => ({ ok: false, error: code, message });

  return {
    get busy() { return busy; },
    async ask({ task, visual_context: visual, known_facts: facts } = {}, signal) {
      if (!nemotronConfigured(env)) return fail('not_configured', 'Delegated reasoning is not set up. Answer the caller yourself.');
      if (!String(task ?? '').trim()) return fail('bad_request', 'The task was empty. Ask again with a complete task.');
      if (busy) return fail('busy', 'Another delegated request is still running. Wait for it, or answer the caller yourself.');
      if (signal?.aborted) return fail('cancelled', 'The request was cancelled before it started.');
      busy = true;
      const started = Date.now();
      // The caller's cancellation and our own time limit both stop the request.
      const limit = AbortSignal.timeout(timeoutMs);
      // Stops both requests when the call is cancelled, the time limit passes, or an answer has been chosen.
      const done = new AbortController();
      const stop = AbortSignal.any([limit, done.signal, ...(signal ? [signal] : [])]);
      context?.add('visual', visual);
      const transcript = context?.asText({ limit: 12, kinds: ['user', 'agent'] }) || '(no transcript yet)';
      // The exact labels and arrows, read from a full-size camera frame: more reliable than Gemini's description.
      const [diagram, before] = (context?.recent({ limit: 2, kinds: ['diagram'] }) ?? []).reverse().map(entry => entry.text);
      const advice = context?.recent({ limit: 3, kinds: ['advice'] }).map(entry => `- ${entry.text}`).join('\n');
      const review = !diagram ? '' : `The caller's diagram as it is now, read carefully from the camera:\n${diagram}\n\n`
        + (before ? `The diagram as it was at the reading before this one:\n${before}\n\n` : '')
        + (advice ? `Advice you already gave on this call, oldest first:\n${advice}\n\n` : '');
      const user = `Task: ${task}\n\n${review}What the voice agent sees: ${visual || 'not stated'}\n\nKnown facts: ${facts || 'none'}\n\nRecent transcript (time into the call):\n${transcript}`;
      // One request to the model. Returns the final answer only: reasoning_content is dropped, and so is
      // any inline <think> block.
      const call = async (extra, label) => {
        const response = await request(`${base}/chat/completions`, {
          method: 'POST', signal: stop,
          headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: env.NEMOTRON_MODEL, temperature: 0.3, ...extra,
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw Object.assign(new Error('http'), { status: response.status });
        }
        const body = await response.json();
        const answer = String(body?.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
        if (!answer) throw Object.assign(new Error('empty'), { empty: true });
        return { answer, label, usage: body?.usage ?? {} };
      };
      let hedge;
      try {
        const full = call({ max_tokens: maxTokens, reasoning_effort: reasoning }, 'full');
        // The full answer took anywhere from 8 to over 25 seconds in tests. If it is slow, the same
        // question is also asked with the private reasoning switched off, which answers in about 2
        // seconds, and whichever answer arrives first is used.
        const slow = await Promise.race([full.then(() => false), new Promise(resolve => { hedge = setTimeout(resolve, hedgeMs, true); })]);
        const result = slow
          ? await Promise.any([full, call({ max_tokens: 700, chat_template_kwargs: { enable_thinking: false } }, 'quick')]).catch(error => { throw error.errors?.[0] ?? error; })
          : await full;
        // If the call was cancelled while the answer was arriving, the answer is obsolete.
        if (signal?.aborted) return fail('cancelled', 'The request was cancelled.');
        const { answer, usage } = result;
        console.log(`[nemotron] ${stamp()} ok (${result.label}): ${Date.now() - started} ms, prompt ${usage.prompt_tokens ?? '?'} tokens, completion ${usage.completion_tokens ?? '?'} tokens, answer ${answer.length} characters`);
        if (diagram) context?.add('advice', answer);
        return { ok: true, answer, source: 'nemotron', note: 'This is delegated reasoning based on your description, not a direct observation.' };
      } catch (error) {
        const cancelled = signal?.aborted;
        const timedOut = !cancelled && (limit.aborted || error?.name === 'TimeoutError');
        console.log(`[nemotron] ${stamp()} ${cancelled ? 'cancelled' : timedOut ? 'timed out' : 'failed: ' + (error?.status ? 'HTTP ' + error.status : error?.empty ? 'empty answer' : error?.name ?? 'error')} after ${Date.now() - started} ms`);
        if (cancelled) return fail('cancelled', 'The request was cancelled.');
        if (timedOut) return fail('timeout', `The reasoning service did not answer within ${Math.round(timeoutMs / 1000)} seconds. Answer the caller yourself, briefly.`);
        if (error?.empty) return fail('empty_answer', 'The reasoning service returned no answer. Answer the caller yourself.');
        if (error?.status) {
          const code = error.status === 429 ? 'rate_limited' : error.status === 401 || error.status === 403 ? 'not_authorized' : 'upstream_error';
          return fail(code, `The reasoning service answered with an error (${error.status}). Answer the caller yourself.`);
        }
        return fail('unreachable', 'The reasoning service could not be reached. Answer the caller yourself.');
      } finally { busy = false; clearTimeout(hedge); done.abort(); }
    },
  };
}
