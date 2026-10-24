import { Animated, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

export type VehicleKind = "bicycle" | "scooter";

export const INK = "#14161A";
export const PAPER = "#F2F2F0";
export const YELLOW = "#FFC400";
export const BLUE = "#3DA5FF";
export const MUTED = "#8B929C";
export const SURFACE = "#2E3137";

type Spin = string | Animated.AnimatedInterpolation<string>;

const GEAR = gearOutline(24, 24, 9, 15.5, 8);

export function HelmetIcon({ size = 40, color = INK }: { size?: number; color?: string }) {
  const height = (size * 48) / 64;
  return (
    <Svg width={size} height={height} viewBox="0 0 64 48" accessibilityRole="image">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M10 30c0-12 8-20 20-20 11 0 20 7 22 16 2 1 6 4 6 8 0 3-2 5-6 6-2 2-8 4-14 5-8 1-16-1-20-5-6-1-8-5-8-10zm12-8 8-2 2 6-8 2-2-6zm12-1 10-1 1 6-10 1-1-6zm-8 10 12-2 1 5-12 2-1-5z"
      />
    </Svg>
  );
}

export function HelmetTile({ size = 36 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 8, backgroundColor: PAPER, alignItems: "center", justifyContent: "center" }}>
      <HelmetIcon size={size * 0.78} color={INK} />
    </View>
  );
}

export function BluetoothIcon({ size = 16, color = PAPER }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7 7 L17 17 L12 21 V3 L17 7 L7 17" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

export function SearchIcon({ size = 18, color = MUTED }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="6.5" stroke={color} strokeWidth={2} />
      <Path d="M16 16 L20.5 20.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function PersonIcon({ size = 54, color = PAPER }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Circle cx="32" cy="22" r="8" stroke={color} strokeWidth={2.4} />
      <Path d="M16 48c2.4-8 8-12 16-12s13.6 4 16 12" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 22, color = PAPER }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M14 5 L7 12 L14 19" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CueArrow({ direction, color }: { direction: "left" | "up" | "right"; color: string }) {
  const d = direction === "left" ? "M15 5 L7 12 L15 19" : direction === "right" ? "M9 5 L17 12 L9 19" : "M5 15 L12 7 L19 15";
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function MiniVehicle({ kind, size = 22, color = INK }: { kind: VehicleKind; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {kind === "scooter" ? (
        <>
          <Circle cx="6" cy="17" r="2.5" stroke={color} strokeWidth={1.8} />
          <Circle cx="18" cy="17" r="2.5" stroke={color} strokeWidth={1.8} />
          <Path d="M6 17 H14 M8 14 H13 M14 17 L17 8 H21" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <Circle cx="6" cy="16" r="3" stroke={color} strokeWidth={1.8} />
          <Circle cx="18" cy="16" r="3" stroke={color} strokeWidth={1.8} />
          <Path d="M6 16 H10 L12 10 H16 M10 16 L12 10 M15 9 H20 M14 10 L18 16" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </Svg>
  );
}

export function RiderBadge({ kind, size = 64 }: { kind: VehicleKind; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: PAPER, borderWidth: Math.max(3, size * 0.06), borderColor: BLUE, alignItems: "center", justifyContent: "center" }}>
      <MiniVehicle kind={kind} size={size * 0.58} color="#1E1245" />
    </View>
  );
}

export function GearIcon({ size = 30, color = PAPER }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityRole="image">
      <Path
        d={`${GEAR} M24 24 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0`}
        fill={color}
        fillRule="evenodd"
      />
    </Svg>
  );
}

export function VehicleIcon({ kind, size }: { kind: VehicleKind; size: number }) {
  return <RollingVehicle kind={kind} size={size} spin="0deg" />;
}

export function RollingVehicle({ kind, size, spin }: { kind: VehicleKind; size: number; spin: Spin }) {
  const height = size * (78 / 120);
  const wheel = size * (36 / 120);
  const wheelTop = size * (34 / 120);
  return (
    <View style={{ width: size, height }}>
      <Animated.View style={{ position: "absolute", left: size * (4 / 120), top: wheelTop, width: wheel, height: wheel, transform: [{ rotate: spin }] }}>
        <Wheel size={wheel} />
      </Animated.View>
      <Animated.View style={{ position: "absolute", left: size * (80 / 120), top: wheelTop, width: wheel, height: wheel, transform: [{ rotate: spin }] }}>
        <Wheel size={wheel} />
      </Animated.View>
      <View style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
        {kind === "scooter" ? <ScooterFrame width={size} height={height} /> : <BicycleFrame width={size} height={height} />}
      </View>
    </View>
  );
}

function Wheel({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Circle cx="18" cy="18" r="15" stroke={INK} strokeWidth={2.6} fill={PAPER} />
      <Path d="M18 4 V32 M4 18 H32 M8 8 L28 28 M28 8 L8 28" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
      <Circle cx="18" cy="18" r="2.2" fill={INK} />
    </Svg>
  );
}

function BicycleFrame({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 120 78" fill="none">
      <Path
        d="M22 52 H48 M48 52 V28 M48 28 L22 52 M48 28 L84 32 L98 52 M48 52 L84 32 M74 24 H108 M36 24 H58"
        stroke={INK}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ScooterFrame({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 120 78" fill="none">
      <Path
        d="M22 52 H72 M24 46 H68 M72 52 L86 18 L98 52 M78 18 H112"
        stroke={INK}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function gearOutline(cx: number, cy: number, root: number, tip: number, teeth: number): string {
  const parts: string[] = [];
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const mid = (tooth / teeth) * Math.PI * 2 - Math.PI / 2;
    const span = Math.PI / teeth;
    const corners: [number, number][] = [
      [mid - span * 0.48, root],
      [mid - span * 0.2, tip],
      [mid + span * 0.2, tip],
      [mid + span * 0.48, root],
    ];
    for (const [angle, radius] of corners) {
      const x = (cx + radius * Math.cos(angle)).toFixed(2);
      const y = (cy + radius * Math.sin(angle)).toFixed(2);
      parts.push(`${parts.length === 0 ? "M" : "L"}${x} ${y}`);
    }
  }
  return `${parts.join(" ")} Z`;
}
