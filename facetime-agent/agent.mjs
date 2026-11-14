import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-google';
import { TurnCoverage } from '@google/genai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from './face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { watchCaller } from './vision.mjs';

// Change these instructions to build your own agent. Keep replies conversational.
const instructions = `You are a friendly AI assistant on a FaceTime video call.
You can hear the caller and you can see what their camera shows, about one picture a second.
The caller may hold up drawings, whiteboards or workflow diagrams. When they ask about what
they are showing, describe what you actually see: the boxes, arrows, labels and their order,
and then help with it. If the picture is unclear or you see no camera picture, say so plainly
and ask them to hold it steady or closer. Never invent details you cannot see.
The caller sees a simple animated face while you talk.
Keep each reply to one to three short sentences. Be clear that you are an AI.`;
// Said once, as soon as FaceTime is ready. Keep it short: it is the first thing the caller hears.
// Three sentences on purpose: the Mac ends a call it hears nothing from in the first 10 seconds,
// so the greeting keeps sound flowing for most of that time.
const greeting = 'Greet the caller warmly in three sentences: say hello and that you are an AI assistant, say you can look at drawings and workflow diagrams they hold up to the camera, then ask what they want to work on.';

const agent = defineAgent({
  entry: async ctx => {
    // Audio and video: the caller's camera is read in vision.mjs.
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    // Chert prepares a room before a caller exists. Join promptly so Chert can
    // find us, but wait before opening a paid model session or sending video.
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

    const session = new voice.AgentSession({
      // Gemini Live. Reads GOOGLE_API_KEY from .env.local. Keep a 2.5 model: the
      // 3.1 live model cannot be told to speak first, so the greeting would fail.
      llm: new realtime.RealtimeModel({
        model: process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025',
        voice: 'Puck',
        // Count camera pictures sent while the caller was silent as part of their next question,
        // so "what is this?" covers what was already on screen.
        realtimeInputConfig: { turnCoverage: TurnCoverage.TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO },
      }),
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      speaking = event.newState === 'speaking';
      // One line per change, so the log shows exactly when the agent's voice was playing.
      console.log(`[agent] ${new Date().toISOString().slice(11, 23)} ${event.oldState} -> ${event.newState}`);
    });
    ctx.addShutdownCallback(async () => {
      clearInterval(timer);
      await session.close();
      await track.close();
      await source.close();
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions }),
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
    // The agent stops listening while it greets. Sound from the caller's side in the first
    // second or two otherwise interrupts the greeting, and the Mac ends the call as silent.
    // Listening comes back when the greeting has played, or after 12 seconds at the latest.
    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      let listening = false;
      const listen = () => { if (!listening) { listening = true; session.input.setAudioEnabled(true); } };
      session.input.setAudioEnabled(false);
      const fallback = setTimeout(listen, 12000);
      try { session.generateReply({ instructions: greeting }).addDoneCallback(() => { clearTimeout(fallback); listen(); }); }
      catch (error) { clearTimeout(fallback); listen(); throw error; }
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
