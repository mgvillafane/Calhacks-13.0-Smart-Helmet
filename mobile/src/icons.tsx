import { Animated, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

export type VehicleKind = "bicycle" | "scooter";

export const INK = "#1c1915";
export const PAPER = "#f6f3ec";

type Spin = string | Animated.AnimatedInterpolation<string>;

const GEAR = gearOutline(24, 24, 9, 15.5, 8);

export function HelmetIcon({ size = 40, connected = false, color = INK }: { size?: number; connected?: boolean; color?: string }) {
  const height = (size * 44) / 64;
  const vent = connected ? PAPER : color;
  return (
    <Svg width={size} height={height} viewBox="0 0 64 44" fill="none" accessibilityRole="image">
      <Path
        d="M10 32c0-14 8-22 22-22s22 8 22 22Z"
        stroke={color}
        strokeWidth={2.6}
        strokeLinejoin="round"
        fill={connected ? color : "none"}
      />
      <Path d="M4 32h56" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
      <Path d="M22 16v9M32 14v11M42 16v9" stroke={vent} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function GearIcon({ size = 30, color = INK }: { size?: number; color?: string }) {
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
