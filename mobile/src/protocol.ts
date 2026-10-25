export const PROTOCOL_VERSION = 1;
export const CUE_PACKET_LEN = 8;
export const HELMET_STATE_PACKET_LEN = 4;
export const SENSOR_PACKET_LEN = 20;
export const AUDIO_HEADER_LEN = 2;
export const AUDIO_MAX_SAMPLES = 240;
export const AUDIO_SAMPLE_RATE = 16000;

export const DIRECTION_NONE = 0;
export const DIRECTION_LEFT = 1;
export const DIRECTION_FRONT = 2;
export const DIRECTION_RIGHT = 3;
export const DIRECTION_UTURN = 4;

export const FLAG_ARRIVED = 1 << 0;
export const FLAG_OFF_ROUTE = 1 << 1;
export const FLAG_REROUTING = 1 << 2;

export const BUTTON_MODE = 1 << 0;
export const BUTTON_SOS = 1 << 1;
export const BUTTON_TALK = 1 << 2;
export const BUTTON_PRESSED = 1 << 3;
export const HEADING_INVALID = 0xffff;

export const FLAG_IMU_OK = 1 << 0;
export const FLAG_MIC_OK = 1 << 1;

export const DEVICE_NAME = "SmartHelmet";
export const SERVICE_UUID = "7c1a0001-5e2b-4a6d-8f10-9b3c4d5e6f70";
export const CUE_CHARACTERISTIC_UUID = "7c1a0002-5e2b-4a6d-8f10-9b3c4d5e6f70";
export const HELMET_STATE_CHARACTERISTIC_UUID = "7c1a0003-5e2b-4a6d-8f10-9b3c4d5e6f70";
export const SENSOR_CHARACTERISTIC_UUID = "7c1a0004-5e2b-4a6d-8f10-9b3c4d5e6f70";
export const AUDIO_CHARACTERISTIC_UUID = "7c1a0005-5e2b-4a6d-8f10-9b3c4d5e6f70";

const CUE_FLAG_MASK = FLAG_ARRIVED | FLAG_OFF_ROUTE | FLAG_REROUTING;
const BUTTON_MASK = BUTTON_MODE | BUTTON_SOS | BUTTON_TALK | BUTTON_PRESSED;
const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;
const SENSOR_FLAG_MASK = FLAG_IMU_OK | FLAG_MIC_OK;

export type Cue = {
  direction: number;
  intensity: number;
  pulsePeriodMs: number;
  distanceM: number;
  flags: number;
};

export type HelmetState = {
  headingDecidegrees: number;
  headingValid: boolean;
  buttons: number;
};

export type SensorSample = {
  imuOk: boolean;
  micOk: boolean;
  axMg: number;
  ayMg: number;
  azMg: number;
  gxDps10: number;
  gyDps10: number;
  gzDps10: number;
  micPeak: number;
};

function uint(name: string, value: number, high: number): void {
  if (!Number.isInteger(value) || value < 0 || value > high) {
    throw new Error(`${name} out of range`);
  }
}

function int16(name: string, value: number): void {
  if (!Number.isInteger(value) || value < -32768 || value > 32767) {
    throw new Error(`${name} out of range`);
  }
}

function putI16(out: number[], value: number): void {
  const raw = value & 0xffff;
  out.push(raw & 0xff, (raw >> 8) & 0xff);
}

function getI16(packet: Uint8Array, offset: number): number {
  const raw = packet[offset] | (packet[offset + 1] << 8);
  return raw >= 32768 ? raw - 65536 : raw;
}

export function encodeCue(cue: Cue): Uint8Array {
  uint("direction", cue.direction, DIRECTION_UTURN);
  uint("intensity", cue.intensity, 255);
  uint("pulsePeriodMs", cue.pulsePeriodMs, 65535);
  uint("distanceM", cue.distanceM, 65535);
  uint("flags", cue.flags, CUE_FLAG_MASK);
  return Uint8Array.from([
    PROTOCOL_VERSION,
    cue.direction,
    cue.intensity,
    cue.pulsePeriodMs & 0xff,
    (cue.pulsePeriodMs >> 8) & 0xff,
    cue.distanceM & 0xff,
    (cue.distanceM >> 8) & 0xff,
    cue.flags,
  ]);
}

export function decodeCue(packet: Uint8Array): Cue {
  if (packet.length !== CUE_PACKET_LEN) {
    throw new Error("cue packet must be 8 bytes");
  }
  const direction = packet[1];
  const flags = packet[7];
  if (packet[0] !== PROTOCOL_VERSION) throw new Error("unsupported cue version");
  if (direction > DIRECTION_UTURN) throw new Error("unknown direction");
  if (flags & ~CUE_FLAG_MASK) throw new Error("unknown cue flags");
  return {
    direction,
    intensity: packet[2],
    pulsePeriodMs: packet[3] | (packet[4] << 8),
    distanceM: packet[5] | (packet[6] << 8),
    flags,
  };
}

