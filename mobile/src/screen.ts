import { Decision, Fix, Route, lookaheadM } from "./engine";
import { distanceM, LatLng, projectOnto } from "./geo";
import { DIRECTION_FRONT, DIRECTION_LEFT, DIRECTION_NONE, DIRECTION_RIGHT, DIRECTION_UTURN, FLAG_OFF_ROUTE } from "./protocol";

const INSTRUCTIONS: Record<string, string> = {
  left: "Turn left",
  right: "Turn right",
  straight: "Continue straight",
  uturn: "Make a U-turn",
};

const HEADING_LABELS = { gps: "GPS course", helmet: "Helmet IMU", none: "No heading" };

export type Motors = { left: boolean; front: boolean; right: boolean };
export type ScreenState = {
  phase: string;
  destinationName: string;
  providerName: string;
  instruction: string;
  metersToJunction: number;
  motors: Motors;
  traveled: LatLng[];
  remaining: LatLng[];
  puck: LatLng | null;
  puckHeadingDeg: number | null;
  headingLabel: string;
  decisionMarker: LatLng | null;
  lookaheadM: number | null;
  bleConnected: boolean;
  headingAgeS: number | null;
  banner: string | null;
  cueDirection: number;
};

const QUIET_MOTORS: Motors = { left: false, front: false, right: false };

export function idleScreen(): ScreenState {
  return {
    phase: "idle",
    destinationName: "",
    providerName: "",
    instruction: "",
    metersToJunction: 0,
    motors: QUIET_MOTORS,
    traveled: [],
    remaining: [],
    puck: null,
    puckHeadingDeg: null,
    headingLabel: "",
    decisionMarker: null,
    lookaheadM: null,
    bleConnected: false,
    headingAgeS: null,
    banner: null,
    cueDirection: DIRECTION_NONE,
  };
}

export class NavSession {
  private state = idleScreen();
  private route: Route | null = null;
  private provider = "";
  private destination = "";
  private phase = "idle";

  screen(): ScreenState {
    return this.state;
  }

  preview(route: Route, providerName: string, destinationName: string): ScreenState {
    if (route.steps.length === 0) throw new Error("route has no usable steps");
    this.route = route;
    this.provider = providerName;
    this.destination = destinationName;
    this.phase = "preview";
    this.state = this.quietState();
    return this.state;
  }

  start(): ScreenState {
    if (this.route === null || this.phase === "idle") throw new Error("preview a route before starting");
    this.phase = "navigating";
    this.state = this.quietState();
    return this.state;
  }

  update(fix: Fix, decision: Decision, bleConnected: boolean, headingAgeS: number | null = null): ScreenState {
    if (this.route === null || (this.phase !== "navigating" && this.phase !== "arrived")) {
      throw new Error("navigation has not started");
    }
    const step = this.route.steps[decision.stepIndex];
    const point: LatLng = [fix.lat, fix.lng];
    const projection = projectOnto(point, step.geometry);
    const [traveled, remaining] = splitRoute(this.route, decision.stepIndex, projection.alongM, projection.snap);
    const direction = decision.cue.direction;
    const banner = decision.reroute ? "Rerouting" : decision.cue.flags & FLAG_OFF_ROUTE ? "Off route" : null;
    this.phase = decision.arrived ? "arrived" : "navigating";
    this.state = {
      phase: this.phase,
      destinationName: this.destination,
      providerName: this.provider,
      instruction: instructionFor(step.endManeuver),
      metersToJunction: Math.round(decision.distanceToManeuverM),
      motors: motorsFor(direction),
      traveled,
      remaining,
      puck: point,
      puckHeadingDeg: decision.headingDeg,
      headingLabel: HEADING_LABELS[decision.headingSource],
      decisionMarker: step.geometry[step.geometry.length - 1],
      lookaheadM: lookaheadM(fix.speedMps),
      bleConnected,
      headingAgeS: decision.headingSource === "helmet" ? headingAgeS : null,
      banner,
      cueDirection: direction,
    };
    return this.state;
  }

  private quietState(): ScreenState {
    const step = this.route!.steps[0];
    return {
      ...idleScreen(),
      phase: this.phase,
      destinationName: this.destination,
      providerName: this.provider,
      instruction: instructionFor(step.endManeuver),
      metersToJunction: Math.round(pathLength(step.geometry)),
      remaining: join(this.route!.steps.map((item) => item.geometry)),
      decisionMarker: step.geometry[step.geometry.length - 1],
    };
  }
}

function instructionFor(maneuver: { kind: string; modifier: string }): string {
  if (maneuver.kind === "arrive") return "Arrive";
  if (maneuver.kind === "depart") return "Depart";
  return INSTRUCTIONS[maneuver.modifier];
}

function motorsFor(direction: number): Motors {
  return {
    left: direction === DIRECTION_LEFT || direction === DIRECTION_UTURN,
    front: direction === DIRECTION_FRONT,
    right: direction === DIRECTION_RIGHT || direction === DIRECTION_UTURN,
  };
}

function splitRoute(route: Route, stepIndex: number, alongM: number, snap: LatLng): [LatLng[], LatLng[]] {
  const traveled: LatLng[] = [];
  for (const earlier of route.steps.slice(0, stepIndex)) extend(traveled, earlier.geometry);
  const [prefix, suffix] = splitStep(route.steps[stepIndex].geometry, alongM, snap);
  extend(traveled, prefix);
  const remaining = [snap];
  extend(remaining, suffix);
  for (const later of route.steps.slice(stepIndex + 1)) extend(remaining, later.geometry);
  return [traveled, remaining];
}

function splitStep(geometry: LatLng[], alongM: number, snap: LatLng): [LatLng[], LatLng[]] {
  if (alongM <= 0.05) return [[snap], geometry.filter((point) => point !== snap)];
  const prefix: LatLng[] = [geometry[0]];
  let walked = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const end = geometry[index];
    const length = distanceM(geometry[index - 1], end);
    if (walked + length <= alongM + 0.05) {
      walked += length;
      if (end !== prefix[prefix.length - 1]) prefix.push(end);
      continue;
    }
    if (snap !== prefix[prefix.length - 1]) prefix.push(snap);
    return [prefix, geometry.slice(index).filter((point) => point !== snap)];
  }
  if (snap !== prefix[prefix.length - 1]) prefix.push(snap);
  return [prefix, []];
}

function join(geometries: LatLng[][]): LatLng[] {
  const points: LatLng[] = [];
  for (const geometry of geometries) extend(points, geometry);
  return points;
}

function extend(points: LatLng[], extra: readonly LatLng[]): void {
  for (const point of extra) {
    const last = points[points.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
  }
}

function pathLength(geometry: LatLng[]): number {
  let total = 0;
  for (let index = 0; index < geometry.length - 1; index += 1) total += distanceM(geometry[index], geometry[index + 1]);
  return total;
}
