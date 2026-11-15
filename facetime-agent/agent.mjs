import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-google';
import { ActivityHandling, EndSensitivity, TurnCoverage } from '@google/genai';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from './face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { watchCaller } from './vision.mjs';
import { createCallContext } from './context.mjs';
import { greetingFrames, loadGreetingAudio } from './greeting-audio.mjs';
import { createTranscriber, parakeetConfigured, transcribeCaller } from './parakeet.mjs';
import { askNemotronParameters, createNemotron, nemotronConfigured } from './nemotron.mjs';
import { createDiagramReader, readDiagramParameters } from './diagram.mjs';
import { emitCallEvent, watchHangup } from './events.mjs';
import { recordCallEvent } from './tiger-data.mjs';

// Change these instructions to build your own agent. Keep replies conversational.
const instructions = `You are a friendly AI assistant on a live video call. Your main job is to help the
caller get the outline of a project right: they draw it as a workflow diagram on a whiteboard or paper,
show it to the camera, change it as you advise, and show it again, round after round, until it is complete.
You hear the caller directly and you see what their camera shows, about one picture a second.

Your own view of small text is unreliable, so you have a tool, read_diagram, that reads the camera
picture carefully and returns every label, the connections and the notes. It takes a few seconds.

When the caller shows a diagram on paper or a whiteboard, or asks about one:
- First say one short sentence such as "Keep it in view, give me a few seconds to read it properly",
  then call read_diagram. Call it again whenever they show a new or changed diagram, or a closer view.
- Use the labels from the reading, never your own guess at small text. Say the steps briefly from
  start to end, following the arrows, so the caller can correct you.
- Then give advice: what is missing, such as a step, an owner, an approval or a path for when a step
  fails, and one or two better alternatives.
- Answer what the caller actually asked. If they ask about one step, talk about that step.
- This is a loop. When the caller says they have added or changed something, or asks you to look again,
  call read_diagram again before you answer: never rely on an earlier reading or on your own view. Then
  say briefly what changed, and give the next advice.
- You only look when the caller speaks to you. If they are drawing quietly, wait.
- If the reading marks a part as unreadable, say which part and ask them to hold that part closer
  or steadier, then read again. Never guess a label or a number.
- If the tool reports an error, say so briefly and describe only what you can see clearly yourself.
If you see no camera picture, say so plainly. Never invent details you cannot see.
The caller sees a simple animated face while you talk.
Keep each reply to a few short sentences, and let the caller steer. Be clear that you are an AI.
The caller may be in a noisy room and may talk to other people nearby. Answer what is said to you;
do not comment on side conversations that are not meant for you.`;
// Added to the instructions only when the NVIDIA settings are present.
const delegationInstructions = `
You have a tool, ask_nemotron, that hands a task to a stronger reasoning model. It is better than you at
judging a workflow, so the advice on a diagram comes from it, not from you: after read_diagram, say the
steps in one or two sentences, then say "Let me think about what is missing", and call ask_nemotron with
the caller's question as the task. Do this on every round, after every new reading. It receives the
diagram reading, the reading before it and its own earlier advice automatically; it will say what is
missing, which tool to use for each part (database, backend, frontend and so on), and when the outline
is complete. In known_facts, pass what the caller has told you about the project: what it does, the
deadline, the team and any tools they already chose. Also use it when the caller asks for a full plan, a detailed
explanation, or a summary of the call. Do not use it for greetings, small talk or simple questions.
Before you call it, say one short sentence, because it takes several seconds. In visual_context,
describe what you actually see that matters. When the answer
comes back, say it to the caller in your own words in a few sentences. If the tool reports an error,
tell the caller briefly and answer as well as you can yourself.`;
// Said once, as soon as FaceTime is ready. These exact words are recorded ahead of time (see
// greeting-audio.mjs) and played into the call, so the first sound never waits on the live model.
// About 8 seconds on purpose: the Mac ends a call it hears nothing from in the first 10 seconds.
const greetingText = 'Hi there! I am an AI assistant, and I can see what your camera shows. Hold up a drawing or a workflow diagram and I will help you with it. What would you like to work on?';
// Used only if the recording could not be made: the live model is asked to greet instead.
const greeting = `Greet the caller by saying: ${greetingText}`;
const VOICE = 'Puck';
// How long the caller must be quiet before Gemini treats their turn as finished, in milliseconds.
// Shorter answers sooner but can cut in on a pause mid-sentence. VAD_SILENCE_MS overrides it.
const SILENCE_MS = Number(process.env.VAD_SILENCE_MS) > 0 ? Number(process.env.VAD_SILENCE_MS) : 500;
// Width in pixels of the camera pictures sent to Gemini. At 640 it misread small handwriting on a
// test diagram ("3 days" as "9 days"); at 1024 it read it correctly. VISION_MAX_WIDTH overrides it.
const VISION_WIDTH = Number(process.env.VISION_MAX_WIDTH) > 0 ? Number(process.env.VISION_MAX_WIDTH) : 1024;
// Whether talking can cut the agent off. Off by default: on a real call in a busy room, every answer
// was cancelled by more talking before any sound came out, and a question went unanswered for over a
// minute. With it off the agent finishes its answer, then listens. BARGE_IN=on restores interrupting.
const BARGE_IN = String(process.env.BARGE_IN ?? '').toLowerCase() === 'on';
// NOISE_CANCELLATION=off sends the call audio to the models as it is.
const CLEAN_AUDIO = String(process.env.NOISE_CANCELLATION ?? '').toLowerCase() !== 'off';
const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const greetingNote = `
When the call connects, the caller hears this greeting in your voice: "${greetingText}"
Do not greet or introduce yourself again; carry on from there.`;

