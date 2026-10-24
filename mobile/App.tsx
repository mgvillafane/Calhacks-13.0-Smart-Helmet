import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, KeyboardEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { demoLeftTurn } from "./src/demo";
import { CueEngine, Fix, Route, fixAlong } from "./src/engine";
import { GpsReading, gpsStatus, readingFromCoords } from "./src/gps";
import { HelmetLink } from "./src/link";
import { createPhoneRadio } from "./src/radio";
import { PlaceChoice, routeBetween, searchPlaces } from "./src/routing";
import { NavSession, ScreenState } from "./src/screen";
import { StreetMap } from "./src/StreetMap";

const DEMO_SPEED_MPS = 8;

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <HelmetScreen />
    </SafeAreaProvider>
  );
}

function HelmetScreen() {
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
  const [choices, setChoices] = useState<PlaceChoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const skipSearch = useRef(false);
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

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return undefined;
    }
    const query = destination.trim();
    if (query.length < 2) {
      setChoices([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadPlaces(query, cancelled, () => cancelled);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destination]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event: KeyboardEvent) => {
      const windowHeight = Dimensions.get("window").height;
      setKeyboardHeight(Math.max(0, windowHeight - event.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  async function loadPlaces(query: string, alreadyCancelled: boolean, isCancelled: () => boolean): Promise<void> {
    if (alreadyCancelled) return;
    setSearching(true);
    try {
      const near = gpsRef.current ? ([gpsRef.current.lat, gpsRef.current.lng] as const) : null;
      const found = await searchPlaces(query, near);
      if (!isCancelled()) {
        setChoices(found);
        if (found.length === 0) setStatus(`No places matched “${query}”.`);
      }
    } catch (error) {
      if (!isCancelled()) {
        setChoices([]);
        setStatus(error instanceof Error ? error.message : "Place search failed.");
      }
    } finally {
      if (!isCancelled()) setSearching(false);
    }
  }

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

  async function choosePlace(place: PlaceChoice): Promise<void> {
    Keyboard.dismiss();
    skipSearch.current = true;
    setChoices([]);
    setDestination(place.name);
    const here = await currentGps();
    if (!here) return;
    try {
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

  async function findPlaces(): Promise<void> {
    const query = destination.trim();
    if (query.length < 2) {
      setStatus("Type a place name, then pick one from the list.");
      return;
    }
    await loadPlaces(query, false, () => false);
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

  const typing = keyboardHeight > 0 || choices.length > 0 || searching;
  const insets = useSafeAreaInsets();
  const bottomInset = keyboardHeight > 0 ? keyboardHeight : Math.max(insets.bottom, 28);

  return (
    <View style={[styles.page, { paddingBottom: 16 + bottomInset }]}>
      <Text style={styles.title}>{screen.instruction || "Smart Helmet"}</Text>
      {typing ? null : (
        <Text style={styles.meta}>
          {screen.destinationName || "No route"} · {screen.phase} · {riding ? "following GPS" : "GPS idle"} · {screen.metersToJunction} m
        </Text>
      )}
      <View style={styles.body}>
        <View style={[styles.mapWrap, typing ? styles.mapTyping : null]}>
          <StreetMap screen={screen} />
        </View>
        {typing ? null : (
          <>
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
          </>
        )}
        {searching ? <Text style={styles.status}>Searching places…</Text> : null}
        {choices.length > 0 ? (
          <ScrollView style={styles.choices} keyboardShouldPersistTaps="handled">
            {choices.map((place, index) => (
              <Pressable key={`${place.point[0]},${place.point[1]},${index}`} style={styles.choice} onPress={() => void choosePlace(place)}>
                <Text style={styles.choiceName} numberOfLines={1}>{place.name}</Text>
                <Text style={styles.choiceDetail} numberOfLines={2}>{place.detail}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      <View style={styles.searchRow}>
        <TextInput style={[styles.input, styles.searchInput]} value={destination} onChangeText={setDestination} placeholder="Place name or latitude, longitude" placeholderTextColor="#8b93a7" autoCapitalize="words" returnKeyType="search" onSubmitEditing={() => void findPlaces()} />
        <AppButton label="Find" onPress={() => void findPlaces()} />
      </View>
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
  body: { flex: 1, gap: 8 },
  mapWrap: { flex: 1, minHeight: 160, borderRadius: 12, overflow: "hidden" },
  mapTyping: { flex: 0, height: 120, minHeight: 0 },
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
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  searchInput: { flex: 1 },
  choices: { flex: 1, borderWidth: 1, borderColor: "#30384a", borderRadius: 10 },
  choice: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#242b3a" },
  choiceName: { color: "#f0f3f8", fontWeight: "700" },
  choiceDetail: { color: "#b7c0d0", fontSize: 12 },
});
