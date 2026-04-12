import React from "react";
import { StyleSheet, Text, View } from "react-native";

interface Props {
  score: number | null;
  confidence: number | null;
  size?: "sm" | "lg";
}

function vibeColor(score: number | null): string {
  if (score == null) return "#555";
  if (score > 75) return "#ef4444"; // raging — red
  if (score >= 50) return "#f59e0b"; // buzzing — amber
  return "#14b8a6"; // chill — teal
}

function vibeLabel(score: number | null, confidence: number | null): string {
  if (score == null || confidence == null) return "No data";
  if (confidence === 0) return "No data";
  if (score > 75) return "Raging 🔥";
  if (score >= 50) return "Buzzing ⚡";
  return "Chill 😎";
}

function confidenceBadge(confidence: number | null, checkInCount?: number): string {
  if (confidence == null || confidence === 0) return "";
  if ((checkInCount ?? 0) >= 5) return "Confident";
  if ((checkInCount ?? 0) >= 3) return "Growing";
  return "Early data";
}

export function VibeBadge({ score, confidence, size = "sm" }: Props) {
  const color = vibeColor(score);
  const isLarge = size === "lg";

  return (
    <View style={styles.container}>
      <View style={[styles.scorePill, { backgroundColor: color }, isLarge && styles.scorePillLg]}>
        <Text style={[styles.scoreText, isLarge && styles.scoreTextLg]}>
          {score != null ? Math.round(score) : "—"}
        </Text>
      </View>
      <Text style={[styles.label, isLarge && styles.labelLg]}>{vibeLabel(score, confidence)}</Text>
    </View>
  );
}

export { vibeColor, confidenceBadge };

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 4 },
  scorePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 42,
    alignItems: "center",
  },
  scorePillLg: { paddingHorizontal: 18, paddingVertical: 8, minWidth: 72 },
  scoreText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  scoreTextLg: { fontSize: 28 },
  label: { color: "#aaa", fontSize: 11 },
  labelLg: { fontSize: 15, color: "#ddd" },
});
