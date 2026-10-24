import { bearingDeg, EARTH_RADIUS_M, LatLng, pointAlong, projectOnto, wrapSignedDeg } from "./geo";
import {
  Cue,
  DIRECTION_FRONT,
  DIRECTION_LEFT,
  DIRECTION_NONE,
  DIRECTION_RIGHT,
  DIRECTION_UTURN,
  FLAG_ARRIVED,
  FLAG_OFF_ROUTE,
  FLAG_REROUTING,
} from "./protocol";

export const OFF_ROUTE_M = 30;
export const OFF_ROUTE_FIXES = 3;
export const LOOKAHEAD_SECONDS = 5;
export const LOOKAHEAD_MIN_M = 25;
export const LOOKAHEAD_MAX_M = 80;
export const GPS_COURSE_MIN_SPEED_M_S = 2;
export const PROVIDER_TRUST_DEG = 45;
export const FRONT_BUCKET_DEG = 30;
export const UTURN_BUCKET_DEG = 150;
export const BEYOND_JUNCTION_M = 15;
export const CUE_INTENSITY = 160;
export const PULSE_FAR_MS = 800;
export const PULSE_NEAR_MS = 200;

export type Maneuver = { kind: string; modifier: string };
export type Step = { geometry: LatLng[]; endManeuver: Maneuver; inboundBearingDeg: number };
export type Route = { steps: Step[] };
export type HeadingSource = "gps" | "helmet" | "none";

export type Fix = {
  lat: number;
  lng: number;
  speedMps: number;
  gpsCourseDeg: number | null;
  helmetHeadingDeg: number | null;
};

export type Decision = {
  cue: Cue;
  stepIndex: number;
  distanceToManeuverM: number;
  crossTrackM: number;
  headingDeg: number | null;
  headingSource: HeadingSource;
  reroute: boolean;
  arrived: boolean;
};

export class CueEngine {
  route: Route;
  private stepIndex = 0;
  private offRouteCount = 0;
  private arrived = false;

  constructor(route: Route) {
    this.route = route;
  }

  replaceRoute(route: Route): void {
    this.route = route;
    this.stepIndex = 0;
    this.offRouteCount = 0;
    this.arrived = false;
  }

  update(fix: Fix): Decision {
    if (this.arrived) {
      const projection = this.locate(fix).projection;
      return this.decision(fix, projection, quiet(projection.remainingM, 0), true, false);
    }
    const { step, projection } = this.locate(fix);
    const [heading] = selectHeading(fix);
    if (projection.crossTrackM > OFF_ROUTE_M) {
      this.offRouteCount += 1;
      const reroute = this.offRouteCount >= OFF_ROUTE_FIXES;
      const flags = FLAG_OFF_ROUTE | (reroute ? FLAG_REROUTING : 0);
      return this.decision(fix, projection, quiet(projection.remainingM, flags), false, reroute);
    }
    this.offRouteCount = 0;
    const window = lookaheadM(fix.speedMps);
    if (step.endManeuver.kind === "depart" || projection.remainingM >= window) {
      return this.decision(fix, projection, quiet(projection.remainingM, 0), false, false);
    }
    if (step.endManeuver.kind === "arrive") {
      this.arrived = true;
      const cue: Cue = {
        direction: DIRECTION_FRONT,
        intensity: CUE_INTENSITY,
        pulsePeriodMs: PULSE_NEAR_MS,
        distanceM: meters(projection.remainingM),
        flags: FLAG_ARRIVED,
      };
      return this.decision(fix, projection, cue, true, false);
    }
    if (heading === null) {
      return this.decision(fix, projection, quiet(projection.remainingM, 0), false, false);
    }
    const angle = this.turnAngle(step, projection, heading);
    const period = PULSE_NEAR_MS + (PULSE_FAR_MS - PULSE_NEAR_MS) * (projection.remainingM / window);
    const cue: Cue = {
      direction: directionForAngle(angle),
      intensity: CUE_INTENSITY,
      pulsePeriodMs: Math.round(period),
      distanceM: meters(projection.remainingM),
      flags: 0,
    };
    return this.decision(fix, projection, cue, false, false);
  }

  private decision(
    fix: Fix,
    projection: { remainingM: number; crossTrackM: number },
    cue: Cue,
    arrived: boolean,
    reroute: boolean,
  ): Decision {
    const [heading, source] = selectHeading(fix);
    return {
      cue,
      stepIndex: this.stepIndex,
      distanceToManeuverM: projection.remainingM,
      crossTrackM: projection.crossTrackM,
      headingDeg: heading,
      headingSource: source,
      reroute,
      arrived,
    };
  }

