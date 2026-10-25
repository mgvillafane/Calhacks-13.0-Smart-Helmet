import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Keyboard, KeyboardEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle, Line, Rect, Text as SvgText } from "react-native-svg";
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { requestRecordingPermissionsAsync, useAudioStream } from "expo-audio";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { DebugScreen } from "./src/DebugScreen";
import { DebugSide, debugStopCue, debugTurnCue, directionForDebugSide } from "./src/debug";
import { demoLeftTurn } from "./src/demo";
import { distanceM, LatLng } from "./src/geo";
import { CueEngine, Fix, Route, fixAlong } from "./src/engine";
import { GoFilm } from "./src/GoFilm";
import { GpsReading, gpsStatus, readingFromCoords } from "./src/gps";
import { BluetoothIcon, BugIcon, CheckIcon, ChevronLeftIcon, CueArrow, GearIcon, HelmetArt, MiniVehicle, MUTED, PersonIcon, PinIcon, RiderBadge, SURFACE, SwapIcon, TargetIcon, VehicleKind, YELLOW } from "./src/icons";
import { HelmetLink } from "./src/link";
import { createPhoneRadio } from "./src/radio";
import { PlaceChoice, routeBetween, searchPlaces } from "./src/routing";
import { NavSession, ScreenState, idleScreen } from "./src/screen";
import { StreetMap } from "./src/StreetMap";
import { Cue, SensorSample } from "./src/protocol";
import { VoiceCommand, VOICE_SAMPLE_RATE, prepareMicPcm, voiceKeyConfigured, whatsNextResult } from "./src/voice";
import { VoiceAgent } from "./src/voiceAgent";
import { connectGrokVoice, playHelmetMonitor, prepareVoiceAudio, stopHelmetMonitor } from "./src/voiceLive";
import { convexSink } from "./src/convexSink";
import { RideRecorder, newSessionKey } from "./src/telemetry";

