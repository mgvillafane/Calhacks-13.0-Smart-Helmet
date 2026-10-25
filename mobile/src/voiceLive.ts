import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { VoiceAgent, VoiceSocket } from "./voiceAgent";
import { VoiceCommand, VoiceNotice, VOICE_SAMPLE_RATE, amplifyPcm16, pcmDurationMs, voiceConnectOptions, wavFromPcm16 } from "./voice";

type SocketWithHeaders = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

let player: AudioPlayer | null = null;
let previous: File | null = null;
const MONITOR_GAIN = 4;
const MONITOR_MIN_BYTES = 6400;
const players: Array<AudioPlayer | null> = [null, null];
const playerFiles: Array<File | null> = [null, null];
let playerTurn = 0;
let monitorPending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
let monitorChain: Promise<void> = Promise.resolve();

export function connectGrokVoice(
  key: string,
  execute: (command: VoiceCommand) => Promise<string>,
  onNotice: (notice: VoiceNotice) => void,
): Promise<VoiceAgent> {
  const open = voiceConnectOptions(key);
  const Socket = WebSocket as unknown as SocketWithHeaders;
  const ws = open.headers ? new Socket(open.url, undefined, { headers: open.headers }) : new Socket(open.url, open.protocols);
  let opened = false;
  let closedByUs = false;
  const socket: VoiceSocket = {
    send(data: string) {
      ws.send(data);
    },
    close() {
      closedByUs = true;
      ws.close();
    },
  };
  const agent = new VoiceAgent(socket, execute, playWav);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!opened) {
        closedByUs = true;
        ws.close();
        reject(new Error("Grok Voice timed out"));
      }
    }, 10000);
    ws.onopen = () => {
      opened = true;
      clearTimeout(timer);
      agent.start();
      resolve(agent);
    };
    ws.onclose = () => {
      if (!opened) {
        clearTimeout(timer);
        reject(new Error("Grok Voice connection failed"));
        return;
      }
      if (!closedByUs) onNotice({ kind: "error", text: "Voice disconnected" });
    };
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      void agent.handleMessage(event.data).then(
        (notice) => {
          if (notice) onNotice(notice);
        },
        (error: unknown) => {
          onNotice({ kind: "error", text: error instanceof Error ? error.message : "Voice failed" });
        },
      );
    };
  });
}

export function playHelmetMonitor(pcm: Uint8Array): void {
  if (pcm.length < 2) return;
  monitorPending = concatPcm(monitorPending, amplifyPcm16(pcm, MONITOR_GAIN));
  if (monitorPending.length < MONITOR_MIN_BYTES) return;
  const chunk = monitorPending;
  monitorPending = new Uint8Array(0);
  const wav = wavFromPcm16(chunk, VOICE_SAMPLE_RATE);
  monitorChain = monitorChain.then(() => startMonitorClip(wav)).catch(() => undefined);
}

export async function prepareVoiceAudio(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    shouldRouteThroughEarpiece: false,
  });
}

async function prepareSpeaker(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
    interruptionMode: "mixWithOthers",
    shouldRouteThroughEarpiece: false,
  });
}

async function startMonitorClip(wav: Uint8Array): Promise<void> {
  await prepareSpeaker();
  const index = playerTurn;
  playerTurn = 1 - playerTurn;
  const file = new File(Paths.cache, `helmet-mic-${index}-${Date.now()}.wav`);
  await file.write(wav);
  let player = players[index];
  if (!player) {
    player = createAudioPlayer(file.uri, { updateInterval: 50, keepAudioSessionActive: true });
    players[index] = player;
  } else {
    player.replace(file.uri);
  }
  player.muted = false;
  player.volume = 1;
  player.loop = false;
  try {
    await player.seekTo(0);
  } catch {
    // Playback starts at the beginning once the file loads.
  }
  player.play();
  const stale = playerFiles[index];
  playerFiles[index] = file;
  if (stale?.exists) {
    try {
      stale.delete();
    } catch {
      // This player has moved on to the new clip.
    }
  }
}

function concatPcm(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

async function playWav(wav: Uint8Array): Promise<void> {
  await prepareVoiceAudio();
  const file = new File(Paths.cache, `helmet-voice-${Date.now()}.wav`);
  await file.write(wav);
  if (!player) player = createAudioPlayer(file.uri);
  else player.replace(file.uri);
  try {
    await player.seekTo(0);
  } catch {
    // Playback starts at the beginning once the file loads.
  }
  player.play();
  const stale = previous;
  previous = file;
  if (stale?.exists) {
    try {
      stale.delete();
    } catch {
      // The next reply replaces this clip.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, pcmDurationMs(Math.max(0, wav.length - 44)) + 150));
}