export function encodeHelmetState(state: HelmetState): Uint8Array {
  uint("headingDecidegrees", state.headingDecidegrees, 0xffff);
  uint("buttons", state.buttons, BUTTON_MASK);
  if (state.headingValid) {
    if (state.headingDecidegrees > 3599) throw new Error("valid heading must be 0..3599 decidegrees");
  } else if (state.headingDecidegrees !== HEADING_INVALID) {
    throw new Error("invalid heading must use the 0xFFFF sentinel");
  }
  const heading = state.headingDecidegrees;
  return Uint8Array.from([heading & 0xff, (heading >> 8) & 0xff, state.headingValid ? 1 : 0, state.buttons]);
}

export function decodeHelmetState(packet: Uint8Array): HelmetState {
  if (packet.length !== HELMET_STATE_PACKET_LEN) {
    throw new Error("helmet state packet must be 4 bytes");
  }
  const heading = packet[0] | (packet[1] << 8);
  const validByte = packet[2];
  const buttons = packet[3];
  if (validByte !== 0 && validByte !== 1) throw new Error("heading validity must be 0 or 1");
  if (buttons & ~BUTTON_MASK) throw new Error("unknown button bits");
  const headingValid = validByte === 1;
  if (headingValid) {
    if (heading > 3599) throw new Error("valid heading must be 0..3599 decidegrees");
  } else if (heading !== HEADING_INVALID) {
    throw new Error("invalid heading must use the 0xFFFF sentinel");
  }
  return { headingDecidegrees: heading, headingValid, buttons };
}

export function encodeSensorSample(sample: SensorSample): Uint8Array {
  int16("axMg", sample.axMg);
  int16("ayMg", sample.ayMg);
  int16("azMg", sample.azMg);
  int16("gxDps10", sample.gxDps10);
  int16("gyDps10", sample.gyDps10);
  int16("gzDps10", sample.gzDps10);
  int16("micPeak", sample.micPeak);
  const flags = (sample.imuOk ? FLAG_IMU_OK : 0) | (sample.micOk ? FLAG_MIC_OK : 0);
  const out: number[] = [PROTOCOL_VERSION, flags];
  putI16(out, sample.axMg);
  putI16(out, sample.ayMg);
  putI16(out, sample.azMg);
  putI16(out, sample.gxDps10);
  putI16(out, sample.gyDps10);
  putI16(out, sample.gzDps10);
  putI16(out, sample.micPeak);
  out.push(0, 0, 0, 0);
  return Uint8Array.from(out);
}

export function decodeSensorSample(packet: Uint8Array): SensorSample {
  if (packet.length !== SENSOR_PACKET_LEN) throw new Error("sensor packet must be 20 bytes");
  if (packet[0] !== PROTOCOL_VERSION) throw new Error("unsupported sensor version");
  const flags = packet[1];
  if (flags & ~SENSOR_FLAG_MASK) throw new Error("unknown sensor flags");
  return {
    imuOk: Boolean(flags & FLAG_IMU_OK),
    micOk: Boolean(flags & FLAG_MIC_OK),
    axMg: getI16(packet, 2),
    ayMg: getI16(packet, 4),
    azMg: getI16(packet, 6),
    gxDps10: getI16(packet, 8),
    gyDps10: getI16(packet, 10),
    gzDps10: getI16(packet, 12),
    micPeak: getI16(packet, 14),
  };
}

export type AudioPacket = {
  sequence: number;
  pcm: Uint8Array;
};

export function ulawEncode(sample: number): number {
  int16("sample", sample);
  let sign = 0;
  let magnitude = sample;
  if (magnitude < 0) {
    sign = 0x80;
    magnitude = -magnitude;
  }
  magnitude = Math.min(magnitude, ULAW_CLIP) + ULAW_BIAS;
  let exponent = 7;
  let mask = 0x4000;
  while (exponent > 0 && !(magnitude & mask)) {
    exponent -= 1;
    mask >>= 1;
  }
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function ulawDecode(value: number): number {
  const bits = ~value & 0xff;
  const magnitude = ((((bits & 0x0f) << 3) + ULAW_BIAS) << ((bits >> 4) & 0x07)) - ULAW_BIAS;
  return bits & 0x80 ? -magnitude : magnitude;
}

export function encodeAudioPacket(sequence: number, samples: number[]): Uint8Array {
  uint("sequence", sequence, 255);
  if (samples.length < 1 || samples.length > AUDIO_MAX_SAMPLES) throw new Error(`audio packet holds 1 to ${AUDIO_MAX_SAMPLES} samples`);
  return Uint8Array.from([PROTOCOL_VERSION, sequence, ...samples.map(ulawEncode)]);
}

export function decodeAudioPacket(packet: Uint8Array): AudioPacket {
  if (packet.length <= AUDIO_HEADER_LEN || packet.length > AUDIO_HEADER_LEN + AUDIO_MAX_SAMPLES) {
    throw new Error(`audio packet must hold 1 to ${AUDIO_MAX_SAMPLES} samples`);
  }
  if (packet[0] !== PROTOCOL_VERSION) throw new Error("unsupported audio version");
  const count = packet.length - AUDIO_HEADER_LEN;
  const pcm = new Uint8Array(count * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < count; index += 1) view.setInt16(index * 2, ulawDecode(packet[AUDIO_HEADER_LEN + index]), true);
  return { sequence: packet[1], pcm };
}

export function sameBytes(left: Uint8Array | null, right: Uint8Array): boolean {
  if (left === null || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
