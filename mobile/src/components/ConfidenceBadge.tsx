import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { C } from "../theme";
import { confidenceBand, confidenceLabel } from "../lib/confidence";

const BAND_COLOR = {
  early: C.textSecondary,
  growing: C.buzzing,
  confident: C.teal,
} as const;

/**
 * Three-state confidence pill: Early data (<0.3) / Growing (0.3–0.7) /
 * Confident (>0.7). Renders nothing when confidence is unknown.
 */
export function ConfidenceBadge({ confidence }: { confidence: number | null | undefined }) {
  const band = confidenceBand(confidence);
  if (!band) return null;
  const color = BAND_COLOR[band];
  const label = confidenceLabel(band);
  return (
    <View
      style={[styles.pill, { borderColor: color }]}
      accessibilityLabel={`Confidence: ${label}`}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
});
