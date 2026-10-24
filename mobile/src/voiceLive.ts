import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { VoiceAgent, VoiceSocket } from "./voiceAgent";
import { VoiceCommand, VoiceNotice, pcmDurationMs, voiceConnectOptions } from "./voice";

type SocketWithHeaders = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

let player: AudioPlayer | null = null;
let previous: File | null = null;

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

export async function prepareVoiceAudio(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    shouldRouteThroughEarpiece: false,
  });
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
