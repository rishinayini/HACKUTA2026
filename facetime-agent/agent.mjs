import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-google';
import { TurnCoverage } from '@google/genai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from './face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { watchCaller } from './vision.mjs';
import { createCallContext } from './context.mjs';
import { greetingFrames, loadGreetingAudio } from './greeting-audio.mjs';
import { createTranscriber, parakeetConfigured, transcribeCaller } from './parakeet.mjs';
import { askNemotronParameters, createNemotron, nemotronConfigured } from './nemotron.mjs';

// Change these instructions to build your own agent. Keep replies conversational.
const instructions = `You are a friendly AI assistant on a FaceTime video call.
You can hear the caller and you can see what their camera shows, about one picture a second.
The caller may hold up drawings, whiteboards or workflow diagrams. When they ask about what
they are showing, describe what you actually see: the boxes, arrows, labels and their order,
and then help with it. If the picture is unclear or you see no camera picture, say so plainly
and ask them to hold it steady or closer. Never invent details you cannot see.
The caller sees a simple animated face while you talk.
Keep each reply to one to three short sentences. Be clear that you are an AI.`;
// Added to the instructions only when the NVIDIA settings are present.
const delegationInstructions = `
You have a tool, ask_nemotron, that hands a task to a stronger reasoning model. Use it only when the
caller asks for planning, a step-by-step analysis of a workflow or diagram, a deeper explanation, or a
summary of the call. Do not use it for greetings, small talk or simple questions you can answer yourself.
Before you call it, say one short sentence such as "Give me a moment to think that through", because it
takes several seconds. In visual_context, describe what you actually see that matters. When the answer
comes back, say it to the caller in your own words in a few sentences. If the tool reports an error,
tell the caller briefly and answer as well as you can yourself.`;
// Said once, as soon as FaceTime is ready. These exact words are recorded ahead of time (see
// greeting-audio.mjs) and played into the call, so the first sound never waits on the live model.
// About 8 seconds on purpose: the Mac ends a call it hears nothing from in the first 10 seconds.
const greetingText = 'Hi there! I am an AI assistant, and I can see what your camera shows. Hold up a drawing or a workflow diagram and I will help you with it. What would you like to work on?';
// Used only if the recording could not be made: the live model is asked to greet instead.
const greeting = `Greet the caller by saying: ${greetingText}`;
const VOICE = 'Puck';
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

    // Video: one camera track, published by this agent. The Mac shows video only
    // from the participant that speaks, so the picture and the voice stay together.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = 0, speaking = false;
    const frame = () => source.captureFrame(new VideoFrame(drawFace(tick++, speaking), WIDTH, HEIGHT, VideoBufferType.RGBA));
    frame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(frame, 1000 / FPS);

    // What was said on this call, kept in memory with times, for delegated requests and recovery
    // summaries.
    const context = createCallContext();
    // Delegated reasoning through NVIDIA's hosted Nemotron, when its key and model are set.
    const delegate = nemotronConfigured();
    const nemotron = createNemotron({ context });
    const tools = delegate ? {
      ask_nemotron: llm.tool({
        description: 'Hand a planning, analysis, deeper-reasoning or summary task to a stronger reasoning model. Takes several seconds. Only one request can run at a time.',
        parameters: askNemotronParameters,
        execute: async (args, options) => nemotron.ask(args, options?.abortSignal),
      }),
    } : undefined;

    const session = new voice.AgentSession({
      // Gemini Live. Reads GOOGLE_API_KEY from .env.local. Keep a 2.5 model: the
      // 3.1 live model cannot be told to speak first, so the greeting would fail.
      llm: new realtime.RealtimeModel({
        model: MODEL,
        voice: VOICE,
        // Count camera pictures sent while the caller was silent as part of their next question,
        // so "what is this?" covers what was already on screen.
        realtimeInputConfig: { turnCoverage: TurnCoverage.TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO },
        // Without compression Gemini limits a session with video to about 2 minutes. The sliding
        // window drops the oldest turns instead. Session resumption and reconnecting when Gemini
        // announces a disconnect (goAway) are handled by the plugin.
        contextWindowCompression: { slidingWindow: {} },
      }),
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      speaking = event.newState === 'speaking';
      // One line per change, so the log shows exactly when the agent's voice was playing.
      console.log(`[agent] ${new Date().toISOString().slice(11, 23)} ${event.oldState} -> ${event.newState}`);
    });
    // The caller's words come from NVIDIA Parakeet when the NVIDIA key is set: it listens to the call
    // audio on the side, while Gemini still hears the caller directly. Gemini's own transcripts of
    // both sides arrive as conversation items; its transcript of the caller is the fallback.
    const transcriber = parakeetConfigured() ? createTranscriber({ onFinal: text => context.add('user', text) }) : undefined;
    if (transcriber) {
      const stopTranscribing = transcribeCaller(ctx.room, caller.identity, transcriber);
      ctx.addShutdownCallback(async () => stopTranscribing());
    }
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, event => {
      const { role, textContent } = event.item ?? {};
      // While Parakeet is transcribing the caller, its text is the caller's record, not Gemini's.
      if (role === 'assistant') context.add('agent', textContent);
      else if (role === 'user' && !transcriber?.active) context.add('user', textContent);
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
      if (pcm) session.say(greetingText, { audio: greetingFrames(pcm), allowInterruptions: false, addToChatCtx: true });
      else session.generateReply({ instructions: greeting });
      console.log(`[agent] ${new Date().toISOString().slice(11, 23)} greeting started (${pcm ? 'recording' : 'live model'})`);
    });
    ctx.addShutdownCallback(async () => stopGreeting());

    // Vision: pass the caller's camera to Gemini, one small JPEG a second. The agent framework
    // does not forward video for this model, so the pictures go straight to the live session.
    const stopWatching = watchCaller(ctx.room, caller.identity, jpegBase64 => {
      session._activity?.realtimeLLMSession?.sendClientEvent({
        type: 'realtime_input',
        value: { mediaChunks: [{ mimeType: 'image/jpeg', data: jpegBase64 }] },
      });
    });
    ctx.addShutdownCallback(async () => stopWatching());
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'video-agent' });
