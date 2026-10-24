import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoLeftTurn, leftCueAtEightyMeters } from "./demo";
import { gpsStatus, readingFromCoords } from "./gps";
import { destinationPoint, osmBikeRouteRequest, routeFromOsrm } from "./routing";
import { planTiles, mercatorTile } from "./tiles";
import { CueEngine, fixAlong } from "./engine";
import { HelmetLink } from "./link";
import { DIRECTION_LEFT, encodeCue } from "./protocol";
import { NavSession } from "./screen";

describe("phone navigator", () => {
  it("encodes a left cue the helmet can play", () => {
    const bytes = encodeCue({ direction: DIRECTION_LEFT, intensity: 180, pulsePeriodMs: 800, distanceM: 40, flags: 0 });
    assert.deepEqual([...bytes], [0x01, 0x01, 0xb4, 0x20, 0x03, 0x28, 0x00, 0x00]);
  });

  it("turns the demo rider left and shows that on the screen", () => {
    assert.equal(leftCueAtEightyMeters(), DIRECTION_LEFT);
    const route = demoLeftTurn();
    const engine = new CueEngine(route);
    const session = new NavSession();
    session.preview(route, "demo", "Left turn");
    session.start();
    const fix = fixAlong(route, 80, 10);
    const state = session.update(fix, engine.update(fix), false);
    assert.equal(state.instruction, "Turn left");
    assert.equal(state.motors.left, true);
    assert.equal(state.motors.front, false);
    assert.equal(state.cueDirection, DIRECTION_LEFT);
  });

  it("connects only to the exact SmartHelmet name", async () => {
    const writes: Uint8Array[] = [];
    const link = new HelmetLink({
      async scan() {
        return [
          { name: "Headphones", address: "aa" },
          { name: "SmartHelmet", address: "bb" },
        ];
      },
      async connect() {},
      async disconnect() {},
      async subscribe() {},
      async writeWithoutResponse(_uuid, payload) {
        writes.push(payload);
      },
      async takeNotifications() {
        return [];
      },
    });
    const found = await link.scan();
    assert.equal(found?.address, "bb");
    await link.connect(found!);
    const cue = { direction: DIRECTION_LEFT, intensity: 160, pulsePeriodMs: 500, distanceM: 20, flags: 0 };
    await link.send(cue, 0);
    await link.send(cue, 0.2);
    assert.equal(writes.length, 1);
    assert.deepEqual([...writes[0]], [...encodeCue(cue)]);
  });

  it("shows a live GPS fix and explains a missing one", () => {
    const reading = readingFromCoords({ latitude: 37.87, longitude: -122.27, accuracy: 8.4, speed: 3.2, heading: 12 });
    assert.equal(gpsStatus(reading, "granted"), "GPS 37.87000, -122.27000 · 8 m accuracy · 3.2 m/s · 12°");
    assert.equal(readingFromCoords({ latitude: 1, longitude: 2, speed: -1, heading: -1 }).courseDeg, null);
    assert.match(gpsStatus(null, "off"), /location is off/i);
    assert.match(gpsStatus(null, "denied"), /permission was denied/i);
  });

  it("routes a bike trip from OpenStreetMap without an API key", () => {
    const request = osmBikeRouteRequest([37.872, -122.259], [37.871, -122.258]);
    assert.equal(request.method, "GET");
    assert.match(request.url, /routed-bike\/route\/v1\/bike\/-122\.259,37\.872;-122\.258,37\.871/);
    assert.equal(request.query.steps, "true");
    assert.equal(destinationPoint("37.87, -122.27")?.[0], 37.87);
    assert.equal(destinationPoint("Sather Gate"), null);
    const route = routeFromOsrm({
      code: "Ok",
      routes: [{
        legs: [{
          steps: [
            { maneuver: { type: "depart", bearing_before: 0 }, geometry: { coordinates: [[-122.27, 37.87], [-122.27, 37.871]] } },
            { maneuver: { type: "turn", modifier: "left", bearing_before: 0 }, geometry: { coordinates: [[-122.27, 37.871], [-122.271, 37.871]] } },
            { maneuver: { type: "arrive", bearing_before: 270 }, geometry: { coordinates: [[-122.271, 37.871], [-122.271, 37.871]] } },
          ],
        }],
      }],
    });
    assert.equal(route.steps[0].endManeuver.modifier, "left");
    assert.equal(route.steps[0].endManeuver.kind, "turn");
    const plan = planTiles([[37.87, -122.27], [37.871, -122.271]]);
    assert.ok(plan.tiles.length > 0 && plan.tiles.length <= 16);
    assert.ok(Math.abs(mercatorTile(0, 0, 0)[0] - 0.5) < 1e-9);
  });
});
