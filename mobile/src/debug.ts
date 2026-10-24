import { CUE_INTENSITY, PULSE_FAR_MS } from "./engine";
import { Cue, DIRECTION_FRONT, DIRECTION_LEFT, DIRECTION_NONE, DIRECTION_RIGHT } from "./protocol";

export type DebugSide = "left" | "front" | "right";

export function directionForDebugSide(side: DebugSide): typeof DIRECTION_LEFT | typeof DIRECTION_FRONT | typeof DIRECTION_RIGHT {
  if (side === "left") return DIRECTION_LEFT;
  if (side === "front") return DIRECTION_FRONT;
  return DIRECTION_RIGHT;
}

export function debugTurnCue(direction: typeof DIRECTION_LEFT | typeof DIRECTION_FRONT | typeof DIRECTION_RIGHT): Cue {
  return { direction, intensity: CUE_INTENSITY, pulsePeriodMs: PULSE_FAR_MS, distanceM: 0, flags: 0 };
}

export function debugStopCue(): Cue {
  return { direction: DIRECTION_NONE, intensity: 0, pulsePeriodMs: 0, distanceM: 0, flags: 0 };
}

export function micLevel(peak: number): number {
  const ratio = Math.abs(peak) / 32767;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}
