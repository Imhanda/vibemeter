import React from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { C } from "../theme";

interface Props {
  /** "prompt" before the OS dialog has been shown; "denied" after the user said no. */
  state: "prompt" | "denied";
  /** Trigger the OS microphone prompt. */
  onAllow: () => void;
  /** Fall back to manual emoji rating. */
  onRateManually: () => void;
}

function Point({ text }: { text: string }) {
  return (
    <View style={styles.pointRow}>
      <Text style={styles.pointDot}>•</Text>
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

/**
 * Pre-permission explainer shown inside the check-in flow, *before* the OS
 * microphone prompt (App Store 5.1.1 / PRD onboarding). Never leaves a dead
 * mic button: both states offer the manual path.
 */
export function PermissionPrimer({ state, onAllow, onRateManually }: Props) {
  if (state === "denied") {
    return (
      <View style={styles.card} accessibilityLabel="Microphone permission is off">
        <Text style={styles.emoji}>🎙️</Text>
        <Text style={styles.title}>Microphone is off</Text>
        <Text style={styles.body}>
          No problem — you can still rate the vibe yourself. To use the 10-second
          auto scan, turn on the microphone for VibeMeter in Settings.
        </Text>
        <TouchableOpacity onPress={onRateManually} style={styles.primaryWrap} accessibilityRole="button">
          <LinearGradient colors={[C.teal, C.tealDim]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primary}>
            <Text style={styles.primaryText}>Rate the vibe manually</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openSettings()} accessibilityRole="button">
          <Text style={styles.secondary}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.card} accessibilityLabel="Microphone permission explainer">
      <Text style={styles.emoji}>🎤</Text>
      <Text style={styles.title}>Let VibeMeter listen for 10 seconds</Text>
      <View style={styles.points}>
        <Point text="Measures crowd noise and music energy — not conversations" />
        <Point text="Sent to our server, scored, then deleted straight away" />
        <Point text="Never recorded or saved — on your phone or ours" />
      </View>
      <TouchableOpacity onPress={onAllow} style={styles.primaryWrap} accessibilityRole="button">
        <LinearGradient colors={[C.teal, C.tealDim]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primary}>
          <Text style={styles.primaryText}>Allow microphone</Text>
        </LinearGradient>
      </TouchableOpacity>
      <TouchableOpacity onPress={onRateManually} accessibilityRole="button">
        <Text style={styles.secondary}>Not now — I'll rate manually</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    backgroundColor: C.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    gap: 12,
    alignItems: "center",
  },
  emoji: { fontSize: 36 },
  title: { color: C.textPrimary, fontSize: 17, fontWeight: "700", textAlign: "center" },
  body: { color: C.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 19 },
  points: { alignSelf: "stretch", gap: 8, marginVertical: 4 },
  pointRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  pointDot: { color: C.teal, fontSize: 14, lineHeight: 18 },
  pointText: { color: C.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },
  primaryWrap: { alignSelf: "stretch", marginTop: 4 },
  primary: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondary: { color: C.textSecondary, fontSize: 13, fontWeight: "600", paddingVertical: 6 },
});