const agent = defineAgent({
  entry: async ctx => {
    // Audio and video: the caller's camera is read in vision.mjs.
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    // Chert prepares a room before a caller exists. Join promptly so Chert can
    // find us, but wait before opening a paid model session or sending video.
    // Record the greeting now if it is not on disk yet: a waiting room has no caller, so there is time.
    const greetingAudio = loadGreetingAudio({ text: greetingText, voice: VOICE, model: MODEL });
    const caller = await ctx.waitForParticipant();
    const callId = ctx.job?.id || ctx.room.name;
    let callMetadata = {};
    try { callMetadata = JSON.parse(ctx.job?.metadata || '{}'); } catch { /* metadata is optional */ }
    void recordCallEvent({ callId, event: 'call_started', media: callMetadata.media });

    // Video: one camera track, published by this agent. The Mac shows video only
    // from the participant that speaks, so the picture and the voice stay together.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = 0, speaking = false;
    const frame = () => source.captureFrame(new VideoFrame(drawFace(tick++, speaking), WIDTH, HEIGHT, VideoBufferType.RGBA));
    frame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(frame, 1000 / FPS);

    // What was said on this call, kept in memory with times, for delegated requests.
    const context = createCallContext();
    // Delegated reasoning through NVIDIA's hosted Nemotron, when its key and model are set.
    const delegate = nemotronConfigured();
    const nemotron = createNemotron({ context });
    // The careful read of a whole diagram, from the sharpest recent full-size camera frame.
    const diagram = createDiagramReader({ context });
    const tools = {
      read_diagram: llm.tool({
        description: 'Read the diagram the caller is showing, accurately, including small text: labels, connections, notes and suggestions. Takes up to 20 seconds. Use it before describing or reviewing any diagram.',
        parameters: readDiagramParameters,
        execute: async (args, options) => diagram.read(args, options?.abortSignal),
      }),
      ...(delegate ? {
        ask_nemotron: llm.tool({
          description: 'Hand a planning, analysis, deeper-reasoning or summary task to a stronger reasoning model. Takes several seconds. Only one request can run at a time.',
          parameters: askNemotronParameters,
          execute: async (args, options) => nemotron.ask(args, options?.abortSignal),
        }),
      } : {}),
    };

    const session = new voice.AgentSession({
      // Gemini Live. Reads GOOGLE_API_KEY from .env.local. Keep a 2.5 model: the
      // 3.1 live model cannot be told to speak first, so the greeting would fail.
      llm: new realtime.RealtimeModel({
        model: MODEL,
        voice: VOICE,
        // Count camera pictures sent while the caller was silent as part of their next question,
        // so "what is this?" covers what was already on screen.
        realtimeInputConfig: {
          turnCoverage: TurnCoverage.TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO,
          ...(BARGE_IN ? {} : { activityHandling: ActivityHandling.NO_INTERRUPTION }),
          // Answer sooner: end the caller's turn after a short silence, and be quick to notice it.
          automaticActivityDetection: { silenceDurationMs: SILENCE_MS, endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH },
        },
        // Without compression Gemini limits a session with video to about 2 minutes. The sliding
        // window drops the oldest turns instead. Session resumption and reconnecting when Gemini
        // announces a disconnect (goAway) are handled by the plugin.
        contextWindowCompression: { slidingWindow: {} },
      }),
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      const wasSpeaking = speaking;
      speaking = event.newState === 'speaking';
      if (speaking !== wasSpeaking) emitCallEvent('agent_state', { speaking });
      void recordCallEvent({ callId, event: 'agent_state', agentState: event.newState });
      // One line per change, so the log shows exactly when the agent's voice was playing.
      console.log(`[agent] ${new Date().toISOString().slice(11, 23)} ${event.oldState} -> ${event.newState}`);
    });
    // The caller's words come from NVIDIA Parakeet when the NVIDIA key is set: it listens to the call
    // audio on the side, while Gemini still hears the caller directly. Gemini's own transcripts of
    // both sides arrive as conversation items; its transcript of the caller is the fallback.
    // SHOW_TRANSCRIPT=on prints each line in this terminal as it arrives, with who said it and which
    // recogniser wrote it. Off by default: the logs otherwise never contain what was said.
    const showTranscript = String(process.env.SHOW_TRANSCRIPT ?? '').toLowerCase() === 'on';
    // The web app and the transcript widget follow the call through this local feed.
    emitCallEvent('call_started', { room: ctx.room.name });
    // "End call" in the web app: deleting the room disconnects the FaceTime bridge, which hangs up.
    const stopHangupWatch = watchHangup(async () => {
      console.log(`[agent] ${new Date().toISOString().slice(11, 23)} the web app asked to end the call`);
      await ctx.deleteRoom();
      ctx.shutdown('ended from the web app');
    });
    ctx.addShutdownCallback(async () => stopHangupWatch());
    ctx.addShutdownCallback(async () => emitCallEvent('call_ended'));
    const record = (kind, text, source) => {
      context.add(kind, text);
      if (String(text ?? '').trim()) emitCallEvent('transcript', { from: kind === 'user' ? 'you' : 'ai', text: String(text).trim(), source });
      if (showTranscript && String(text ?? '').trim()) console.log(`[transcript] ${new Date().toISOString().slice(11, 19)} ${kind === 'user' ? 'caller' : 'agent'} (${source}): ${String(text).trim()}`);
    };
    const transcriber = parakeetConfigured() ? createTranscriber({ onFinal: text => record('user', text, 'parakeet') }) : undefined;
    if (transcriber) {
      const stopTranscribing = transcribeCaller(ctx.room, caller.identity, transcriber);
      ctx.addShutdownCallback(async () => stopTranscribing());
    }
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, event => {
      const { role, textContent } = event.item ?? {};
      // While Parakeet is transcribing the caller, its text is the caller's record, not Gemini's.
      if (role === 'assistant') record('agent', textContent, 'gemini');
      else if (role === 'user' && !transcriber?.active) record('user', textContent, 'gemini');
    });
    const contextLog = setInterval(() => context.logStats('so far'), 30_000);
    ctx.addShutdownCallback(async () => {
      clearInterval(contextLog);
      context.logStats('call ended, clearing');
      context.clear();
    });
    ctx.addShutdownCallback(async () => {
      clearInterval(timer);
      await session.close();
      await track.close();
      await source.close();
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions: instructions + greetingNote + (delegate ? delegationInstructions : ''), tools }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        // Strip other voices and room noise from the caller's audio before Gemini hears it, so its
        // voice detection reacts to the caller only. Runs through LiveKit Cloud.
        ...(CLEAN_AUDIO ? { noiseCancellation: BackgroundVoiceCancellation() } : {}),
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });
    // Greet once when chert dev reports that FaceTime is ready (bridge_ready in the
    // room metadata): the Mac ends the call if it hears nothing within 10 seconds
    // of that. Participant arrival alone is not readiness, so there is no greeting
    // on it. Without the signal there is no greeting, and the caller speaks first.
    //
    // The greeting is the recording, played as speech that cannot be interrupted. If there is no
    // recording, the live model is asked to greet, which can be late.
    const pcm = await greetingAudio;
    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      void recordCallEvent({ callId, event: 'bridge_ready' });
      if (pcm) session.say(greetingText, { audio: greetingFrames(pcm), allowInterruptions: false, addToChatCtx: true });
      else session.generateReply({ instructions: greeting });
      console.log(`[agent] ${new Date().toISOString().slice(11, 23)} greeting started (${pcm ? 'recording' : 'live model'})`);
    });
    ctx.addShutdownCallback(async () => stopGreeting());
    ctx.addShutdownCallback(async reason => recordCallEvent({ callId, event: 'call_ended', details: { reason: String(reason || 'ended').slice(0, 100) } }));

    // Vision: pass the caller's camera to Gemini, one small JPEG a second. The agent framework
    // does not forward video for this model, so the pictures go straight to the live session.
    const stopWatching = watchCaller(ctx.room, caller.identity, jpegBase64 => {
      session._activity?.realtimeLLMSession?.sendClientEvent({
        type: 'realtime_input',
        value: { mediaChunks: [{ mimeType: 'image/jpeg', data: jpegBase64 }] },
      });
    }, { maxWidth: VISION_WIDTH, quality: 80, onFullFrame: jpeg => diagram.addFrame(jpeg) });
    ctx.addShutdownCallback(async () => { stopWatching(); diagram.clear(); });
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'video-agent' });
