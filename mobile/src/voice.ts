export const VOICE_MODEL = "grok-voice-latest";
export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_URL = `wss://api.x.ai/v1/realtime?model=${VOICE_MODEL}`;

export const VOICE_INSTRUCTIONS = [
  "You are the voice of a cycling helmet. Speak one short sentence.",
  "Call navigate_to when the rider names a place. Call start_ride when they say go and a place is already chosen. Call end_ride when they want to stop. Call whats_next when they ask for the next turn. Call connect_helmet when they want the helmet connected.",
  "The cue engine already chose the turn. Speak the say field from whats_next exactly. Never choose left, front, right, or a U-turn yourself.",
].join(" ");

export const VOICE_TOOL_NAMES = ["navigate_to", "start_ride", "end_ride", "whats_next", "connect_helmet"] as const;

export type VoiceCommand =
  | { name: "navigate_to"; query: string }
  | { name: "start_ride" }
  | { name: "end_ride" }
  | { name: "whats_next" }
  | { name: "connect_helmet" };

export type VoiceNotice = { kind: "heard" | "said" | "error"; text: string };

export type VoiceConnectOptions = {
  url: string;
  protocols?: string[];
  headers?: Record<string, string>;
};

const EMPTY_PARAMETERS = { type: "object", properties: {} };

export function voiceKeyConfigured(key: string | undefined): boolean {
  return Boolean(key && key.trim());
}

export function voiceConnectOptions(key: string): VoiceConnectOptions {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("Set EXPO_PUBLIC_XAI_API_KEY to use voice.");
  if (trimmed.startsWith("xai-client-secret.")) return { url: VOICE_URL, protocols: [trimmed] };
  return { url: VOICE_URL, headers: { Authorization: `Bearer ${trimmed}` } };
}

export function voiceSessionUpdate(): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
      voice: "eve",
      instructions: VOICE_INSTRUCTIONS,
      reasoning: { effort: "none" },
      turn_detection: { type: null },
      tools: [
        tool("navigate_to", "Start a bike route to the place the rider names. Do not choose a turn.", {
          type: "object",
          properties: { query: { type: "string", description: "Place name or address" } },
          required: ["query"],
        }),
        tool("start_ride", "Start riding a route that is already chosen.", EMPTY_PARAMETERS),
        tool("end_ride", "Stop the current ride.", EMPTY_PARAMETERS),
        tool("whats_next", "Read the next maneuver the cue engine already chose. Speak its say field exactly.", EMPTY_PARAMETERS),
        tool("connect_helmet", "Connect the phone to the SmartHelmet.", EMPTY_PARAMETERS),
      ],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: VOICE_SAMPLE_RATE },
          transcription: { model: "grok-transcribe", language_hint: "en", keyterms: ["SmartHelmet"] },
        },
        output: { format: { type: "audio/pcm", rate: VOICE_SAMPLE_RATE } },
      },
    },
  };
}

export function appendAudioMessage(audioBase64: string): string {
  return JSON.stringify({ type: "input_audio_buffer.append", audio: audioBase64 });
}

export function commitAudioMessage(): string {
  return JSON.stringify({ type: "input_audio_buffer.commit" });
}

export function responseCreateMessage(): string {
  return JSON.stringify({ type: "response.create" });
}

export function functionOutputMessage(callId: string, output: string): string {
  return JSON.stringify({
    type: "conversation.item.create",
    item: { type: "function_call_output", call_id: callId, output },
  });
}

export function refusedToolResult(): string {
  return JSON.stringify({ error: "That command is not available. The cue engine chooses the turn." });
}

export function whatsNextResult(screen: {
  phase: string;
  destinationName: string;
  instruction: string;
  metersToJunction: number;
}): string {
  const say = screen.phase === "idle" || !screen.instruction ? "No ride is active." : `${screen.instruction}. ${screen.metersToJunction} meters.`;
  return JSON.stringify({
    phase: screen.phase,
    destination: screen.destinationName,
    instruction: screen.instruction,
    meters: screen.metersToJunction,
    say,
  });
}

export function commandFromCall(name: string, args: unknown): VoiceCommand | null {
  const fields = readArgs(args);
  if (name === "navigate_to") {
    const query = typeof fields.query === "string" ? fields.query.trim() : "";
    return query ? { name, query } : null;
  }
  if (name === "start_ride" || name === "end_ride" || name === "whats_next" || name === "connect_helmet") return { name };
  return null;
}

export function prepareMicPcm(data: Uint8Array, channels: number, sampleRate: number): Uint8Array {
  return resamplePcm16(monoPcm16(data, channels), sampleRate, VOICE_SAMPLE_RATE);
}

export function monoPcm16(interleaved: Uint8Array, channels: number): Uint8Array {
  if (channels <= 1) return interleaved;
  const samples = Math.floor(interleaved.length / 2 / channels);
  const out = new Uint8Array(samples * 2);
  const src = new DataView(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
  const dst = new DataView(out.buffer);
  for (let index = 0; index < samples; index += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) sum += src.getInt16((index * channels + channel) * 2, true);
    dst.setInt16(index * 2, clampInt16(Math.round(sum / channels)), true);
  }
  return out;
}

export function resamplePcm16(input: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  if (fromRate === toRate || fromRate <= 0 || toRate <= 0) return input;
  const inSamples = Math.floor(input.length / 2);
  if (inSamples === 0) return input;
  const outSamples = Math.max(1, Math.round((inSamples * toRate) / fromRate));
  const src = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const out = new Uint8Array(outSamples * 2);
  const dst = new DataView(out.buffer);
  for (let index = 0; index < outSamples; index += 1) {
    const sourceIndex = Math.min(inSamples - 1, Math.floor((index * fromRate) / toRate));
    dst.setInt16(index * 2, src.getInt16(sourceIndex * 2, true), true);
  }
  return out;
}

export function wavFromPcm16(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  view.setUint32(4, 36 + pcm.length, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, pcm.length, true);
  writeAscii(view, 0, "RIFF");
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  writeAscii(view, 36, "data");
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}

export function pcmDurationMs(byteLength: number, sampleRate = VOICE_SAMPLE_RATE): number {
  if (byteLength <= 0 || sampleRate <= 0) return 0;
  return Math.ceil((byteLength / 2 / sampleRate) * 1000);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    out += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/\s/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index] ?? "");
    const b = alphabet.indexOf(clean[index + 1] ?? "");
    const c = clean[index + 2] === "=" ? -1 : alphabet.indexOf(clean[index + 2] ?? "");
    const d = clean[index + 3] === "=" ? -1 : alphabet.indexOf(clean[index + 3] ?? "");
    const triple = ((Math.max(a, 0) << 18) | (Math.max(b, 0) << 12) | (Math.max(c, 0) << 6) | Math.max(d, 0)) >>> 0;
    bytes.push((triple >> 16) & 255);
    if (c >= 0) bytes.push((triple >> 8) & 255);
    if (d >= 0) bytes.push(triple & 255);
  }
  return Uint8Array.from(bytes);
}

function tool(name: string, description: string, parameters: object): Record<string, unknown> {
  return { type: "function", name, description, parameters };
}

function readArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, value));
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}
