import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Keyboard, KeyboardEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { requestRecordingPermissionsAsync, useAudioStream } from "expo-audio";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { demoLeftTurn } from "./src/demo";
import { distanceM, LatLng } from "./src/geo";
import { CueEngine, Fix, Route, fixAlong } from "./src/engine";
import { GpsReading, gpsStatus, readingFromCoords } from "./src/gps";
import { BluetoothIcon, ChevronLeftIcon, CueArrow, GearIcon, HelmetTile, MiniVehicle, MUTED, PersonIcon, RiderBadge, SearchIcon, SURFACE, VehicleKind, YELLOW } from "./src/icons";
import { HelmetLink } from "./src/link";
import { createPhoneRadio } from "./src/radio";
import { PlaceChoice, routeBetween, searchPlaces } from "./src/routing";
import { NavSession, ScreenState, idleScreen } from "./src/screen";
import { StreetMap } from "./src/StreetMap";
import { VoiceCommand, VOICE_SAMPLE_RATE, prepareMicPcm, voiceKeyConfigured, whatsNextResult } from "./src/voice";
import { VoiceAgent } from "./src/voiceAgent";
import { connectGrokVoice, prepareVoiceAudio } from "./src/voiceLive";

const DEMO_SPEED_MPS = 8;
type Page = "search" | "ride" | "settings";

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" />
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
  const chosenPlace = useRef(false);
  const returnPage = useRef<Page>("search");
  const [screen, setScreen] = useState<ScreenState>(() => idleScreen());
  const [playing, setPlaying] = useState(false);
  const [riding, setRiding] = useState(false);
  const [gpsMessage, setGpsMessage] = useState(gpsStatus(null, "unknown"));
  const [bleMessage, setBleMessage] = useState("Helmet not connected");
  const [destination, setDestination] = useState("");
  const [choices, setChoices] = useState<PlaceChoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const skipSearch = useRef(false);
  const [status, setStatus] = useState("Search for a place, or press GO.");
  const [page, setPage] = useState<Page>("search");
  const [vehicle, setVehicle] = useState<VehicleKind>("bicycle");
  const [departing, setDeparting] = useState(false);
  const beganRide = useRef(false);
  const [riderName, setRiderName] = useState("");
  const [units, setUnits] = useState<"metric" | "imperial">("metric");
  const [riddenM, setRiddenM] = useState(0);
  const lastRidePoint = useRef<LatLng | null>(null);
  const agentRef = useRef<VoiceAgent | null>(null);
  const listeningRef = useRef(false);
  const executeRef = useRef<(command: VoiceCommand) => Promise<string>>(async () => "{}");
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const { stream } = useAudioStream({
    sampleRate: VOICE_SAMPLE_RATE,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => {
      const agent = agentRef.current;
      if (!listeningRef.current || !agent) return;
      agent.sendPcm(prepareMicPcm(new Uint8Array(buffer.data), buffer.channels || 1, buffer.sampleRate || VOICE_SAMPLE_RATE));
    },
  });
  const streamRef = useRef(stream);
  streamRef.current = stream;

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
    return () => {
      listeningRef.current = false;
      try {
        streamRef.current.stop();
      } catch {
        // The microphone was not open.
      }
      agentRef.current?.close();
    };
  }, []);

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

  function fixFromGps(reading: GpsReading): Fix {
    return {
      lat: reading.lat,
      lng: reading.lng,
      speedMps: reading.speedMps,
      gpsCourseDeg: reading.courseDeg,
      helmetHeadingDeg: reading.speedMps < 2 ? linkRef.current?.headingDeg ?? null : null,
    };
  }

  function acceptGps(position: Location.LocationObject): void {
    const reading = readingFromCoords(position.coords);
    gpsRef.current = reading;
    setGpsMessage(gpsStatus(reading, "granted"));
    if (!ridingRef.current) return;
    void publish(fixFromGps(reading));
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
    const point: LatLng = [fix.lat, fix.lng];
    const previous = lastRidePoint.current;
    lastRidePoint.current = point;
    if (previous) {
      const step = distanceM(previous, point);
      if (step > 0.4 && step < 80) setRiddenM((meters) => meters + step);
    }
    setScreen(sessionRef.current.update(fix, decision, Boolean(link?.connected), link?.headingAgeS ?? null));
    if (link?.connected) await link.send(decision.cue, now);
  }

  function useRoute(route: Route, provider: string, name: string): void {
    setPlaying(false);
    setRide(false);
    chosenPlace.current = false;
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
        setBleMessage("SmartHelmet was not found. If Android Bluetooth settings is connected to it, disconnect it there and try again.");
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
    setPage("ride");
    void publish(fixFromGps(here));
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
      chosenPlace.current = true;
      setStatus(`Press GO to ride to ${place.name}.`);
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
    const phase = sessionRef.current.screen().phase;
    if (phase === "idle") sessionRef.current.preview(engineRef.current.route, "demo", "Left turn");
    if (sessionRef.current.screen().phase === "preview") {
      sessionRef.current.start();
      setScreen(sessionRef.current.screen());
    }
    distanceRef.current = 0;
    engineRef.current = new CueEngine(engineRef.current.route);
    setPlaying(true);
    setPage("ride");
    setStatus("Playing the left turn at 8 m/s.");
    void publish(fixAlong(engineRef.current.route, 0, DEMO_SPEED_MPS));
  }

  function pressGo(): void {
    if (departing) return;
    Keyboard.dismiss();
    setChoices([]);
    beganRide.current = false;
    setDeparting(true);
  }

  function beginRide(): void {
    if (beganRide.current) return;
    beganRide.current = true;
    setDeparting(false);
    if (chosenPlace.current) {
      if (sessionRef.current.screen().phase === "preview") {
        sessionRef.current.start();
        setScreen(sessionRef.current.screen());
      }
      setPage("ride");
      setRide(true);
      const here = gpsRef.current;
      if (here) void publish(fixFromGps(here));
      setStatus(`Riding to ${sessionRef.current.screen().destinationName}.`);
      return;
    }
    playDemo();
  }

  function endRide(): void {
    setPlaying(false);
    setRide(false);
    const current = sessionRef.current.screen();
    const route = engineRef.current.route;
    sessionRef.current = new NavSession();
    if (route.steps.length > 0 && current.destinationName) {
      setScreen(sessionRef.current.preview(route, current.providerName || "demo", current.destinationName));
    } else {
      setScreen(idleScreen());
    }
    setPage("search");
    setStatus("Search for a place, or press GO.");
  }

  async function runVoiceCommand(command: VoiceCommand): Promise<string> {
    if (command.name === "whats_next") return whatsNextResult(sessionRef.current.screen());
    if (command.name === "connect_helmet") {
      await connectHelmet();
      return JSON.stringify({ connected: linkRef.current?.connected === true });
    }
    if (command.name === "end_ride") {
      endRide();
      return JSON.stringify({ status: "ended" });
    }
    if (command.name === "start_ride") {
      const phase = sessionRef.current.screen().phase;
      if (phase !== "preview") return JSON.stringify({ status: phase === "navigating" ? "already_riding" : "need_destination" });
      pressGo();
      return JSON.stringify({ status: "starting", destination: sessionRef.current.screen().destinationName });
    }
    const here = await currentGps();
    if (!here) return JSON.stringify({ status: "no_gps", query: command.query });
    const found = await searchPlaces(command.query, [here.lat, here.lng]);
    const place = found[0];
    if (!place) return JSON.stringify({ status: "no_place", query: command.query });
    await choosePlace(place);
    if (!chosenPlace.current) return JSON.stringify({ status: "no_route", query: command.query });
    pressGo();
    return JSON.stringify({ status: "riding", place: place.name });
  }

  async function toggleVoice(): Promise<void> {
    if (listeningRef.current) {
      listeningRef.current = false;
      setListening(false);
      try {
        streamRef.current.stop();
      } catch {
        // The microphone was already stopped.
      }
      agentRef.current?.finishUtterance();
      setVoiceNote("Sending that to Grok...");
      return;
    }
    const key = process.env.EXPO_PUBLIC_XAI_API_KEY ?? "";
    if (!voiceKeyConfigured(key)) {
      setVoiceNote("Add EXPO_PUBLIC_XAI_API_KEY in mobile/.env, then restart Expo.");
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setVoiceNote("Microphone permission is off.");
      return;
    }
    try {
      await prepareVoiceAudio();
      if (!agentRef.current) {
        setVoiceNote("Connecting to Grok Voice...");
        agentRef.current = await connectGrokVoice(key, (command) => executeRef.current(command), (notice) => {
          setVoiceNote(notice.kind === "heard" ? `Heard: ${notice.text}` : notice.text);
        });
      }
      listeningRef.current = true;
      await streamRef.current.start();
    } catch (error) {
      listeningRef.current = false;
      setVoiceNote(error instanceof Error ? error.message : "Voice failed");
      return;
    }
    setListening(true);
    setVoiceNote("Listening. Tap Done when you finish.");
  }

  function openSettings(): void {
    if (page !== "settings") returnPage.current = page;
    setPage("settings");
  }

  function closeSettings(): void {
    setPage(returnPage.current === "settings" ? "search" : returnPage.current);
  }

  executeRef.current = runVoiceCommand;

  const typing = keyboardHeight > 0 || choices.length > 0 || searching;
  const insets = useSafeAreaInsets();
  const bottomInset = keyboardHeight > 0 ? keyboardHeight : Math.max(insets.bottom, 16);
  const userPoint: [number, number] | null = gpsRef.current ? [gpsRef.current.lat, gpsRef.current.lng] : null;
  const routePoints = screen.remaining.length > 1 ? screen.remaining : screen.traveled.concat(screen.remaining);
  const tripMeters = pathMeters(routePoints);
  const showGo = page === "search" && screen.phase === "preview" && !typing;

  return (
    <View style={styles.screen}>
      <View style={[styles.page, { paddingTop: insets.top + 10, paddingBottom: 12 + bottomInset }]}>
        {page === "settings" ? (
          <ScrollView contentContainerStyle={styles.settings} keyboardShouldPersistTaps="handled">
            <View style={styles.settingsHead}>
              <Pressable style={styles.roundButton} onPress={closeSettings} accessibilityLabel="Back">
                <ChevronLeftIcon />
              </Pressable>
              <Text style={styles.settingsTitle}>Settings</Text>
            </View>
            <View style={styles.avatar}>
              <PersonIcon size={72} />
            </View>
            <TextInput
              style={styles.nameInput}
              value={riderName}
              onChangeText={setRiderName}
              placeholder="[Rider name]"
              placeholderTextColor={MUTED}
              textAlign="center"
            />
            <Text style={styles.rode}>Rode {formatDistance(riddenM, units)}</Text>
            <Text style={styles.sectionLabel}>I RIDE A</Text>
            <View style={styles.pillRow}>
              <Pressable style={[styles.choicePill, vehicle === "bicycle" ? styles.choiceOn : null]} onPress={() => setVehicle("bicycle")}>
                <MiniVehicle kind="bicycle" color={vehicle === "bicycle" ? BG : TEXT} />
                <Text style={[styles.choicePillText, vehicle === "bicycle" ? styles.choiceTextOn : null]}>Bicycle</Text>
              </Pressable>
              <Pressable style={[styles.choicePill, vehicle === "scooter" ? styles.choiceOn : null]} onPress={() => setVehicle("scooter")}>
                <MiniVehicle kind="scooter" color={vehicle === "scooter" ? BG : TEXT} />
                <Text style={[styles.choicePillText, vehicle === "scooter" ? styles.choiceTextOn : null]}>Scooter</Text>
              </Pressable>
            </View>
            <View style={styles.noteRow}>
              <RiderBadge kind={vehicle} size={40} />
              <Text style={styles.note}>This icon shows on the map and in the GO animation.</Text>
            </View>
            <Text style={styles.sectionLabel}>UNITS</Text>
            <View style={styles.pillRow}>
              <Pressable style={[styles.choicePill, units === "metric" ? styles.choiceOn : null]} onPress={() => setUnits("metric")}>
                <Text style={[styles.choicePillText, units === "metric" ? styles.choiceTextOn : null]}>Metric km</Text>
              </Pressable>
              <Pressable style={[styles.choicePill, units === "imperial" ? styles.choiceOn : null]} onPress={() => setUnits("imperial")}>
                <Text style={[styles.choicePillText, units === "imperial" ? styles.choiceTextOn : null]}>Imperial mi</Text>
              </Pressable>
            </View>
            <Text style={styles.sectionLabel}>VOICE</Text>
            <Text style={styles.note}>{voiceNote || (listening ? "Listening. Tap Done when you finish." : "Say a place, go, what is next, or end the ride.")}</Text>
            <View style={styles.pillRow}>
              <Pressable style={styles.ghostPill} onPress={() => void toggleVoice()}>
                <Text style={styles.ghostText}>{listening ? "Done" : "Talk"}</Text>
              </Pressable>
              <Pressable style={styles.ghostPill} onPress={() => (playing ? setPlaying(false) : playDemo())}>
                <Text style={styles.ghostText}>{playing ? "Pause demo" : "Play demo"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.body}>
            {page === "ride" ? (
              <View style={styles.topBar}>
                <View style={styles.connectedPill}>
                  <HelmetTile size={28} />
                  <Text style={styles.connectedText}>{screen.bleConnected ? "Helmet connected" : "Helmet offline"}</Text>
                  {screen.bleConnected ? <View style={styles.blueDot} /> : null}
                </View>
                <Pressable style={styles.endButton} onPress={endRide} accessibilityLabel="End ride">
                  <Text style={styles.endText}>End</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.topBar}>
                  <Pressable style={styles.connect} onPress={() => void connectHelmet()}>
                    <BluetoothIcon />
                    <Text style={styles.connectText}>Connect helmet</Text>
                  </Pressable>
                  <HelmetTile size={40} />
                  <Pressable style={styles.roundButton} onPress={openSettings} accessibilityLabel="Settings">
                    <GearIcon size={22} />
                  </Pressable>
                </View>
                <View style={styles.search}>
                  <SearchIcon />
                  <TextInput
                    style={styles.searchInput}
                    value={destination}
                    onChangeText={setDestination}
                    placeholder="Where to?"
                    placeholderTextColor={MUTED}
                    autoCapitalize="words"
                    returnKeyType="search"
                    onSubmitEditing={() => void findPlaces()}
                  />
                </View>
              </>
            )}
            <View style={[styles.mapFrame, page === "search" && typing ? styles.mapTyping : null]}>
              <StreetMap screen={screen} vehicle={vehicle} user={userPoint} />
              {page === "ride" && tripMeters > 20 ? (
                <View style={styles.tripChip}>
                  <Text style={styles.tripText}>{formatTrip(tripMeters, units)}</Text>
                </View>
              ) : null}
              {showGo ? (
                <Pressable style={styles.go} onPress={pressGo} accessibilityLabel="Go">
                  <Text style={styles.goText}>GO</Text>
                </Pressable>
              ) : null}
            </View>
            {page === "search" && searching ? <Text style={styles.note}>Searching places…</Text> : null}
            {page === "search" && choices.length > 0 ? (
              <ScrollView style={styles.choices} keyboardShouldPersistTaps="handled">
                {choices.map((place, index) => (
                  <Pressable key={`${place.point[0]},${place.point[1]},${index}`} style={styles.choice} onPress={() => void choosePlace(place)}>
                    <Text style={styles.choiceName} numberOfLines={1}>{place.name}</Text>
                    <Text style={styles.choiceDetail} numberOfLines={2}>{place.detail}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {page === "ride" ? (
              <>
                {screen.banner ? <Text style={styles.banner}>{screen.banner}</Text> : null}
                <Text style={styles.vibeCaption}>VIBRATING ON YOUR HELMET</Text>
                <View style={styles.motors}>
                  <VibrationPad label="Left" direction="left" on={screen.motors.left} />
                  <VibrationPad label="Front" direction="up" on={screen.motors.front} />
                  <VibrationPad label="Right" direction="right" on={screen.motors.right} />
                </View>
              </>
            ) : null}
          </View>
        )}
      </View>
      {departing ? <RideOff vehicle={vehicle} onDone={beginRide} /> : null}
    </View>
  );
}

function RideOff({ vehicle, onDone }: { vehicle: VehicleKind; onDone: () => void }) {
  const slide = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const width = Dimensions.get("window").width;
    slide.setValue(-90);
    const cruise = Animated.timing(slide, {
      toValue: width + 20,
      duration: 1400,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    const hop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -8, duration: 150, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]),
    );
    hop.start();
    cruise.start(({ finished }) => {
      hop.stop();
      if (finished) doneRef.current();
    });
    return () => {
      cruise.stop();
      hop.stop();
    };
  }, [bob, slide]);

  return (
    <View style={styles.transition}>
      <Animated.View style={{ transform: [{ translateX: slide }, { translateY: bob }] }}>
        <RiderBadge kind={vehicle} size={84} />
      </Animated.View>
    </View>
  );
}

