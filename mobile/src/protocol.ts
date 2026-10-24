export const PROTOCOL_VERSION = 1;
export const CUE_PACKET_LEN = 8;
export const HELMET_STATE_PACKET_LEN = 4;

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
export const HEADING_INVALID = 0xffff;

export const DEVICE_NAME = "SmartHelmet";
export const SERVICE_UUID = "7c1a0001-5e2b-4a6d-8f10-9b3c4d5e6f70";
export const CUE_CHARACTERISTIC_UUID = "7c1a0002-5e2b-4a6d-8f10-9b3c4d5e6f70";
export const HELMET_STATE_CHARACTERISTIC_UUID = "7c1a0003-5e2b-4a6d-8f10-9b3c4d5e6f70";

const CUE_FLAG_MASK = FLAG_ARRIVED | FLAG_OFF_ROUTE | FLAG_REROUTING;
const BUTTON_MASK = BUTTON_MODE | BUTTON_SOS;

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

function uint(name: string, value: number, high: number): void {
  if (!Number.isInteger(value) || value < 0 || value > high) {
    throw new Error(`${name} out of range`);
  }
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

export function sameBytes(left: Uint8Array | null, right: Uint8Array): boolean {
  if (left === null || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
