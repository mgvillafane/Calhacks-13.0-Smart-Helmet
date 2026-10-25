import { Decision, Fix, HeadingSource, Route } from "./engine";
import { distanceM } from "./geo";
import { DIRECTION_NONE } from "./protocol";

export type RideKind = "route" | "demo" | "here";
export type Vehicle = "bicycle" | "scooter";
export type RideEndReason = "ended" | "replaced";

export type RideStart = {
  rideKey: string;
  session: string;
  kind: RideKind;
  provider: string;
  vehicle: Vehicle;
  routeM: number;
  steps: number;
  helmetConnected: boolean;
};

export type RideEvent = {
  rideKey: string;
  kind: "cue" | "reroute" | "arrived";
  atMs: number;
  direction: number;
  distanceToManeuverM: number;
  speedMps: number;
  crossTrackM: number;
  headingSource: HeadingSource;
  helmetConnected: boolean;
};

export type RideFinish = {
  rideKey: string;
  reason: RideEndReason;
  arrived: boolean;
  riddenM: number;
  cues: number;
  reroutes: number;
};

export type LinkEvent = {
  session: string;
  kind: "connected" | "not_found" | "failed";
  scanMs: number;
  message?: string;
};

export type TelemetrySink = {
  rideStarted: (ride: RideStart) => void;
  rideEvent: (event: RideEvent) => void;
  rideFinished: (finish: RideFinish) => void;
  linkEvent: (event: LinkEvent) => void;
};

export const quietSink: TelemetrySink = {
  rideStarted: () => {},
  rideEvent: () => {},
  rideFinished: () => {},
  linkEvent: () => {},
};

export function newSessionKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function routeLengthM(route: Route): number {
  let total = 0;
  for (const step of route.steps) {
    for (let index = 1; index < step.geometry.length; index += 1) {
      total += distanceM(step.geometry[index - 1], step.geometry[index]);
    }
  }
  return Math.round(total);
}

type ActiveRide = {
  rideKey: string;
  startedMs: number;
  lastDirection: number;
  rerouting: boolean;
  arrived: boolean;
  riddenM: number;
  cues: number;
  reroutes: number;
};

// Logs what the cue engine already decided. It never chooses a direction.
export class RideRecorder {
  private ride: ActiveRide | null = null;
  private count = 0;

  constructor(
    private sink: TelemetrySink,
    readonly session: string,
    private now: () => number = Date.now,
  ) {}

  get active(): boolean {
    return this.ride !== null;
  }

  begin(input: { kind: RideKind; provider: string; vehicle: Vehicle; route: Route; helmetConnected: boolean }): void {
    this.finish("replaced");
    this.count += 1;
    const rideKey = `${this.session}-${this.count}`;
    this.ride = {
      rideKey,
      startedMs: this.now(),
      lastDirection: DIRECTION_NONE,
      rerouting: false,
      arrived: false,
      riddenM: 0,
      cues: 0,
      reroutes: 0,
    };
    this.sink.rideStarted({
      rideKey,
      session: this.session,
      kind: input.kind,
      provider: input.provider || "unknown",
      vehicle: input.vehicle,
      routeM: routeLengthM(input.route),
      steps: input.route.steps.length,
      helmetConnected: input.helmetConnected,
    });
  }

  observe(decision: Decision, fix: Fix, helmetConnected: boolean): void {
    const ride = this.ride;
    if (!ride) return;
    const direction = decision.cue.direction;
    if (direction !== ride.lastDirection) {
      ride.lastDirection = direction;
      if (direction !== DIRECTION_NONE) {
        ride.cues += 1;
        this.emit("cue", decision, fix, helmetConnected);
      }
    }
    if (decision.reroute && !ride.rerouting) {
      ride.reroutes += 1;
      this.emit("reroute", decision, fix, helmetConnected);
    }
    ride.rerouting = decision.reroute;
    if (decision.arrived && !ride.arrived) {
      ride.arrived = true;
      this.emit("arrived", decision, fix, helmetConnected);
    }
  }

  addDistance(meters: number): void {
    if (this.ride) this.ride.riddenM += meters;
  }

  finish(reason: RideEndReason): void {
    const ride = this.ride;
    if (!ride) return;
    this.ride = null;
    this.sink.rideFinished({
      rideKey: ride.rideKey,
      reason,
      arrived: ride.arrived,
      riddenM: Math.round(ride.riddenM),
      cues: ride.cues,
      reroutes: ride.reroutes,
    });
  }

  link(kind: LinkEvent["kind"], scanMs: number, message?: string): void {
    this.sink.linkEvent({ session: this.session, kind, scanMs: Math.round(scanMs), message });
  }

  private emit(kind: RideEvent["kind"], decision: Decision, fix: Fix, helmetConnected: boolean): void {
    const ride = this.ride;
    if (!ride) return;
    this.sink.rideEvent({
      rideKey: ride.rideKey,
      kind,
      atMs: this.now() - ride.startedMs,
      direction: decision.cue.direction,
      distanceToManeuverM: round1(decision.distanceToManeuverM),
      speedMps: round1(fix.speedMps),
      crossTrackM: round1(decision.crossTrackM),
      headingSource: decision.headingSource,
      helmetConnected,
    });
  }
}

function round1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : -1;
}