function VibrationPad({ label, direction, on }: { label: string; direction: "left" | "up" | "right"; on: boolean }) {
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!on) {
      shake.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 55, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, shake]);

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-2.5, 2.5] });
  const ink = on ? BG : TEXT;
  return (
    <Animated.View style={[styles.motor, on ? styles.motorOn : null, { transform: [{ translateX }] }]}>
      <CueArrow direction={direction} color={ink} />
      <Text style={[styles.motorText, on ? styles.motorTextOn : null]}>{label}</Text>
      <Text style={[styles.motorState, on ? styles.motorTextOn : null]}>{on ? "Buzzing" : "Idle"}</Text>
    </Animated.View>
  );
}

function pathMeters(points: LatLng[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) total += distanceM(points[index], points[index + 1]);
  return total;
}

function formatDistance(meters: number, units: "metric" | "imperial"): string {
  if (units === "imperial") return `${(meters / 1609.344).toFixed(1)} mi`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatTrip(meters: number, units: "metric" | "imperial"): string {
  const minutes = Math.max(1, Math.round(meters / 200));
  return `${formatDistance(meters, units)} · ${minutes} min`;
}

const BG = "#14161A";
const TEXT = "#F2F2F0";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  page: { flex: 1, backgroundColor: BG, paddingHorizontal: 16 },
  body: { flex: 1, gap: 12 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10 },
  connect: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: TEXT, borderRadius: 28, paddingVertical: 12, paddingHorizontal: 16 },
  connectText: { color: TEXT, fontWeight: "700", fontSize: 16 },
  roundButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: SURFACE, borderRadius: 16, paddingHorizontal: 14, height: 48 },
  searchInput: { flex: 1, color: TEXT, fontSize: 16, paddingVertical: 0 },
  mapFrame: { flex: 1, minHeight: 180, borderRadius: 18, overflow: "hidden", backgroundColor: "#1a1c22" },
  mapTyping: { flex: 0, height: 140, minHeight: 0 },
  go: { position: "absolute", right: 16, bottom: 16, minWidth: 92, height: 64, borderRadius: 20, backgroundColor: YELLOW, alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  goText: { color: BG, fontSize: 26, fontWeight: "800" },
  tripChip: { position: "absolute", left: 12, top: 12, backgroundColor: SURFACE, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  tripText: { color: TEXT, fontWeight: "700", fontSize: 14 },
  choices: { flex: 1, borderRadius: 16, backgroundColor: SURFACE },
  choice: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#3a3e46" },
  choiceName: { color: TEXT, fontWeight: "700" },
  choiceDetail: { color: MUTED, fontSize: 12 },
  connectedPill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: SURFACE, borderRadius: 28, paddingVertical: 6, paddingLeft: 6, paddingRight: 14 },
  connectedText: { flex: 1, color: TEXT, fontWeight: "700", fontSize: 15 },
  blueDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#3DA5FF" },
  endButton: { borderWidth: 1.5, borderColor: TEXT, borderRadius: 24, paddingVertical: 10, paddingHorizontal: 18 },
  endText: { color: TEXT, fontWeight: "700", fontSize: 16 },
  vibeCaption: { color: MUTED, fontSize: 12, fontWeight: "700", letterSpacing: 1.2 },
  motors: { flexDirection: "row", gap: 10 },
  motor: { flex: 1, minHeight: 92, borderRadius: 16, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center", gap: 2, paddingVertical: 10 },
  motorOn: { backgroundColor: YELLOW },
  motorText: { color: TEXT, fontWeight: "800", fontSize: 16 },
  motorTextOn: { color: BG },
  motorState: { color: MUTED, fontSize: 12, fontWeight: "600" },
  banner: { color: YELLOW, fontSize: 16, fontWeight: "700" },
  transition: { ...StyleSheet.absoluteFill, backgroundColor: BG, alignItems: "flex-start", justifyContent: "center" },
  settings: { gap: 14, paddingBottom: 28 },
  settingsHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingsTitle: { color: TEXT, fontSize: 28, fontWeight: "800" },
  avatar: { alignSelf: "center", width: 108, height: 108, borderRadius: 54, borderWidth: 2, borderColor: TEXT, alignItems: "center", justifyContent: "center", backgroundColor: SURFACE },
  nameInput: { color: TEXT, fontSize: 22, fontWeight: "800", paddingVertical: 0 },
  rode: { color: MUTED, textAlign: "center", fontSize: 16, marginTop: -8 },
  sectionLabel: { color: MUTED, fontSize: 12, fontWeight: "700", letterSpacing: 1.3, marginTop: 8 },
  pillRow: { flexDirection: "row", gap: 10 },
  choicePill: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: SURFACE, borderRadius: 16, minHeight: 56, paddingHorizontal: 12 },
  choiceOn: { backgroundColor: YELLOW },
  choicePillText: { color: TEXT, fontWeight: "800", fontSize: 16 },
  choiceTextOn: { color: BG },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  note: { flex: 1, color: TEXT, fontSize: 14, lineHeight: 19 },
  ghostPill: { flex: 1, borderRadius: 16, minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: SURFACE },
  ghostText: { color: TEXT, fontWeight: "700" },
});
