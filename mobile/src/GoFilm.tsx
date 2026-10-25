import { useEffect, useRef, useState } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { vehicleGlyphSpec, VehicleKind } from "./icons";

const DURATION_MS = 2200;
const SMOKE = [
  { back: 28, r: 6, dy: 1, opacity: 0.92 },
  { back: 48, r: 10, dy: -2, opacity: 0.72 },
  { back: 72, r: 15, dy: 3, opacity: 0.56 },
  { back: 102, r: 20, dy: -1, opacity: 0.42 },
  { back: 136, r: 25, dy: 5, opacity: 0.32 },
  { back: 174, r: 29, dy: -4, opacity: 0.24 },
  { back: 216, r: 32, dy: 3, opacity: 0.16 },
  { back: 258, r: 28, dy: 7, opacity: 0.11 },
];

export function GoFilm({ kind, onDone }: { kind: VehicleKind; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const { width, height } = Dimensions.get("window");
  const spec = vehicleGlyphSpec(kind);
  const iconW = 156;
  const scale = iconW / spec.w;
  const iconH = spec.h * scale;
  const x = -iconW - 20 + progress * (width + iconW + 40);
  const y = (height - iconH) / 2;

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    const started = Date.now();
    const tick = () => {
      if (cancelled) return;
      const next = Math.min(1, (Date.now() - started) / DURATION_MS);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
      else doneRef.current();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <View style={styles.fill} accessibilityLabel="Starting ride">
      <Svg width={width} height={height}>
        <Rect width={width} height={height} fill="#000000" />
        {SMOKE.map((puff) => {
          const cx = x - puff.back;
          const cy = y + iconH * 0.62 + puff.dy;
          return (
            <G key={puff.back} opacity={puff.opacity}>
              <Circle cx={cx} cy={cy} r={puff.r} fill="#FFFFFF" opacity={0.5} />
              <Circle cx={cx} cy={cy} r={puff.r * 0.62} fill="#FFFFFF" opacity={0.7} />
              <Circle cx={cx} cy={cy} r={puff.r * 0.28} fill="#FFFFFF" opacity={0.85} />
            </G>
          );
        })}
        <G transform={`translate(${x}, ${y}) scale(${scale})`}>
          <Path d={spec.d} fill="#FFFFFF" fillRule="evenodd" />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 40,
    elevation: 24,
  },
});
