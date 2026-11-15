// A careful read of a whole diagram, for text too small for the live model.
//
// The live Gemini model misreads text under about 11 pixels tall in the camera picture, whatever
// size the picture is sent at: in a test it turned "Vendor quote" into "Vendor gusto" at 8 pixels.
// A still-image Gemini model read the same frame correctly. So when the caller shows a diagram, the
// live model calls the read_diagram tool: this file takes the sharpest of the last three seconds of full-size
// camera frames, sends it to the still-image model, and returns the labels, the connections and the
// notes as text. It only reads: advice on the workflow comes from the reasoning model (nemotron.mjs),
// which gets this reading as text. It usually takes 1 to 3 seconds. One camera frame goes to Google per read.
// If the first model is out of quota or overloaded, a second one is tried within the same time limit.
// Log lines carry times and sizes only, never the picture or the reading.
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';

const stamp = () => new Date().toISOString().slice(11, 23);

/** The JSON Schema Gemini fills in when it calls the tool. */
export const readDiagramParameters = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'What the caller wants to know about the diagram, in their words. Write "review the whole diagram" if they did not say.' },
  },
  required: ['question'],
};

const PROMPT = `This is one frame from a video call. The caller is showing a diagram drawn on paper or a
whiteboard: a workflow, or the outline of a software project. The text may be small. Read it carefully and answer in plain text, no markdown:
1. Steps: every box or node label, in order, following the arrows.
2. Connections: each arrow as "A -> B", including branches, loops, and any label on the arrow.
3. Notes: any handwritten notes, and what they are next to.
4. Unreadable: any part that is too small, blurry, cut off or hidden. Write [unreadable] rather than guessing a word or a number.
Only report what is drawn; give no advice. Keep the whole answer under 180 words.
If the frame shows no diagram, say only: NO DIAGRAM VISIBLE.`;

/**
 * @param {{ env?: Record<string, string | undefined>, context?: { add(kind: string, text: string): void },
 *   generate?: (request: { model: string, jpeg: Buffer, prompt: string, signal: AbortSignal }) => Promise<string> }} [options]
 * generate can be replaced in tests; by default it calls the still-image Gemini model.
 */
export function createDiagramReader({ env = process.env, context, generate } = {}) {
  // In a test on text 8 pixels tall, both read every label; the first took about 1.3 seconds.
  const models = [env.DIAGRAM_MODEL || 'gemini-3.5-flash-lite', env.DIAGRAM_FALLBACK_MODEL || 'gemini-3.1-flash-lite'];
  const timeoutMs = Number(env.DIAGRAM_TIMEOUT_MS) > 0 ? Number(env.DIAGRAM_TIMEOUT_MS) : 20_000;
  // The last three seconds of camera frames, at five a second. A shaky hand blurs most frames, and a
  // sideways blur of 5 pixels was enough to break the reading in a test, so the sharpest one is used.
  const KEEP = 15;
  /** @type {Buffer[]} */
  let frames = [];
  let busy = false, ai;
  const fail = (code, message) => ({ ok: false, error: code, message });

  const ask = generate ?? (async ({ model: name, jpeg, prompt, signal }) => {
    ai ??= new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY || env.GEMINI_API_KEY });
    // Enlarged to twice the size and sharpened first: on 7-pixel notes the model then read all the
    // text exactly in 6 of 6 tries, against 2 of 6 with the frame as it came.
    const { width } = await sharp(jpeg).metadata();
    jpeg = await sharp(jpeg).resize({ width: Math.min(width * 2, 2560), kernel: 'lanczos3' }).sharpen().jpeg({ quality: 90 }).toBuffer();
    const response = await ai.models.generateContent({
      model: name,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }, { text: prompt }] }],
      config: { abortSignal: signal, temperature: 0.2 },
    });
    return response.text ?? '';
  });

  return {
    /** Takes each full-size camera frame as a JPEG. Only the newest few are kept, in memory. */
    addFrame(jpeg) { frames.push(jpeg); if (frames.length > KEEP) frames.shift(); },
    clear() { frames = []; },
    async read({ question } = {}, signal) {
      if (busy) return fail('busy', 'A diagram read is still running. Wait for it.');
      if (!frames.length) return fail('no_camera', 'There is no camera picture. Tell the caller you cannot see their camera.');
      // All frames are JPEGs at one quality, so the largest holds the most detail: the least motion blur.
      const jpeg = frames.reduce((best, frame) => (frame.length > best.length ? frame : best));
      busy = true;
      const started = Date.now();
      const limit = AbortSignal.timeout(timeoutMs);
      const stop = signal ? AbortSignal.any([signal, limit]) : limit;
      const aborted = new Promise((_, reject) => stop.addEventListener('abort', () => reject(stop.reason ?? new Error('aborted')), { once: true }));
      try {
        const prompt = `${PROMPT}\n\nThe caller asked: ${String(question ?? '').trim() || 'review the whole diagram'}. Read the parts that question is about with extra care.`;
        let reading, used;
        for (const model of models) {
          used = model;
          try { reading = String(await Promise.race([ask({ model, jpeg, prompt, signal: stop }), aborted])).trim(); break; }
          catch (error) {
            if (stop.aborted || model === models.at(-1)) throw error;
            console.log(`[diagram] ${stamp()} ${model} failed (${error?.status ?? error?.name ?? 'error'}) after ${Date.now() - started} ms; trying ${models.at(-1)}`);
          }
        }
        console.log(`[diagram] ${stamp()} ok: ${used}, ${Date.now() - started} ms, frame ${jpeg.length} bytes, reading ${reading.length} characters`);
        if (!reading) return fail('empty_answer', 'The careful read returned nothing. Describe what you can see yourself and ask the caller to hold the diagram closer.');
        if (/NO DIAGRAM VISIBLE/i.test(reading)) return fail('no_diagram', 'No diagram is visible in the camera picture. Ask the caller to hold it up, facing the camera.');
        context?.add('diagram', reading);
        return { ok: true, reading, note: 'This reading is more accurate than your own view of small text. Use its labels, not your own guesses.' };
      } catch (error) {
        const timedOut = limit.aborted && !signal?.aborted;
        console.log(`[diagram] ${stamp()} ${signal?.aborted ? 'cancelled' : timedOut ? 'timed out' : 'failed: ' + (error?.status ?? error?.name ?? 'error')} after ${Date.now() - started} ms`);
        if (signal?.aborted) return fail('cancelled', 'The read was cancelled.');
        if (timedOut) return fail('timeout', `The careful read did not finish within ${Math.round(timeoutMs / 1000)} seconds. Describe what you can see yourself, and say which parts are too small to read.`);
        return fail('unreachable', 'The careful read failed. Describe what you can see yourself, and say which parts are too small to read.');
      } finally { busy = false; }
    },
  };
}
