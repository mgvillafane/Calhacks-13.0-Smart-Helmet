import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoLeftTurn, leftCueAtEightyMeters } from "./demo";
import { gpsStatus, readingFromCoords } from "./gps";
import { destinationPoint, nearestPlaces, osmBikeRouteRequest, placeChoices, routeFromOsrm } from "./routing";
import { planTiles, mercatorTile } from "./tiles";
import { CueEngine, fixAlong } from "./engine";
import { debugStopCue, debugTurnCue, micLevel } from "./debug";
import { advertisementFromScan, HelmetLink } from "./link";
import { helmetScanPermissions } from "./scanPermissions";
import {
  AUDIO_CHARACTERISTIC_UUID,
  AUDIO_MAX_SAMPLES,
  BUTTON_TALK,
  DIRECTION_FRONT,
  DIRECTION_LEFT,
  DIRECTION_RIGHT,
  HELMET_STATE_CHARACTERISTIC_UUID,
  decodeAudioPacket,
  encodeAudioPacket,
  encodeCue,
  encodeSensorSample,
  SENSOR_CHARACTERISTIC_UUID,
  SERVICE_UUID,
  ulawDecode,
  ulawEncode,
} from "./protocol";
import { NavSession } from "./screen";
import { RideEvent, RideFinish, RideRecorder, RideStart } from "./telemetry";
import { VoiceAgent } from "./voiceAgent";
import {
  VOICE_TOOL_NAMES,
  amplifyPcm16,
  base64ToBytes,
  bytesToBase64,
  commandFromCall,
  pcmDurationMs,
  prepareMicPcm,
  voiceConnectOptions,
  voiceKeyConfigured,
  voiceSessionUpdate,
  wavFromPcm16,
  whatsNextResult,
} from "./voice";

