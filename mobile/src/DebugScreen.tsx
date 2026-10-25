import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeftIcon, MUTED, SURFACE, YELLOW } from "./icons";
import { GpsReading, gpsStatus } from "./gps";
import { SensorSample } from "./protocol";
import { DebugSide, micLevel } from "./debug";

const BG = "#14161A";
const TEXT = "#F2F2F0";

export function DebugScreen({
  gps,
  gpsMessage,
  bleMessage,
  connected,
  sensors,
  holding,
  listening,
  buttonPressed,
  onBack,
  onConnect,
  onLeft,
  onFront,
  onRight,
  onStop,
}: {
  gps: GpsReading | null;
  gpsMessage: string;
  bleMessage: string;
  connected: boolean;
  sensors: SensorSample | null;
  holding: DebugSide | null;
  listening: boolean;
  buttonPressed: boolean;
  onBack: () => void;
  onConnect: () => void;
  onLeft: () => void;
  onFront: () => void;
  onRight: () => void;
  onStop: () => void;
}) {
  const imu = sensors?.imuOk ? sensors : null;
  const mic = sensors?.micOk ? sensors.micPeak : null;
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <Pressable style={styles.round} onPress={onBack} accessibilityLabel="Back">
          <ChevronLeftIcon />
        </Pressable>
        <Text style={styles.title}>Debug</Text>
      </View>

      <Text style={styles.label}>GPS</Text>
      <Text style={styles.body}>{gps ? gpsStatus(gps, "granted") : gpsMessage}</Text>

      <Text style={styles.label}>TURNS</Text>
      <Text style={styles.note}>{connected ? bleMessage : "Connect the helmet to drive the motors."}</Text>
      <View style={styles.row}>
        <Pressable style={[styles.pill, holding === "left" ? styles.pillOn : null]} onPress={onLeft}>
          <Text style={[styles.pillText, holding === "left" ? styles.pillTextOn : null]}>Left</Text>
        </Pressable>
        <Pressable style={[styles.pill, holding === "front" ? styles.pillOn : null]} onPress={onFront}>
          <Text style={[styles.pillText, holding === "front" ? styles.pillTextOn : null]}>Front</Text>
        </Pressable>
        <Pressable style={[styles.pill, holding === "right" ? styles.pillOn : null]} onPress={onRight}>
          <Text style={[styles.pillText, holding === "right" ? styles.pillTextOn : null]}>Right</Text>
        </Pressable>
        <Pressable style={styles.pill} onPress={onStop}>
          <Text style={styles.pillText}>Stop</Text>
        </Pressable>
      </View>
      {connected ? null : (
        <Pressable style={styles.ghost} onPress={onConnect}>
          <Text style={styles.ghostText}>Connect helmet</Text>
        </Pressable>
      )}

      <Text style={styles.label}>HELMET BUTTON</Text>
      {connected ? (
        <View style={[styles.pill, buttonPressed ? styles.pillOn : null, styles.buttonState]}>
          <Text style={[styles.pillText, buttonPressed ? styles.pillTextOn : null]}>{buttonPressed ? "Pressed" : "Not pressed"}</Text>
        </View>
      ) : (
        <Text style={styles.body}>Connect the helmet to see the button.</Text>
      )}

      <Text style={styles.label}>IMU</Text>
      {connected && imu ? (
        <>
          <Text style={styles.body}>
            accel {fmt(imu.axMg / 1000)} {fmt(imu.ayMg / 1000)} {fmt(imu.azMg / 1000)} g
          </Text>
          <Text style={styles.body}>
            gyro {fmt(imu.gxDps10 / 10)} {fmt(imu.gyDps10 / 10)} {fmt(imu.gzDps10 / 10)} °/s
          </Text>
        </>
      ) : (
        <Text style={styles.body}>{connected ? "Helmet IMU is not reporting." : "Connect the helmet to see IMU samples."}</Text>
      )}

      <Text style={styles.label}>MICROPHONE</Text>
      {connected && mic != null ? (
        <>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${Math.round(micLevel(mic) * 100)}%` }]} />
          </View>
          <Text style={styles.body}>peak {mic}</Text>
        </>
      ) : (
        <Text style={styles.body}>{connected ? "Helmet microphone is not reporting." : "Connect the helmet to see the microphone level."}</Text>
      )}
      {connected ? (
        <>
          {listening ? <Text style={styles.body}>Listening</Text> : null}
          <Text style={styles.body}>This phone is playing the helmet microphone.</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function fmt(value: number): string {
  return value.toFixed(2);
}

const styles = StyleSheet.create({
  page: { gap: 12, paddingBottom: 28 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: TEXT, fontSize: 28, fontWeight: "800" },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  label: { color: MUTED, fontSize: 12, fontWeight: "700", letterSpacing: 1.3, marginTop: 8 },
  body: { color: TEXT, fontSize: 15, lineHeight: 21 },
  note: { color: MUTED, fontSize: 14, lineHeight: 19 },
  row: { flexDirection: "row", gap: 10 },
  pill: { flex: 1, minHeight: 56, borderRadius: 16, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  buttonState: { flex: 0, alignSelf: "flex-start", paddingHorizontal: 22 },
  pillOn: { backgroundColor: YELLOW },
  pillText: { color: TEXT, fontWeight: "800", fontSize: 16 },
  pillTextOn: { color: BG },
  ghost: { minHeight: 48, borderRadius: 16, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" },
  ghostText: { color: TEXT, fontWeight: "700" },
  meter: { height: 16, borderRadius: 8, backgroundColor: SURFACE, overflow: "hidden" },
  meterFill: { height: "100%", backgroundColor: YELLOW },
});
