import { CueEngine, Fix, Route, fixAlong } from "./engine";
import { move } from "./geo";
import { DIRECTION_LEFT, encodeCue } from "./protocol";

export function demoLeftTurn(lat = 37, lng = -122): Route {
  const start: [number, number] = [lat, lng];
  const junction = move(lat, lng, 100, 0);
  const end = move(junction[0], junction[1], 0, -80);
  return {
    steps: [
      { geometry: [start, junction], endManeuver: { kind: "turn", modifier: "left" }, inboundBearingDeg: 0 },
      { geometry: [junction, end], endManeuver: { kind: "arrive", modifier: "straight" }, inboundBearingDeg: 270 },
    ],
  };
}

export function leftCueAtEightyMeters(route = demoLeftTurn()): number {
  const start = route.steps[0].geometry[0];
  const rider = move(start[0], start[1], 80, 0);
  const fix: Fix = { lat: rider[0], lng: rider[1], speedMps: 10, gpsCourseDeg: 0, helmetHeadingDeg: null };
  const decision = new CueEngine(route).update(fix);
  if (decision.cue.direction !== DIRECTION_LEFT) {
    throw new Error("demo rider should get a left cue");
  }
  return encodeCue(decision.cue)[1];
}

export { fixAlong };