  private locate(fix: Fix): { step: Step; projection: ReturnType<typeof projectOnto> } {
    const point: LatLng = [fix.lat, fix.lng];
    while (true) {
      const step = this.route.steps[this.stepIndex];
      const projection = projectOnto(point, step.geometry);
      const hasNext = this.stepIndex + 1 < this.route.steps.length;
      if (projection.remainingM <= 1 && hasNext) {
        this.stepIndex += 1;
        continue;
      }
      return { step, projection };
    }
  }

  private turnAngle(step: Step, projection: { snap: LatLng }, heading: number): number {
    const modifier = step.endManeuver.modifier;
    if (["left", "right", "straight", "uturn"].includes(modifier) && providerTrusted(heading, step.inboundBearingDeg)) {
      return modifierAngleDeg(modifier);
    }
    const target = this.pointBeyondJunction(step);
    return wrapSignedDeg(bearingDeg(projection.snap, target) - heading);
  }

  private pointBeyondJunction(step: Step): LatLng {
    if (this.stepIndex + 1 < this.route.steps.length) {
      return pointAlong(this.route.steps[this.stepIndex + 1].geometry, BEYOND_JUNCTION_M);
    }
    const geometry = step.geometry;
    const endBearing = bearingDeg(geometry[geometry.length - 2], geometry[geometry.length - 1]);
    return offset(geometry[geometry.length - 1], endBearing, BEYOND_JUNCTION_M);
  }
}

export function lookaheadM(speedMps: number): number {
  const raw = speedMps * LOOKAHEAD_SECONDS;
  if (raw < LOOKAHEAD_MIN_M) return LOOKAHEAD_MIN_M;
  if (raw > LOOKAHEAD_MAX_M) return LOOKAHEAD_MAX_M;
  return raw;
}

export function directionForAngle(angleDeg: number): number {
  const magnitude = Math.abs(angleDeg);
  if (magnitude <= FRONT_BUCKET_DEG) return DIRECTION_FRONT;
  if (magnitude >= UTURN_BUCKET_DEG) return DIRECTION_UTURN;
  if (angleDeg < 0) return DIRECTION_LEFT;
  return DIRECTION_RIGHT;
}

export function modifierAngleDeg(modifier: string): number {
  const angles: Record<string, number> = { left: -90, right: 90, straight: 0, uturn: 180 };
  if (!(modifier in angles)) throw new Error(`unknown modifier ${modifier}`);
  return angles[modifier];
}

export function providerTrusted(headingDeg: number, inboundBearingDeg: number): boolean {
  return Math.abs(wrapSignedDeg(headingDeg - inboundBearingDeg)) <= PROVIDER_TRUST_DEG;
}

export function fixAlong(route: Route, distance: number, speedMps: number): Fix {
  const polyline = routePolyline(route);
  const point = pointAlong(polyline, distance);
  const earlier = pointAlong(polyline, Math.max(0, distance - 1));
  const course = distance <= 0 ? bearingDeg(polyline[0], polyline[Math.min(1, polyline.length - 1)]) : bearingDeg(earlier, point);
  return { lat: point[0], lng: point[1], speedMps, gpsCourseDeg: course, helmetHeadingDeg: null };
}

function selectHeading(fix: Fix): [number | null, HeadingSource] {
  if (fix.speedMps >= GPS_COURSE_MIN_SPEED_M_S && fix.gpsCourseDeg !== null) {
    return [fix.gpsCourseDeg, "gps"];
  }
  if (fix.helmetHeadingDeg !== null) return [fix.helmetHeadingDeg, "helmet"];
  return [null, "none"];
}

function meters(distance: number): number {
  return Math.round(Math.max(0, distance));
}

function quiet(remainingM: number, flags: number): Cue {
  return { direction: DIRECTION_NONE, intensity: 0, pulsePeriodMs: 0, distanceM: meters(remainingM), flags };
}

function routePolyline(route: Route): LatLng[] {
  const points: LatLng[] = [];
  for (const step of route.steps) {
    points.push(...(points.length === 0 ? step.geometry : step.geometry.slice(1)));
  }
  return points;
}

function offset(origin: LatLng, bearing: number, metersOut: number): LatLng {
  const north = Math.cos((bearing * Math.PI) / 180) * metersOut;
  const east = Math.sin((bearing * Math.PI) / 180) * metersOut;
  const lat = origin[0] + north / ((EARTH_RADIUS_M * Math.PI) / 180);
  const lng = origin[1] + east / (((EARTH_RADIUS_M * Math.PI) / 180) * Math.cos((origin[0] * Math.PI) / 180));
  return [lat, lng];
}
