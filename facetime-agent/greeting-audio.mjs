// The spoken greeting, made ahead of time.
//
// Chert's Mac ends a call when it hears nothing from the agent within 10 seconds of FaceTime being
// ready. Asking the live Gemini session to greet at that moment is not reliable: on real calls it
// sometimes answered late or not at all, and the call was dropped. So the greeting is synthesised once,
// in a separate short Gemini session with the same voice, saved as raw audio in .cache/, and played
// straight into the call the moment FaceTime is ready. The live session is not involved in the first
// sound the caller hears.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Modality } from '@google/genai';
import { AudioFrame } from '@livekit/rtc-node';

export const SAMPLE_RATE = 24_000;          // Gemini Live speaks 16-bit mono PCM at 24 kHz
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.cache');
const stamp = () => new Date().toISOString().slice(11, 23);

/** Speaks `text` once in a throwaway Gemini Live session and returns the audio as 16-bit PCM bytes. */
async function synthesise({ text, voice, model, timeoutMs = 25_000 }) {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
  const chunks = [];
  let finish, fail;
  const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const timer = setTimeout(() => fail(new Error('timed out')), timeoutMs);
  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: 'You are a voice actor. Say exactly the text the user sends, word for word, in a warm, friendly tone. Add nothing before or after it.',
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    callbacks: {
      onmessage: message => {
        for (const part of message.serverContent?.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) chunks.push(Buffer.from(part.inlineData.data, 'base64'));
        }
        if (message.serverContent?.turnComplete) finish();
      },
      onerror: event => fail(new Error(String(event?.message ?? 'connection error'))),
      onclose: () => finish(),
    },
  });
  try {
    session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
    await done;
  } finally { clearTimeout(timer); try { session.close(); } catch { /* already closed */ } }
  const pcm = Buffer.concat(chunks);
  // Under a second of audio is not a three-sentence greeting: treat it as a failure, do not cache it.
  if (pcm.length < SAMPLE_RATE * 2) throw new Error('the model returned no usable audio');
  return pcm;
}

/**
 * Returns the greeting's audio, from .cache/ when it was made before, otherwise by making it now.
 * Returns undefined when it cannot be made; the caller then falls back to asking the live session.
 * @param {{ text: string, voice: string, model: string }} options
 * @returns {Promise<Buffer | undefined>}
 */
export async function loadGreetingAudio({ text, voice, model }) {
  const key = createHash('sha256').update(JSON.stringify([text, voice, model])).digest('hex').slice(0, 16);
  const file = join(CACHE, `greeting-${key}.pcm`);
  try { return await readFile(file); } catch { /* not made yet */ }
  try {
    const started = Date.now();
    const pcm = await synthesise({ text, voice, model });
    await mkdir(CACHE, { recursive: true });
    await writeFile(`${file}.${process.pid}.tmp`, pcm);
    await rename(`${file}.${process.pid}.tmp`, file);   // whole file or nothing, if two jobs make it at once
    console.log(`[greeting] ${stamp()} recorded ${(pcm.length / 2 / SAMPLE_RATE).toFixed(1)} s of audio in ${Date.now() - started} ms`);
    return pcm;
  } catch (error) {
    console.log(`[greeting] ${stamp()} could not record the greeting (${error?.message ?? error}); the live model will greet instead`);
    return undefined;
  }
}

/** The audio as a stream of 20 ms frames, the form the agent session plays. */
export function greetingFrames(pcm) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const perFrame = SAMPLE_RATE / 50;
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= samples.length) { controller.close(); return; }
      const slice = samples.slice(offset, offset + perFrame);
      offset += perFrame;
      controller.enqueue(new AudioFrame(slice, SAMPLE_RATE, 1, slice.length));
    },
  });
}
