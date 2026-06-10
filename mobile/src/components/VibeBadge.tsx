import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View, Animated } from "react-native";
import { C, vibeColor, vibeGradient, vibeLabel } from "../theme";

interface Props {
  score: number | null;
  confidence: number | null;
  size?: "sm" | "lg" | "hero";
}

export function confidenceBadge(confidence: number | null, checkInCount?: number): string {
  if (confidence == null || confidence === 0) return "";
  if ((checkInCount ?? 0) >= 5) return "Confident";
  if ((checkInCount ?? 0) >= 3) return "Growing";
  return "Early data";
}

export function VibeBadge({ score, confidence, size = "sm" }: Props) {
  const color = vibeColor(score);
  const glowOpacity = useRef(new Animated.Value(0.15)).current;

  useEffect(() => {
    if (size === "hero") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowOpacity, { toValue: 0.5, duration: 1800, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.15, duration: 1800, useNativeDriver: true }),
        ])
      ).start();
    }
    return () => glowOpacity.stopAnimation();
  }, [size, color]);

  if (size === "hero") {
    return (
      <View style={hero.container}>
        {/* Glow halo behind the circle */}
        <Animated.View
          style={[
            hero.glow,
            { backgroundColor: color, opacity: glowOpacity },
          ]}
        />
        {/* Score circle */}
        <View style={[hero.circle, { borderColor: color }]}>
          <Text style={[hero.score, { color }]}>
            {score != null ? Math.round(score) : "—"}
          </Text>
        </View>
        <Text style={[hero.label, { color }]}>{vibeLabel(score)}</Text>
      </View>
    );
  }

  if (size === "lg") {
    return (
      <View style={styles.container}>
        <View style={[styles.pillLg, { backgroundColor: color }]}>
          <Text style={styles.scoreLg}>{score != null ? Math.round(score) : "—"}</Text>
        </View>
        <Text style={[styles.label, styles.labelLg]}>{vibeLabel(score)}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.pill, { backgroundColor: color }]}>
        <Text style={styles.score}>{score != null ? Math.round(score) : "—"}</Text>
      </View>
      <Text style={styles.label}>{vibeLabel(score)}</Text>
    </View>
  );
}

export { vibeColor, vibeGradient };

const hero = StyleSheet.create({
  container: { alignItems: "center", gap: 10 },
  glow: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    transform: [{ scale: 1.35 }],
  },
  circle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bgBase,
  },
  score: { fontSize: 52, fontWeight: "900", letterSpacing: -1 },
  label: { fontSize: 16, fontWeight: "700" },
});

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 4 },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 42,
    alignItems: "center",
  },
  pillLg: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    minWidth: 72,
    alignItems: "center",
  },
  score: { color: "#fff", fontWeight: "800", fontSize: 14 },
  scoreLg: { color: "#fff", fontWeight: "800", fontSize: 28 },
  label: { color: C.textSecondary, fontSize: 11 },
  labelLg: { fontSize: 15, color: C.textPrimary },
});