describe("phone navigator", () => {
  it("encodes a sensor sample the debug page can read", () => {
    const bytes = encodeSensorSample({
      imuOk: true,
      micOk: true,
      axMg: 1000,
      ayMg: -250,
      azMg: 980,
      gxDps10: 15,
      gyDps10: 0,
      gzDps10: -20,
      micPeak: 12000,
    });
    assert.deepEqual(
      [...bytes],
      [0x01, 0x03, 0xe8, 0x03, 0x06, 0xff, 0xd4, 0x03, 0x0f, 0x00, 0x00, 0x00, 0xec, 0xff, 0xe0, 0x2e, 0x00, 0x00, 0x00, 0x00],
    );
    assert.equal(debugTurnCue(DIRECTION_LEFT).direction, DIRECTION_LEFT);
    assert.equal(debugTurnCue(DIRECTION_FRONT).direction, DIRECTION_FRONT);
    assert.equal(debugTurnCue(DIRECTION_RIGHT).intensity, 160);
    assert.equal(debugStopCue().direction, 0);
    assert.equal(micLevel(16384) > 0.4 && micLevel(16384) < 0.6, true);
  });

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

  it("logs the engine's cue once per change and totals the ride", () => {
    const route = demoLeftTurn();
    const engine = new CueEngine(route);
    const started: RideStart[] = [];
    const events: RideEvent[] = [];
    const finished: RideFinish[] = [];
    let clock = 1000;
    const recorder = new RideRecorder(
      {
        rideStarted: (ride) => started.push(ride),
        rideEvent: (event) => events.push(event),
        rideFinished: (finish) => finished.push(finish),
        linkEvent: () => {},
      },
      "s1",
      () => clock,
    );
    recorder.begin({ kind: "demo", provider: "demo", vehicle: "bicycle", route, helmetConnected: true });
    for (const meters of [0, 40, 80, 82, 84]) {
      clock += 500;
      const fix = fixAlong(route, meters, 10);
      const decision = engine.update(fix);
      recorder.addDistance(2);
      recorder.observe(decision, fix, true);
    }
    recorder.finish("ended");
    recorder.finish("ended");

    assert.equal(started.length, 1);
    assert.equal(started[0].rideKey, "s1-1");
    assert.ok(started[0].routeM > 100);
    const cues = events.filter((event) => event.kind === "cue");
    assert.equal(cues.length, 1);
    assert.equal(cues[0].direction, DIRECTION_LEFT);
    assert.equal(finished.length, 1);
    assert.equal(finished[0].cues, 1);
    assert.equal(finished[0].riddenM, 10);
    assert.equal(finished[0].reason, "ended");
  });

  it("scans with nearby devices on Android 12 and location before that", () => {
    assert.equal(helmetScanPermissions(31), "nearby");
    assert.equal(helmetScanPermissions(36), "nearby");
    assert.equal(helmetScanPermissions(30), "location");
  });

  it("recognizes the helmet from its name or service uuid", () => {
    assert.deepEqual(advertisementFromScan({ id: "bb", name: "SmartHelmet", localName: null, serviceUUIDs: null }), {
      name: "SmartHelmet",
      address: "bb",
    });
    assert.equal(advertisementFromScan({ id: "aa", name: "Headphones", localName: null, serviceUUIDs: null }), null);
    assert.deepEqual(
      advertisementFromScan({ id: "cc", name: null, localName: null, serviceUUIDs: [SERVICE_UUID.toUpperCase()] }),
      { name: "SmartHelmet", address: "cc" },
    );
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

  it("keeps the latest helmet sensor notify", async () => {
    const sample = encodeSensorSample({
      imuOk: true,
      micOk: true,
      axMg: 1000,
      ayMg: -250,
      azMg: 980,
      gxDps10: 15,
      gyDps10: 0,
      gzDps10: -20,
      micPeak: 12000,
    });
    let packets = [sample];
    const link = new HelmetLink({
      async scan() {
        return [{ name: "SmartHelmet", address: "bb" }];
      },
      async connect() {},
      async disconnect() {},
      async subscribe() {},
      async writeWithoutResponse() {},
      async takeNotifications(uuid) {
        if (uuid !== SENSOR_CHARACTERISTIC_UUID) return [];
        const ready = packets;
        packets = [];
        return ready;
      },
    });
    await link.connect({ name: "SmartHelmet", address: "bb" });
    await link.poll(0);
    assert.equal(link.sensors?.axMg, 1000);
    assert.equal(link.sensors?.micPeak, 12000);
  });

  it("decodes helmet mic audio and the talk switch", async () => {
    assert.deepEqual([0, 1000, -1000, 32767, -32768].map(ulawEncode), [0xff, 0xce, 0x4e, 0x80, 0x00]);
    assert.deepEqual([0xff, 0xce, 0x4e, 0x80, 0x00].map(ulawDecode), [0, 988, -988, 32124, -32124]);
    assert.deepEqual([...encodeAudioPacket(5, [0, 1000, -1000])], [0x01, 0x05, 0xff, 0xce, 0x4e]);
    const decoded = decodeAudioPacket(Uint8Array.from([0x01, 0x05, 0xff, 0xce, 0x4e]));
    assert.equal(decoded.sequence, 5);
    assert.deepEqual([...new Int16Array(decoded.pcm.buffer)], [0, 988, -988]);
    assert.throws(() => decodeAudioPacket(Uint8Array.from([0x01, 0x00])));
    assert.throws(() => decodeAudioPacket(Uint8Array.from([0x02, 0x00, 0xff])));
    assert.equal(encodeAudioPacket(255, new Array(AUDIO_MAX_SAMPLES).fill(0)).length, 242);

    let audio = [encodeAudioPacket(254, [1000, 1000]), encodeAudioPacket(255, [1000, 1000]), encodeAudioPacket(1, [-1000, -1000])];
    let state = [Uint8Array.from([0x00, 0x00, 0x01, BUTTON_TALK])];
    const link = new HelmetLink({
      async scan() {
        return [];
      },
      async connect() {},
      async disconnect() {},
      async subscribe() {},
      async writeWithoutResponse() {},
      async takeNotifications(uuid) {
        if (uuid === AUDIO_CHARACTERISTIC_UUID) {
          const ready = audio;
          audio = [];
          return ready;
        }
        if (uuid === HELMET_STATE_CHARACTERISTIC_UUID) {
          const ready = state;
          state = [];
          return ready;
        }
        return [];
      },
    });
    await link.connect({ name: "SmartHelmet", address: "bb" });
    await link.poll(0);
    assert.equal(link.talk, true);
    assert.equal(link.buttonPressed, false);
    const louder = amplifyPcm16(Uint8Array.of(0xe8, 0x03, 0x20, 0x4e), 4);
    assert.equal(new DataView(louder.buffer).getInt16(0, true), 4000);
    assert.equal(new DataView(louder.buffer).getInt16(2, true), 32767);
    const pcm = new Int16Array(link.takeAudio().buffer);
    assert.deepEqual([...pcm], [988, 988, 988, 988, 0, 0, -988, -988]);
    assert.equal(link.takeAudio().length, 0);
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
    const choices = placeChoices([
      { name: "Sather Gate", display_name: "Sather Gate, Berkeley, California", lat: "37.8702", lon: "-122.2595" },
      { name: "Sather Tower", display_name: "Sather Tower, Berkeley, California", lat: "37.8722", lon: "-122.2578" },
      { lat: "nope", lon: "-122.25" },
    ]);
    assert.equal(choices.length, 2);
    assert.equal(choices[0].name, "Sather Gate");
    assert.equal(choices[1].detail, "Sather Tower, Berkeley, California");
    const nearest = nearestPlaces(choices, [37.8722, -122.2578]);
    assert.equal(nearest[0].name, "Sather Tower");
    assert.match(nearest[0].detail, /^0 m · Sather Tower/);
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

  it("asks Grok Voice for route commands and leaves the turn to the cue engine", async () => {
    assert.equal(voiceKeyConfigured("  "), false);
    assert.equal(voiceKeyConfigured("xai-test"), true);
    assert.deepEqual(voiceConnectOptions("xai-test").headers, { Authorization: "Bearer xai-test" });
    assert.deepEqual(voiceConnectOptions("xai-client-secret.abc").protocols, ["xai-client-secret.abc"]);
    const session = voiceSessionUpdate().session as { instructions: string; tools: { name: string }[] };
    assert.match(session.instructions, /cue engine already chose the turn/i);
    assert.deepEqual(session.tools.map((item) => item.name), [...VOICE_TOOL_NAMES]);
    assert.equal(commandFromCall("set_direction", "{\"direction\":\"left\"}"), null);
    assert.deepEqual(commandFromCall("navigate_to", "{\"query\":\"Sather Gate\"}"), { name: "navigate_to", query: "Sather Gate" });
    assert.equal(whatsNextResult({ phase: "navigating", destinationName: "Sather Gate", instruction: "Turn left", metersToJunction: 40 }), JSON.stringify({
      phase: "navigating",
      destination: "Sather Gate",
      instruction: "Turn left",
      meters: 40,
      say: "Turn left. 40 meters.",
    }));

    const pcm = pcm16([1, -2]);
    assert.deepEqual([...base64ToBytes(bytesToBase64(pcm))], [...pcm]);
    assert.deepEqual([...prepareMicPcm(pcm16([2, 4, 6, 8]), 2, 8000)], [...pcm16([3, 3, 7, 7])]);
    const wav = wavFromPcm16(pcm, 16000);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(wav[24], 0x80);
    assert.equal(wav[25], 0x3e);
    assert.equal(pcmDurationMs(pcm.length), 1);

    const sent: string[] = [];
    const executed: string[] = [];
    const played: Uint8Array[] = [];
    const agent = new VoiceAgent(
      { send: (data) => sent.push(data), close() {} },
      async (command) => {
        executed.push(command.name);
        return JSON.stringify({ status: "riding", place: "Sather Gate" });
      },
      async (clip) => {
        played.push(clip);
      },
    );
    agent.start();
    agent.sendPcm(pcm);
    agent.finishUtterance();
    assert.match(sent[0], /navigate_to/);
    assert.match(sent[1], /input_audio_buffer.append/);
    assert.match(sent[2], /input_audio_buffer.commit/);
    assert.match(sent[3], /response.create/);

    const heard = await agent.handleMessage(JSON.stringify({
      type: "conversation.item.input_audio_transcription.updated",
      transcript: "take me to Sather Gate",
    }));
    assert.equal(heard?.text, "take me to Sather Gate");
    await agent.handleMessage(JSON.stringify({ type: "response.created" }));
    await agent.handleMessage(JSON.stringify({ type: "response.output_audio.delta", delta: bytesToBase64(pcm) }));
    await agent.handleMessage(JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "navigate_to",
      call_id: "call-1",
      arguments: "{\"query\":\"Sather Gate\"}",
    }));
    await agent.handleMessage(JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "set_direction",
      call_id: "call-2",
      arguments: "{\"direction\":\"left\"}",
    }));
    await agent.handleMessage(JSON.stringify({ type: "response.done" }));
    assert.deepEqual(executed, ["navigate_to"]);
    assert.equal(String.fromCharCode(...played[0].slice(0, 4)), "RIFF");
    const outputs = sent.slice(4).map((line) => JSON.parse(line) as { type: string; item?: { call_id?: string; output?: string } });
    assert.equal(outputs.filter((line) => line.type === "response.create").length, 1);
    assert.match(outputs.find((line) => line.item?.call_id === "call-2")?.item?.output ?? "", /cue engine chooses the turn/);
  });
});

function pcm16(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return out;
}
