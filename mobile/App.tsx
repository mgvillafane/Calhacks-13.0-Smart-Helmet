import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { demoLeftTurn } from "./src/demo";
import { CueEngine, Fix, Route, fixAlong } from "./src/engine";
import { GpsReading, gpsStatus, readingFromCoords } from "./src/gps";
import { HelmetLink } from "./src/link";
import { createPhoneRadio } from "./src/radio";
import { geocodePlace, routeBetween } from "./src/routing";
import { NavSession, ScreenState } from "./src/screen";
import { StreetMap } from "./src/StreetMap";

const DEMO_SPEED_MPS = 8;

export default function App() {
  const engineRef = useRef(new CueEngine(demoLeftTurn(37.8703, -122.2595)));
  const sessionRef = useRef(new NavSession());
  const linkRef = useRef<HelmetLink | null>(null);
  const distanceRef = useRef(0);
  const gpsRef = useRef<GpsReading | null>(null);
  const ridingRef = useRef(false);
  const [screen, setScreen] = useState<ScreenState>(() => sessionRef.current.preview(engineRef.current.route, "demo", "Left turn"));
  const [playing, setPlaying] = useState(false);
  const [riding, setRiding] = useState(false);
  const [gpsMessage, setGpsMessage] = useState(gpsStatus(null, "unknown"));
  const [bleMessage, setBleMessage] = useState("Helmet not connected");
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState("Demo route is ready. Play it indoors, or ride it with GPS.");

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      distanceRef.current += DEMO_SPEED_MPS * 0.2;
      const fix = fixAlong(engineRef.current.route, distanceRef.current, DEMO_SPEED_MPS);
      void publish(fix);
      if (distanceRef.current >= 180) setPlaying(false);
    }, 200);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    void (async () => {
      try {
        const servicesOn = await Location.hasServicesEnabledAsync();
        if (!servicesOn) {
          if (!cancelled) setGpsMessage(gpsStatus(null, "off"));
          return;
        }
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          if (!cancelled) setGpsMessage(gpsStatus(null, "denied"));
          return;
        }
        const last = await Location.getLastKnownPositionAsync();
        if (last && !cancelled) acceptGps(last);
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (position) => {
            if (!cancelled) acceptGps(position);
          },
        );
        if (cancelled) subscription.remove();
      } catch (error) {
        if (!cancelled) setGpsMessage(error instanceof Error ? error.message : "GPS failed");
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  function acceptGps(position: Location.LocationObject): void {
    const reading = readingFromCoords(position.coords);
    gpsRef.current = reading;
    setGpsMessage(gpsStatus(reading, "granted"));
    if (!ridingRef.current) return;
    void publish({
      lat: reading.lat,
      lng: reading.lng,
      speedMps: reading.speedMps,
      gpsCourseDeg: reading.courseDeg,
      helmetHeadingDeg: reading.speedMps < 2 ? linkRef.current?.headingDeg ?? null : null,
    });
  }

  function setRide(next: boolean): void {
    ridingRef.current = next;
    setRiding(next);
  }

  async function publish(fix: Fix): Promise<void> {
    const link = linkRef.current;
    const now = Date.now() / 1000;
    if (link?.connected) await link.poll(now);
    const decision = engineRef.current.update(fix);
    setScreen(sessionRef.current.update(fix, decision, Boolean(link?.connected), link?.headingAgeS ?? null));
    if (link?.connected) await link.send(decision.cue, now);
  }

  function useRoute(route: Route, provider: string, name: string): void {
    setPlaying(false);
    setRide(false);
    distanceRef.current = 0;
    engineRef.current = new CueEngine(route);
    sessionRef.current = new NavSession();
    setScreen(sessionRef.current.preview(route, provider, name));
    setStatus(`${name} is ready.`);
  }

  async function connectHelmet(): Promise<void> {
    setBleMessage("Looking for SmartHelmet…");
    try {
      if (linkRef.current?.connected) await linkRef.current.disconnect();
      const radio = await createPhoneRadio();
      const link = new HelmetLink(radio);
      const found = await link.scan();
      if (!found) {
        setBleMessage("SmartHelmet was not found. The helmet must be advertising that exact name.");
        return;
      }
      await link.connect(found);
      linkRef.current = link;
      setBleMessage("Connected to SmartHelmet");
      setScreen((current: ScreenState) => ({ ...current, bleConnected: true }));
    } catch (error) {
      setBleMessage(error instanceof Error ? error.message : "Bluetooth failed");
    }
  }

  async function currentGps(): Promise<GpsReading | null> {
    if (gpsRef.current) return gpsRef.current;
    const servicesOn = await Location.hasServicesEnabledAsync();
    if (!servicesOn) {
      setGpsMessage(gpsStatus(null, "off"));
      return null;
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setGpsMessage(gpsStatus(null, "denied"));
      return null;
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: true });
      const reading = readingFromCoords(position.coords);
      gpsRef.current = reading;
      setGpsMessage(gpsStatus(reading, "granted"));
      return reading;
    } catch (error) {
      setGpsMessage(error instanceof Error ? error.message : "Could not read GPS.");
      return null;
    }
  }

  async function rideHere(): Promise<void> {
    const here = await currentGps();
    if (!here) return;
    useRoute(demoLeftTurn(here.lat, here.lng), "demo", "Left turn from here");
    sessionRef.current.start();
    setScreen(sessionRef.current.screen());
    setRide(true);
    void publish({
      lat: here.lat,
      lng: here.lng,
      speedMps: here.speedMps,
      gpsCourseDeg: here.courseDeg,
      helmetHeadingDeg: here.speedMps < 2 ? linkRef.current?.headingDeg ?? null : null,
    });
    setStatus("Ride north, then left. Your GPS position is on the map.");
  }

  async function fetchStreetRoute(): Promise<void> {
    const here = await currentGps();
    if (!here) return;
    try {
      const place = await geocodePlace(destination);
      const result = await routeBetween([here.lat, here.lng], place.point, process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "");
      useRoute(result.route, result.provider, place.name);
      sessionRef.current.start();
      setScreen(sessionRef.current.screen());
      setRide(true);
      void publish({
        lat: here.lat,
        lng: here.lng,
        speedMps: here.speedMps,
        gpsCourseDeg: here.courseDeg,
        helmetHeadingDeg: here.speedMps < 2 ? linkRef.current?.headingDeg ?? null : null,
      });
      setStatus(`Following the ${result.provider} bike route to ${place.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not fetch a route.");
    }
  }

  function playDemo(): void {
    setRide(false);
    if (screen.phase === "preview" || screen.phase === "idle") {
      sessionRef.current.start();
      setScreen(sessionRef.current.screen());
    }
    distanceRef.current = 0;
    engineRef.current = new CueEngine(engineRef.current.route);
    setPlaying(true);
    setStatus("Playing the left turn at 8 m/s.");
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{screen.instruction || "Smart Helmet"}</Text>
      <Text style={styles.meta}>
        {screen.destinationName || "No route"} · {screen.phase} · {riding ? "following GPS" : "GPS idle"} · {screen.metersToJunction} m
      </Text>
      <View style={styles.mapWrap}>
        <StreetMap screen={screen} />
      </View>
      <View style={styles.motors}>
        <Motor label="Left" on={screen.motors.left} />
        <Motor label="Front" on={screen.motors.front} />
        <Motor label="Right" on={screen.motors.right} />
      </View>
      {screen.banner ? <Text style={styles.banner}>{screen.banner}</Text> : null}
      <Text style={styles.gps}>{gpsMessage}</Text>
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.status}>{bleMessage}</Text>
      <View style={styles.row}>
        <AppButton label={playing ? "Pause" : "Play demo"} onPress={() => (playing ? setPlaying(false) : playDemo())} />
        <AppButton label="Ride here" onPress={() => void rideHere()} />
        <AppButton label="Connect" onPress={() => void connectHelmet()} />
      </View>
      <TextInput style={styles.input} value={destination} onChangeText={setDestination} placeholder="Place name or latitude, longitude" placeholderTextColor="#8b93a7" autoCapitalize="words" />
      <AppButton label="Route from here" onPress={() => void fetchStreetRoute()} />
    </View>
  );
}

function Motor({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={[styles.motor, on ? styles.motorOn : null]}>
      <Text style={styles.motorText}>{label}</Text>
    </View>
  );
}

function AppButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#10141c", padding: 16, paddingTop: 54, gap: 8 },
  title: { color: "#f0f3f8", fontSize: 22, fontWeight: "700" },
  meta: { color: "#b7c0d0", fontSize: 14 },
  mapWrap: { flex: 1, minHeight: 320, borderRadius: 12, overflow: "hidden" },
  motors: { flexDirection: "row", gap: 8 },
  motor: { flex: 1, borderRadius: 10, padding: 12, backgroundColor: "#242b3a" },
  motorOn: { backgroundColor: "#315dcc" },
  motorText: { color: "#f0f3f8", textAlign: "center", fontWeight: "600" },
  banner: { color: "#f0d48a", fontSize: 16, fontWeight: "700" },
  gps: { color: "#d7e3ff", fontSize: 14, fontWeight: "600" },
  status: { color: "#b7c0d0", fontSize: 13 },
  row: { flexDirection: "row", gap: 8 },
  button: { backgroundColor: "#315dcc", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  buttonText: { color: "#f0f3f8", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#30384a", borderRadius: 10, color: "#f0f3f8", padding: 10 },
});
