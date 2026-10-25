import { Animated, Image, View } from "react-native";
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

export function CueArrow({ direction, color, size = 22 }: { direction: "left" | "up" | "right"; color: string; size?: number }) {
  const d = direction === "left" ? "M15 5 L7 12 L15 19" : direction === "right" ? "M9 5 L17 12 L9 19" : "M5 15 L12 7 L19 15";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const BICYCLE_GLYPH = { w: 237, h: 174, d: "M42.6 170.9 C24.4 166.6 7.9 149.5 3.4 130.3 C-6.1 90.1 33.9 53.7 72.8 67.1 C76.7 68.5 80.0 69.4 80.0 69.2 C80.0 68.9 77.0 60.7 73.4 51.0 L66.7 33.2 L59.9 32.8 C51.6 32.4 49.0 30.5 49.0 25.0 C49.0 18.3 50.1 18.0 71.6 18.0 C91.4 18.0 92.0 18.1 93.9 21.8 C96.7 27.2 92.1 33.0 84.9 33.0 C83.6 33.0 83.0 33.5 83.2 34.3 C89.8 52.9 97.7 72.9 98.5 72.7 C99.0 72.5 109.0 64.5 120.7 54.9 L141.8 37.5 L141.9 27.2 L142.0 17.0 L129.4 17.0 C113.7 17.0 111.0 15.9 111.0 9.3 C111.0 2.5 112.7 2.0 133.5 2.0 C158.3 2.0 157.0 0.8 157.0 23.2 L157.0 39.5 L162.2 52.8 C166.9 64.5 167.7 66.0 169.5 65.5 C184.0 61.5 204.3 67.0 216.5 78.2 C239.6 99.3 240.6 134.8 218.6 156.5 C207.8 167.2 196.0 172.0 180.4 172.0 C129.1 172.1 106.9 107.1 147.6 76.0 L153.7 71.3 L150.5 63.2 C148.7 58.8 146.9 54.7 146.6 54.1 C146.2 53.5 140.8 57.4 133.2 63.7 C116.7 77.6 102.6 89.4 102.2 89.6 C102.0 89.7 103.0 92.1 104.4 94.9 C111.9 109.6 111.8 127.5 104.2 143.0 C98.3 155.1 82.2 167.9 69.0 170.9 C63.6 172.2 48.0 172.1 42.6 170.9 Z M62.0 156.9 C74.8 154.9 86.3 146.2 91.7 134.6 C94.1 129.3 94.5 127.3 94.5 119.0 C94.5 110.0 92.2 99.9 90.2 100.0 C89.8 100.0 82.6 105.9 74.1 113.0 C57.6 126.9 55.6 127.8 51.3 123.8 C48.5 121.2 48.3 116.4 50.8 113.4 C51.7 112.3 58.7 106.2 66.3 100.0 C73.9 93.8 79.9 88.2 79.7 87.6 C79.1 85.8 68.9 81.1 63.0 79.9 C46.4 76.4 27.8 86.2 20.4 102.3 C16.0 111.7 16.2 125.7 20.7 135.1 C26.2 146.2 37.5 154.9 49.2 156.9 C52.1 157.4 54.7 157.8 55.0 157.9 C55.3 157.9 58.4 157.5 62.0 156.9 Z M194.8 154.8 C216.0 146.9 225.7 121.3 215.3 100.7 C208.3 86.8 190.2 76.9 176.6 79.4 L173.2 80.1 L180.6 98.5 C188.8 119.1 189.2 120.9 185.4 123.9 C178.4 129.4 175.8 126.6 167.0 104.6 C163.0 94.4 159.3 86.0 158.8 86.0 C156.6 86.0 148.7 94.9 146.0 100.4 C130.0 133.1 160.7 167.4 194.8 154.8 Z" };
const SCOOTER_GLYPH = { w: 217, h: 159, d: "M23.1 155.9 C-2.6 151.2 -5.6 114.2 19.2 105.4 C32.3 100.8 47.8 107.5 52.2 119.8 L53.4 123.0 L96.1 123.0 L138.7 123.0 L139.3 118.8 C140.2 111.9 146.6 100.4 153.0 94.1 C158.2 89.0 169.7 82.0 172.9 82.0 C173.6 82.0 173.8 81.1 173.5 79.8 C173.0 77.6 168.9 51.8 165.1 27.5 L163.4 16.5 L145.7 16.2 L128.0 16.0 L128.0 9.0 L128.0 2.0 L149.1 2.0 L170.2 2.0 L173.0 4.9 C176.7 8.6 175.3 1.1 188.2 83.6 L191.4 103.7 L195.8 104.9 C219.1 111.1 221.6 143.3 199.7 153.9 C183.1 161.9 162.0 148.6 162.0 130.0 C162.0 122.0 168.4 110.9 175.0 107.5 C177.6 106.1 177.7 105.9 176.9 101.4 C175.7 95.3 176.0 95.3 170.0 98.6 C159.4 104.4 152.9 115.4 152.2 128.6 L151.7 137.0 L102.9 137.0 L54.0 137.0 L52.6 140.3 C48.0 151.3 35.2 158.1 23.1 155.9 Z" };

export function vehicleGlyphSpec(kind: VehicleKind) {
  return kind === "scooter" ? SCOOTER_GLYPH : BICYCLE_GLYPH;
}

export function VehicleGlyph({ kind, width = 24, color = PAPER }: { kind: VehicleKind; width?: number; color?: string }) {
  const spec = vehicleGlyphSpec(kind);
  const height = width * (spec.h / spec.w);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${spec.w} ${spec.h}`}>
      <Path d={spec.d} fill={color} fillRule="evenodd" />
    </Svg>
  );
}

export function MiniVehicle({ kind, size = 22, color = INK }: { kind: VehicleKind; size?: number; color?: string }) {
  return <VehicleGlyph kind={kind} width={size} color={color} />;
}

export function RiderBadge({ kind, size = 64 }: { kind: VehicleKind; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: PAPER, borderWidth: Math.max(3, size * 0.06), borderColor: BLUE, alignItems: "center", justifyContent: "center" }}>
      <VehicleGlyph kind={kind} width={size * 0.74} color="#1E1245" />
    </View>
  );
}

export function HelmetArt({ width = 36, tone = "dark" }: { width?: number; tone?: "dark" | "light" }) {
  const height = Math.round(width * (558 / 751));
  return (
    <Image
      source={tone === "dark" ? require("../assets/helmet-dark.png") : require("../assets/helmet-light.png")}
      style={{ width, height }}
      resizeMode="contain"
    />
  );
}

export function HelmetMark({ size = 24, color = PAPER, slashed = false }: { size?: number; color?: string; slashed?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M6 18.5c.4-6.2 4.4-10 10-10s9.6 3.8 10 10c2.2.4 4 2 4 4.2 0 2.2-1.8 3.8-4.2 3.8H6.2C3.8 26.5 2 24.9 2 22.7c0-2.2 1.8-3.8 4-4.2z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M7 19.5h18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      {slashed ? <Path d="M9 8.5 L23.5 25" stroke={color} strokeWidth={1.8} strokeLinecap="round" /> : null}
    </Svg>
  );
}

export function CheckIcon({ size = 16, color = INK }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.5 L10 17.5 L19 7" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function MicIcon({ size = 16, color = PAPER }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3 a3 3 0 0 1 3 3 v6 a3 3 0 0 1 -6 0 V6 a3 3 0 0 1 3 -3z" stroke={color} strokeWidth={1.8} />
      <Path d="M7 11 a5 5 0 0 0 10 0 M12 16 v4 M9 20 h6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function TargetIcon({ size = 18, color = PAPER }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3.2" stroke={color} strokeWidth={1.8} />
      <Path d="M12 3 V7 M12 17 V21 M3 12 H7 M17 12 H21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function SwapIcon({ size = 20, color = PAPER }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 4 V20 M8 4 L5 8 M8 4 L11 8" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 20 V4 M16 20 L13 16 M16 20 L19 16" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PinIcon({ size = 16, color = YELLOW }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 21.5 C12 21.5 5.5 14.2 5.5 10 a6.5 6.5 0 0 1 13 0 c0 4.2-6.5 11.5-6.5 11.5z" fill={color} />
      <Circle cx="12" cy="10" r="2.2" fill={INK} />
    </Svg>
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
