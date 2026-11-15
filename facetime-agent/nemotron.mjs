// Delegated reasoning: the live Gemini model hands a task to a hosted NVIDIA Nemotron model.
//
// Gemini calls the ask_nemotron tool with the task, what it currently sees (visual_context) and the
// facts it knows. This file adds recent transcript lines with their times, calls NVIDIA's
// OpenAI-compatible chat endpoint, and returns the answer as text. Text only goes to NVIDIA: no audio
// and no camera pictures.
//
// Rules it keeps, from the project plan:
//   - one request at a time; a second call while one is running gets a "busy" result at once
//   - a time limit (10 seconds unless NEMOTRON_TIMEOUT_MS says otherwise)
//   - a cancelled call aborts the request and its late answer is thrown away
//   - the answer length is capped, and the model's private reasoning text is never returned
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
with no markdown, lists or headings. If the information given is not enough, say what is missing.`;

/**
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch, context?: { asText(options?: object): string, add(kind: string, text: string): void } }} [options]
 * fetch and env can be replaced in tests. context is the call's bounded record (context.mjs).
 * @returns {{ ask(args: { task: string, visual_context: string, known_facts: string }, signal?: AbortSignal): Promise<object>, readonly busy: boolean }}
 */
export function createNemotron({ env = process.env, fetch: request = fetch, context } = {}) {
  const base = (env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
  const timeoutMs = Number(env.NEMOTRON_TIMEOUT_MS) > 0 ? Number(env.NEMOTRON_TIMEOUT_MS) : 10_000;
  const maxTokens = Number(env.NEMOTRON_MAX_TOKENS) > 0 ? Number(env.NEMOTRON_MAX_TOKENS) : 700;
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
      const stop = signal ? AbortSignal.any([signal, limit]) : limit;
      context?.add('visual', visual);
      const transcript = context?.asText({ limit: 12, kinds: ['user', 'agent', 'summary'] }) || '(no transcript yet)';
      const user = `Task: ${task}\n\nWhat the voice agent sees: ${visual || 'not stated'}\n\nKnown facts: ${facts || 'none'}\n\nRecent transcript (time into the call):\n${transcript}`;
      try {
        const response = await request(`${base}/chat/completions`, {
          method: 'POST', signal: stop,
          headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: env.NEMOTRON_MODEL, max_tokens: maxTokens, temperature: 0.3,
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          console.log(`[nemotron] ${stamp()} failed: HTTP ${response.status} after ${Date.now() - started} ms`);
          const code = response.status === 429 ? 'rate_limited' : response.status === 401 || response.status === 403 ? 'not_authorized' : 'upstream_error';
          return fail(code, `The reasoning service answered with an error (${response.status}). Answer the caller yourself.`);
        }
        const body = await response.json();
        // If the call was cancelled while the answer was arriving, the answer is obsolete.
        if (signal?.aborted) return fail('cancelled', 'The request was cancelled.');
        const message = body?.choices?.[0]?.message ?? {};
        // Only the final answer is returned: reasoning_content is dropped, and so is any inline <think> block.
        const answer = String(message.content ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
        const usage = body?.usage ?? {};
        console.log(`[nemotron] ${stamp()} ok: ${Date.now() - started} ms, prompt ${usage.prompt_tokens ?? '?'} tokens, completion ${usage.completion_tokens ?? '?'} tokens, answer ${answer.length} characters`);
        if (!answer) return fail('empty_answer', 'The reasoning service returned no answer. Answer the caller yourself.');
        return { ok: true, answer, source: 'nemotron', note: 'This is delegated reasoning based on your description, not a direct observation.' };
      } catch (error) {
        const cancelled = signal?.aborted;
        const timedOut = !cancelled && (limit.aborted || error?.name === 'TimeoutError');
        console.log(`[nemotron] ${stamp()} ${cancelled ? 'cancelled' : timedOut ? 'timed out' : 'failed: ' + (error?.name ?? 'error')} after ${Date.now() - started} ms`);
        if (cancelled) return fail('cancelled', 'The request was cancelled.');
        if (timedOut) return fail('timeout', `The reasoning service did not answer within ${Math.round(timeoutMs / 1000)} seconds. Answer the caller yourself, briefly.`);
        return fail('unreachable', 'The reasoning service could not be reached. Answer the caller yourself.');
      } finally { busy = false; }
    },
  };
}