const DEMO_SPEED_MPS = 8;
const recorder = new RideRecorder(convexSink(process.env.EXPO_PUBLIC_CONVEX_URL), newSessionKey());
type Page = "search" | "ride" | "settings" | "debug";

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
  const voiceSourceRef = useRef<"phone" | "helmet" | null>(null);
  const voiceReleasedRef = useRef(false);
  const helmetAudioRef = useRef<Uint8Array[]>([]);
  const talkRef = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  const executeRef = useRef<(command: VoiceCommand) => Promise<string>>(async () => "{}");
  const [listening, setListening] = useState(false);
  const [buttonPressed, setButtonPressed] = useState(false);
  const [monitorOn, setMonitorOn] = useState(false);
  const monitorRef = useRef(false);
  monitorRef.current = monitorOn;
  const [voiceNote, setVoiceNote] = useState("");
  const [helmetPhase, setHelmetPhase] = useState<"off" | "searching" | "on">("off");
  const [linkNote, setLinkNote] = useState("");
  const [focusNonce, setFocusNonce] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [pillWidth, setPillWidth] = useState(0);
  const scanningRef = useRef(false);
  const swapTurn = useRef(new Animated.Value(0)).current;
  const slashOpacity = useRef(new Animated.Value(1)).current;
  const goReveal = useRef(new Animated.Value(0)).current;
  const searchPulse = useRef(new Animated.Value(1)).current;
  const debugHoldRef = useRef<DebugSide | null>(null);
  const [debugHold, setDebugHold] = useState<DebugSide | null>(null);
  const [sensors, setSensors] = useState<SensorSample | null>(null);
  const { stream } = useAudioStream({
    sampleRate: VOICE_SAMPLE_RATE,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => {
      const agent = agentRef.current;
      if (!listeningRef.current || voiceSourceRef.current !== "phone" || !agent) return;
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

  useEffect(() => {
    if (!debugHold) return undefined;
    const timer = setInterval(() => {
      const side = debugHoldRef.current;
      if (!side) return;
      void sendDebugCue(debugTurnCue(directionForDebugSide(side)));
    }, 1000);
    return () => clearInterval(timer);
  }, [debugHold]);

  useEffect(() => {
    if (helmetPhase !== "on") return undefined;
    const timer = setInterval(() => {
      const link = linkRef.current;
      if (!link?.connected) {
        onTalkSwitch(false);
        setButtonPressed(false);
        return;
      }
      void link.poll(Date.now() / 1000).then(() => {
        const audio = link.takeAudio();
        if (pageRef.current === "debug" && monitorRef.current) playHelmetMonitor(audio);
        if (voiceSourceRef.current === "helmet") sendHelmetAudio(audio);
        setButtonPressed(link.buttonPressed);
        onTalkSwitch(link.buttonPressed);
      });
    }, 100);
    return () => clearInterval(timer);
  }, [helmetPhase]);

  useEffect(() => {
    if (page !== "debug") return undefined;
    const timer = setInterval(() => {
      const link = linkRef.current;
      if (!link?.connected) {
        setSensors(null);
        setButtonPressed(false);
        return;
      }
      void link.poll(Date.now() / 1000).then(() => {
        setSensors(link.sensors);
        setButtonPressed(link.buttonPressed);
      });
    }, 100);
    return () => clearInterval(timer);
  }, [page]);

  useEffect(() => {
    if (page === "debug" && monitorOn) return;
    stopHelmetMonitor();
  }, [page, monitorOn]);

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

  function linked(state: ScreenState): ScreenState {
    return { ...state, bleConnected: linkRef.current?.connected === true };
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
      if (step > 0.4 && step < 80) {
        setRiddenM((meters) => meters + step);
        recorder.addDistance(step);
      }
    }
    recorder.observe(decision, fix, Boolean(link?.connected));
    setScreen(sessionRef.current.update(fix, decision, Boolean(link?.connected), link?.headingAgeS ?? null));
    if (link?.connected && !debugHoldRef.current) await link.send(decision.cue, now);
  }

  function useRoute(route: Route, provider: string, name: string): void {
    recorder.finish("replaced");
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
    if (scanningRef.current) return;
    scanningRef.current = true;
    setHelmetPhase("searching");
    setLinkNote("");
    setBleMessage("Searching…");
    const scanStarted = Date.now();
    try {
      if (linkRef.current?.connected) await linkRef.current.disconnect();
      const radio = await createPhoneRadio();
      const link = new HelmetLink(radio);
      const found = await link.scan();
      if (!found) {
        const message = "SmartHelmet was not found. If Android Bluetooth settings is connected to it, disconnect it there and try again.";
        recorder.link("not_found", Date.now() - scanStarted);
        setBleMessage(message);
        setLinkNote(message);
        setHelmetPhase("off");
        return;
      }
      await link.connect(found);
      linkRef.current = link;
      recorder.link("connected", Date.now() - scanStarted);
      setBleMessage("Connected to SmartHelmet");
      setLinkNote("");
      setHelmetPhase("on");
      setScreen((current: ScreenState) => ({ ...current, bleConnected: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bluetooth failed";
      recorder.link("failed", Date.now() - scanStarted, message);
      setBleMessage(message);
      setLinkNote(message);
      setHelmetPhase("off");
    } finally {
      scanningRef.current = false;
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
    recorder.begin({ kind: "here", provider: "demo", vehicle, route: engineRef.current.route, helmetConnected: linkRef.current?.connected === true });
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
      setScreen(linked(sessionRef.current.screen()));
    }
    distanceRef.current = 0;
    engineRef.current = new CueEngine(engineRef.current.route);
    recorder.begin({ kind: "demo", provider: "demo", vehicle, route: engineRef.current.route, helmetConnected: linkRef.current?.connected === true });
    setPlaying(true);
    setPage("ride");
    setStatus("Playing the left turn at 8 m/s.");
    void publish(fixAlong(engineRef.current.route, 0, DEMO_SPEED_MPS));
  }

  function pressSwap(): void {
    setFlipped((value) => !value);
    Animated.timing(swapTurn, {
      toValue: flipped ? 0 : 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
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
        setScreen(linked(sessionRef.current.screen()));
      }
      recorder.begin({
        kind: "route",
        provider: sessionRef.current.screen().providerName,
        vehicle,
        route: engineRef.current.route,
        helmetConnected: linkRef.current?.connected === true,
      });
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
    recorder.finish("ended");
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

  function onTalkSwitch(talk: boolean): void {
    if (talk === talkRef.current) return;
    talkRef.current = talk;
    if (talk && voiceSourceRef.current !== "helmet") void startVoice("helmet");
    if (!talk && voiceSourceRef.current === "helmet") void stopVoice();
  }

  function sendHelmetAudio(audio: Uint8Array): void {
    if (audio.length > 0) helmetAudioRef.current.push(audio);
    const agent = agentRef.current;
    if (!agent || !listeningRef.current) return;
    for (const chunk of helmetAudioRef.current.splice(0)) agent.sendPcm(chunk);
  }

  async function startVoice(source: "phone" | "helmet"): Promise<void> {
    if (voiceSourceRef.current) return;
    voiceSourceRef.current = source;
    voiceReleasedRef.current = false;
    setListening(true);
    setVoiceNote("Listening");
    const key = process.env.EXPO_PUBLIC_XAI_API_KEY ?? "";
    if (!voiceKeyConfigured(key)) {
      voiceSourceRef.current = null;
      setListening(false);
      setVoiceNote("Add EXPO_PUBLIC_XAI_API_KEY in mobile/.env, then restart Expo.");
      return;
    }
    if (source === "phone") {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        voiceSourceRef.current = null;
        setListening(false);
        setVoiceNote("Microphone permission is off.");
        return;
      }
    }
    if (voiceReleasedRef.current) {
      await stopVoice();
      return;
    }
    helmetAudioRef.current = [];
    Keyboard.dismiss();
    setChoices([]);
    try {
      await prepareVoiceAudio();
      if (!agentRef.current) {
        setVoiceNote("Connecting to Grok Voice...");
        agentRef.current = await connectGrokVoice(key, (command) => executeRef.current(command), (notice) => {
          setVoiceNote(notice.kind === "heard" ? `Heard: ${notice.text}` : notice.text);
        });
      }
      listeningRef.current = true;
      if (source === "phone") await streamRef.current.start();
      else sendHelmetAudio(new Uint8Array(0));
    } catch (error) {
      listeningRef.current = false;
      voiceSourceRef.current = null;
      helmetAudioRef.current = [];
      setListening(false);
      setVoiceNote(error instanceof Error ? error.message : "Voice failed");
      return;
    }
    if (voiceReleasedRef.current) {
      await stopVoice();
      return;
    }
    setListening(true);
    setVoiceNote("Listening");
  }

  async function stopVoice(): Promise<void> {
    const source = voiceSourceRef.current;
    if (!source) return;
    if (!listeningRef.current) {
      voiceReleasedRef.current = true;
      return;
    }
    if (source === "helmet") {
      const link = linkRef.current;
      if (link?.connected) {
        await link.poll(Date.now() / 1000);
        sendHelmetAudio(link.takeAudio());
      }
    } else {
      try {
        streamRef.current.stop();
      } catch {
        // The microphone was already stopped.
      }
    }
    listeningRef.current = false;
    voiceSourceRef.current = null;
    voiceReleasedRef.current = false;
    helmetAudioRef.current = [];
    setListening(false);
    agentRef.current?.finishUtterance();
    setVoiceNote("Sending that to Grok...");
  }

  function openSettings(): void {
    if (page !== "settings") returnPage.current = page;
    setPage("settings");
  }

  function closeSettings(): void {
    setPage(returnPage.current === "settings" ? "search" : returnPage.current);
  }

  async function sendDebugCue(cue: Cue): Promise<void> {
    const link = linkRef.current;
    if (!link?.connected) {
      setBleMessage("Connect the helmet before sending a turn.");
      return;
    }
    await link.send(cue, Date.now() / 1000);
  }

  function holdDebug(side: DebugSide): void {
    debugHoldRef.current = side;
    setDebugHold(side);
    void sendDebugCue(debugTurnCue(directionForDebugSide(side)));
  }

  function stopDebugCue(): void {
    debugHoldRef.current = null;
    setDebugHold(null);
    void sendDebugCue(debugStopCue());
  }

  function openDebug(): void {
    if (page !== "debug") returnPage.current = page;
    setPage("debug");
  }

  function closeDebug(): void {
    stopDebugCue();
    setPage(returnPage.current === "debug" ? "search" : returnPage.current);
  }

  executeRef.current = runVoiceCommand;

  const typing = keyboardHeight > 0 || choices.length > 0 || searching;
  const insets = useSafeAreaInsets();
  const bottomInset = keyboardHeight > 0 ? keyboardHeight : Math.max(insets.bottom, 16);
  const userPoint: [number, number] | null = gpsRef.current ? [gpsRef.current.lat, gpsRef.current.lng] : null;
  const routePoints = screen.remaining.length > 1 ? screen.remaining : screen.traveled.concat(screen.remaining);
  const tripMeters = pathMeters(routePoints);
  const showGo = page === "search" && screen.phase === "preview" && !typing && !listening;
  const notice = (listening ? "Listening" : "") || linkNote || (voiceNote ? voiceNote : "") || (quietStatus(status) ? "" : status);
  const swapSpin = swapTurn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const rowDown = swapTurn.interpolate({ inputRange: [0, 1], outputRange: [0, 54] });
  const rowUp = swapTurn.interpolate({ inputRange: [0, 1], outputRange: [0, -54] });
  const goLift = goReveal.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const pillPulse = searchPulse.interpolate({ inputRange: [0.28, 1], outputRange: [0.55, 1] });
  useEffect(() => {
    if (helmetPhase !== "searching") {
      searchPulse.stopAnimation();
      searchPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(searchPulse, { toValue: 0.28, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(searchPulse, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [helmetPhase, searchPulse]);
  useEffect(() => {
    Animated.timing(slashOpacity, {
      toValue: helmetPhase === "on" ? 0 : 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [helmetPhase, slashOpacity]);
  useEffect(() => {
    if (!showGo) {
      goReveal.setValue(0);
      return;
    }
    goReveal.setValue(0);
    Animated.timing(goReveal, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [showGo, goReveal]);
  const connectLabel = helmetPhase === "on" ? "Helmet connected" : helmetPhase === "searching" ? "Searching…" : "Connect helmet";

  return (
    <View style={styles.screen}>
      <View style={[styles.page, { paddingTop: insets.top + 10, paddingBottom: 12 + bottomInset }]}>
        {page === "debug" ? (
          <DebugScreen
            gps={gpsRef.current}
            gpsMessage={gpsMessage}
            bleMessage={bleMessage}
            connected={screen.bleConnected}
            sensors={sensors}
            holding={debugHold}
            listening={listening}
            buttonPressed={buttonPressed}
            monitorOn={monitorOn}
            onBack={closeDebug}
            onConnect={() => void connectHelmet()}
            onLeft={() => holdDebug("left")}
            onFront={() => holdDebug("front")}
            onRight={() => holdDebug("right")}
            onStop={stopDebugCue}
            onToggleMonitor={() => setMonitorOn((on) => !on)}
          />
        ) : page === "settings" ? (
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
                <MiniVehicle kind="bicycle" size={34} color={vehicle === "bicycle" ? BG : TEXT} />
                <Text style={[styles.choicePillText, vehicle === "bicycle" ? styles.choiceTextOn : null]}>Bicycle</Text>
              </Pressable>
              <Pressable style={[styles.choicePill, vehicle === "scooter" ? styles.choiceOn : null]} onPress={() => setVehicle("scooter")}>
                <MiniVehicle kind="scooter" size={34} color={vehicle === "scooter" ? BG : TEXT} />
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
            <View style={styles.footerLinks}>
              <Pressable onPress={() => (playing ? setPlaying(false) : playDemo())}>
                <Text style={styles.footerLink}>{playing ? "Pause demo" : "Play demo"}</Text>
              </Pressable>
              <Pressable onPress={openDebug}>
                <Text style={styles.footerLink}>Debug</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.body}>
            {page === "ride" ? (
              <View style={styles.topBar}>
                <View
                  style={[styles.ridePill, screen.bleConnected ? styles.ridePillOn : null]}
                  onLayout={(event) => {
                    const next = event.nativeEvent.layout.width;
                    setPillWidth((current) => (current === next ? current : next));
                  }}
                >
                  {screen.bleConnected && pillWidth > 0 ? (
                    <Svg width={pillWidth} height={52} style={StyleSheet.absoluteFill}>
                      <Rect width={pillWidth} height={52} rx={26} fill="#F2F2F0" />
                    </Svg>
                  ) : null}
                  <HelmetArt width={40} tone={screen.bleConnected ? "dark" : "light"} />
                  <Text style={[styles.ridePillText, screen.bleConnected ? styles.ridePillTextOn : null]} numberOfLines={1}>
                    {screen.bleConnected ? "Helmet connected" : "Helmet offline"}
                  </Text>
                  {screen.bleConnected ? (
                    <View style={styles.rideCheck} accessibilityLabel="Connected">
                      <Svg width={28} height={28} style={StyleSheet.absoluteFill}>
                        <Rect width={28} height={28} rx={14} fill="#14161A" />
                      </Svg>
                      <CheckIcon size={16} color={TEXT} />
                    </View>
                  ) : null}
                </View>
                <Pressable style={styles.endButton} onPress={endRide} accessibilityLabel="End ride">
                  <Text style={styles.endText}>End</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.topBar}>
                  <Animated.View style={{ flex: 1, height: 52, opacity: pillPulse }}>
                    <Pressable
                      style={styles.connect}
                      onPress={() => void connectHelmet()}
                      disabled={helmetPhase === "searching"}
                      accessibilityLabel={connectLabel}
                      accessibilityState={{ selected: helmetPhase === "on" }}
                    >
                      <BluetoothIcon size={20} />
                      <Text style={styles.connectText} numberOfLines={1}>{connectLabel}</Text>
                    </Pressable>
                  </Animated.View>
                  <View style={styles.helmetSlot}>
                    <Pressable
                      style={styles.helmetButton}
                      onPress={() => void connectHelmet()}
                      disabled={helmetPhase === "searching"}
                      accessibilityLabel={helmetPhase === "on" ? "Helmet connected" : "Helmet disconnected"}
                      accessibilityState={{ selected: helmetPhase === "on" }}
                    >
                      <Animated.View pointerEvents="none" style={[styles.helmetRing, { opacity: searchPulse }]}>
                        <Svg width={52} height={52} viewBox="0 0 52 52">
                          <Circle cx={26} cy={26} r={25} stroke={MUTED} strokeWidth={2} strokeDasharray="4 3" strokeDashoffset={3.6} fill="none" />
                        </Svg>
                      </Animated.View>
                      <HelmetArt width={34} tone="light" />
                      <Animated.View pointerEvents="none" style={[styles.helmetSlash, { opacity: slashOpacity }]}>
                        <Svg width={52} height={52} viewBox="0 0 52 52">
                          <Line x1={6.2} y1={6.2} x2={45.8} y2={45.8} stroke={MUTED} strokeWidth={3} strokeLinecap="butt" />
                        </Svg>
                      </Animated.View>
                    </Pressable>
                  </View>
                  <Pressable style={styles.homeCircle} onPress={openDebug} accessibilityLabel="Debug">
                    <BugIcon size={26} />
                  </Pressable>
                  <Pressable style={styles.homeCircle} onPress={openSettings} accessibilityLabel="Open settings">
                    <GearIcon size={26} />
                  </Pressable>
                </View>
                <View style={styles.routeCard}>
                  <View style={styles.markers}>
                    <Animated.View style={[styles.originSlot, { transform: [{ translateY: rowDown }] }]}>
                      <View style={styles.originDot} />
                    </Animated.View>
                    <View style={styles.markerLine} />
                    <Animated.View style={[styles.pinSlot, { transform: [{ translateY: rowUp }] }]}>
                      <PinIcon size={16} />
                    </Animated.View>
                  </View>
                  <View style={styles.routeFields}>
                    <Animated.View style={[styles.fieldRow, { transform: [{ translateY: rowDown }] }]}>
                      <Text style={styles.fieldText} numberOfLines={1}>Your location</Text>
                      <Pressable style={styles.iconButton} onPress={() => setFocusNonce((value) => value + 1)} accessibilityLabel="Use current location">
                        <TargetIcon size={20} />
                      </Pressable>
                    </Animated.View>
                    <View style={styles.fieldDivider} />
                    <Animated.View style={[styles.fieldRow, { transform: [{ translateY: rowUp }] }]}>
                      {listening ? (
                        <View style={styles.listeningRow}>
                          <Waveform />
                          <Text style={styles.fieldText}>Listening</Text>
                        </View>
                      ) : (
                        <TextInput
                          style={styles.searchInput}
                          value={destination}
                          onChangeText={setDestination}
                          placeholder="Where to?"
                          placeholderTextColor={TEXT}
                          autoCapitalize="words"
                          returnKeyType="search"
                          onSubmitEditing={() => void findPlaces()}
                        />
                      )}
                    </Animated.View>
                  </View>
                  <Pressable style={styles.swapButton} onPress={pressSwap} accessibilityLabel="Swap route locations">
                    <Animated.View style={{ transform: [{ rotate: swapSpin }] }}>
                      <SwapIcon size={22} />
                    </Animated.View>
                  </Pressable>
                </View>
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}
                {searching ? <Text style={styles.notice}>Searching places…</Text> : null}
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
              </>
            )}
            <View style={[styles.mapFrame, page === "ride" ? styles.mapRide : styles.mapHome, page === "search" && typing ? styles.mapTyping : null]}>
              <StreetMap screen={screen} vehicle={vehicle} user={userPoint} focusNonce={focusNonce} />
              {page === "ride" && tripMeters > 0 ? (
                <View style={styles.tripChip}>
                  <Text style={styles.tripText}>{formatTrip(tripMeters, units)}</Text>
                </View>
              ) : null}
              {showGo ? (
                <Animated.View style={[styles.go, { opacity: goReveal, transform: [{ translateY: goLift }] }]}>
                  <Pressable style={styles.goHit} onPress={pressGo} accessibilityLabel="Go">
                    <Svg width={104} height={64} viewBox="0 0 104 64">
                      <Rect width={104} height={64} rx={18} fill="#FFC400" />
                      <SvgText x={52} y={41} fill="#14161A" fontSize={26} fontWeight="800" textAnchor="middle">
                        GO
                      </SvgText>
                    </Svg>
                  </Pressable>
                </Animated.View>
              ) : null}
            </View>
            {page === "ride" ? (
              <View style={styles.vibeBlock}>
                {screen.banner ? <Text style={styles.banner}>{screen.banner}</Text> : null}
                <Text style={styles.vibeCaption}>VIBRATING ON YOUR HELMET</Text>
                <View style={styles.motors} accessibilityLabel="Helmet vibration">
                  <VibrationPad label="Left" direction="left" on={screen.motors.left} />
                  <VibrationPad label="Front" direction="up" on={screen.motors.front} />
                  <VibrationPad label="Right" direction="right" on={screen.motors.right} />
                </View>
              </View>
            ) : null}
          </View>
        )}
      </View>
      {departing ? <GoFilm kind={vehicle} onDone={beginRide} /> : null}
    </View>
  );
}

function quietStatus(text: string): boolean {
  return text === "Search for a place, or press GO."
    || text.endsWith(" is ready.")
    || text.startsWith("Press GO")
    || text.startsWith("Riding to")
    || text.startsWith("Playing the left")
    || text.startsWith("Ride north");
}

function Waveform() {
  const a = useRef(new Animated.Value(0.35)).current;
  const b = useRef(new Animated.Value(0.35)).current;
  const c = useRef(new Animated.Value(0.35)).current;
  const d = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loops = [a, b, c, d].map((value, index) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(index * 90),
          Animated.timing(value, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.35, duration: 280, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return loop;
    });
    return () => loops.forEach((loop) => loop.stop());
  }, [a, b, c, d]);
  return (
    <View style={styles.wave}>
      {[a, b, c, d].map((value, index) => (
        <Animated.View key={index} style={[styles.waveBar, { transform: [{ scaleY: value }] }]} />
      ))}
    </View>
  );
}

function VibrationPad({ label, direction, on }: { label: string; direction: "left" | "up" | "right"; on: boolean }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const ink = on ? "#14161A" : TEXT;
  return (
    <View
      pointerEvents="none"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((current) => (current.width === width && current.height === height ? current : { width, height }));
      }}
      style={[styles.motor, on ? styles.motorOn : null]}
    >
      {on && box.width > 0 ? (
        <Svg width={box.width} height={box.height} style={StyleSheet.absoluteFill}>
          <Rect width={box.width} height={box.height} rx={18} fill="#FFC400" />
        </Svg>
      ) : null}
      <CueArrow direction={direction} size={30} color={ink} />
      <Text style={[styles.motorText, on ? styles.motorTextOn : null]}>{label}</Text>
      <Text style={[styles.motorState, on ? styles.motorStateOn : null]}>{on ? "Buzzing" : "Idle"}</Text>
    </View>
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
  connect: { flex: 1, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 2, borderStyle: "dashed", borderColor: MUTED, borderRadius: 26, paddingHorizontal: 12, overflow: "hidden" },
  connectText: { color: TEXT, fontWeight: "700", fontSize: 16 },
  helmetSlot: { width: 52, height: 52 },
  helmetRing: { position: "absolute", left: 0, top: 0, width: 52, height: 52 },
  helmetButton: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  helmetSlash: { position: "absolute", left: 0, top: 0, width: 52, height: 52 },
  homeCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: SURFACE, borderWidth: 2, borderColor: "#4A4E54", alignItems: "center", justifyContent: "center" },
  roundButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  routeCard: { height: 110, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 8, backgroundColor: SURFACE, borderRadius: 16, borderWidth: 2, borderColor: "#4A4E54" },
  markers: { width: 20, height: 106 },
  originSlot: { position: "absolute", top: 21, left: 0, right: 0, alignItems: "center" },
  pinSlot: { position: "absolute", top: 72, left: 0, right: 0, alignItems: "center" },
  markerLine: { position: "absolute", top: 32, bottom: 32, left: 9, width: 2, backgroundColor: "#4A4E54" },
  routeFields: { flex: 1, height: 106, overflow: "hidden" },
  fieldRow: { height: 52, flexDirection: "row", alignItems: "center", gap: 6 },
  fieldText: { flex: 1, color: TEXT, fontSize: 16, fontWeight: "500" },
  fieldDivider: { height: 2, backgroundColor: "#4A4E54" },
  originDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#3DA5FF" },
  searchInput: { flex: 1, color: TEXT, fontSize: 16, fontWeight: "500", paddingVertical: 0 },
  iconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: BG, borderWidth: 2, borderColor: "#4A4E54", alignItems: "center", justifyContent: "center" },
  listeningRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  wave: { width: 22, height: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  waveBar: { width: 3, height: 16, borderRadius: 2, backgroundColor: TEXT },
  swapButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: BG, borderWidth: 2, borderColor: "#4A4E54", alignItems: "center", justifyContent: "center" },
  notice: { color: MUTED, fontSize: 13, lineHeight: 18 },
  mapFrame: { flex: 1, minHeight: 160, borderRadius: 22, overflow: "hidden", backgroundColor: "#1a1c22" },
  mapHome: { borderRadius: 0 },
  mapRide: { borderRadius: 20, borderWidth: 2, borderColor: "#4A4E54" },
  mapTyping: { flex: 0, height: 120, minHeight: 0 },
  go: { position: "absolute", right: 16, bottom: 16, width: 104, height: 64, zIndex: 2 },
  goHit: { width: 104, height: 64 },
  tripChip: { position: "absolute", left: 12, top: 12, backgroundColor: SURFACE, borderRadius: 12, borderWidth: 2, borderColor: "#4A4E54", paddingHorizontal: 12, paddingVertical: 8 },
  tripText: { color: TEXT, fontWeight: "700", fontSize: 15 },
  choices: { maxHeight: 220, borderRadius: 16, backgroundColor: SURFACE },
  choice: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#3a3e46" },
  choiceName: { color: TEXT, fontWeight: "700" },
  choiceDetail: { color: MUTED, fontSize: 12 },
  ridePill: { flex: 1, height: 52, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 26, borderWidth: 2, borderColor: TEXT, paddingLeft: 14, paddingRight: 10, overflow: "hidden" },
  ridePillOn: { borderColor: "#F2F2F0" },
  rideCheck: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  ridePillText: { flex: 1, color: TEXT, fontWeight: "700", fontSize: 16 },
  ridePillTextOn: { color: "#14161A" },
  endButton: { height: 52, borderWidth: 2, borderColor: TEXT, borderRadius: 26, paddingHorizontal: 22, alignItems: "center", justifyContent: "center" },
  endText: { color: TEXT, fontWeight: "700", fontSize: 16 },
  vibeBlock: { gap: 8 },
  vibeCaption: { color: MUTED, fontSize: 14, fontWeight: "700", letterSpacing: 0.84 },
  motors: { flexDirection: "row", gap: 10 },
  motor: { flex: 1, minHeight: 112, borderRadius: 18, borderWidth: 2, borderColor: "#4A4E54", backgroundColor: SURFACE, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 14, overflow: "hidden" },
  motorOn: { backgroundColor: "transparent", borderColor: "#FFC400" },
  motorText: { color: TEXT, fontWeight: "800", fontSize: 17 },
  motorTextOn: { color: "#14161A" },
  motorState: { color: TEXT, fontSize: 13, fontWeight: "500" },
  motorStateOn: { color: "#14161A", fontWeight: "700" },
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
  footerLinks: { flexDirection: "row", gap: 22, marginTop: 18 },
  footerLink: { color: MUTED, fontWeight: "700", fontSize: 15 },
});
