import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";

const FRAME_MS = 84;

const FRAMES = [
  require("../assets/go/f01.png"),
  require("../assets/go/f02.png"),
  require("../assets/go/f03.png"),
  require("../assets/go/f04.png"),
  require("../assets/go/f05.png"),
  require("../assets/go/f06.png"),
  require("../assets/go/f07.png"),
  require("../assets/go/f08.png"),
  require("../assets/go/f09.png"),
  require("../assets/go/f10.png"),
  require("../assets/go/f11.png"),
  require("../assets/go/f12.png"),
  require("../assets/go/f13.png"),
  require("../assets/go/f14.png"),
  require("../assets/go/f15.png"),
  require("../assets/go/f16.png"),
  require("../assets/go/f17.png"),
  require("../assets/go/f18.png"),
  require("../assets/go/f19.png"),
  require("../assets/go/f20.png"),
  require("../assets/go/f21.png"),
  require("../assets/go/f22.png"),
  require("../assets/go/f23.png"),
  require("../assets/go/f24.png"),
  require("../assets/go/f25.png"),
  require("../assets/go/f26.png"),
  require("../assets/go/f27.png"),
  require("../assets/go/f28.png"),
  require("../assets/go/f29.png"),
];

export function GoFilm({ onDone }: { onDone: () => void }) {
  const [frame, setFrame] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      if (index >= FRAMES.length) {
        clearInterval(timer);
        doneRef.current();
        return;
      }
      setFrame(index);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.fill} accessibilityLabel="Starting ride">
      <Image source={FRAMES[frame]} style={styles.film} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  film: { width: "100%", height: "100%" },
});
