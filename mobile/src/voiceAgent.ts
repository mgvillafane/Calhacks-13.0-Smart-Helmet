import {
  VoiceCommand,
  VoiceNotice,
  appendAudioMessage,
  base64ToBytes,
  bytesToBase64,
  commandFromCall,
  commitAudioMessage,
  functionOutputMessage,
  refusedToolResult,
  responseCreateMessage,
  voiceSessionUpdate,
  wavFromPcm16,
  VOICE_SAMPLE_RATE,
  VOICE_TOOL_NAMES,
} from "./voice";

const TOOL_NAMES = new Set<string>(VOICE_TOOL_NAMES);

export type VoiceSocket = {
  send(data: string): void;
  close(): void;
};

type PendingCall = { callId: string; name: string; arguments: unknown };

export class VoiceAgent {
  private chunks: Uint8Array[] = [];
  private pending: PendingCall[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private socket: VoiceSocket,
    private execute: (command: VoiceCommand) => Promise<string>,
    private play: (wav: Uint8Array) => Promise<void>,
  ) {}

  start(): void {
    this.socket.send(JSON.stringify(voiceSessionUpdate()));
  }

  sendPcm(frame: Uint8Array): void {
    this.socket.send(appendAudioMessage(bytesToBase64(frame)));
  }

  finishUtterance(): void {
    this.socket.send(commitAudioMessage());
    this.socket.send(responseCreateMessage());
  }

  close(): void {
    this.socket.close();
  }

  handleMessage(raw: string): Promise<VoiceNotice | null> {
    const run = this.tail.then(() => this.dispatch(raw));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async dispatch(raw: string): Promise<VoiceNotice | null> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { kind: "error", text: "Voice sent a message that was not JSON." };
    }
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "response.created") {
      this.chunks = [];
      return null;
    }
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      const delta = typeof event.delta === "string" ? event.delta : typeof event.audio === "string" ? event.audio : "";
      if (delta) this.chunks.push(base64ToBytes(delta));
      return null;
    }
    if (type === "response.function_call_arguments.done") {
      const name = typeof event.name === "string" ? event.name : "";
      const callId = typeof event.call_id === "string" ? event.call_id : "";
      if (name && callId) this.pending.push({ name, callId, arguments: event.arguments ?? "{}" });
      return null;
    }
    if (type === "response.done") {
      await this.finishTurn();
      return null;
    }
    if (type === "error") return { kind: "error", text: errorText(event) };
    const transcript = transcriptText(event);
    if (!transcript) return null;
    if (type.startsWith("conversation.item.input_audio_transcription")) return { kind: "heard", text: transcript };
    if (type.includes("transcript")) return { kind: "said", text: transcript };
    return null;
  }

  private async finishTurn(): Promise<void> {
    const pcm = concat(this.chunks);
    this.chunks = [];
    const calls = this.pending.splice(0);
    const playback = pcm.length > 0 ? this.play(wavFromPcm16(pcm, VOICE_SAMPLE_RATE)) : Promise.resolve();
    for (const call of calls) {
      const command = commandFromCall(call.name, call.arguments);
      let output = TOOL_NAMES.has(call.name) ? JSON.stringify({ error: "Say the place name." }) : refusedToolResult();
      if (command) {
        try {
          output = await this.execute(command);
        } catch (error) {
          output = JSON.stringify({ error: error instanceof Error ? error.message : "command failed" });
        }
      }
      this.socket.send(functionOutputMessage(call.callId, output));
    }
    try {
      await playback;
    } finally {
      if (calls.length > 0) this.socket.send(responseCreateMessage());
    }
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function transcriptText(event: Record<string, unknown>): string {
  if (typeof event.transcript === "string") return event.transcript.trim();
  if (typeof event.text === "string") return event.text.trim();
  return "";
}

function errorText(event: Record<string, unknown>): string {
  const nested = event.error;
  if (nested && typeof nested === "object" && "message" in nested && typeof nested.message === "string") return nested.message;
  if (typeof event.message === "string") return event.message;
  return "Voice failed";
}
