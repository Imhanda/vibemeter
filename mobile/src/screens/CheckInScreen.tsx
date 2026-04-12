import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { submitVibe } from "../api/vibe";
import { DEFAULT_LOCATION } from "../config";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "CheckIn">;

const EMOJI_OPTIONS: { label: string; value: number }[] = [
  { label: "💤", value: 1 },
  { label: "😐", value: 2 },
  { label: "😊", value: 3 },
  { label: "⚡", value: 4 },
  { label: "🔥", value: 5 },
];

export function CheckInScreen({ route, navigation }: Props) {
  const { placeId, name } = route.params;
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; badge: string | null } | null>(null);

  const handleSubmit = async () => {
    if (selected == null) return;
    setSubmitting(true);
    try {
      const resp = await submitVibe({
        place_id: placeId,
        manual_rating: selected,
        client_lat: DEFAULT_LOCATION.lat,
        client_lng: DEFAULT_LOCATION.lng,
      });
      setResult({ score: resp.venue_score, badge: resp.badge_earned });
    } catch (e: any) {
      const status = (e as any).status;
      if (status === 429) {
        Alert.alert("Slow down!", "You've already checked in here recently. Try again later.");
      } else if (status === 403) {
        Alert.alert("Too far away", "You need to be at the venue to check in.");
      } else {
        Alert.alert("Error", e.message ?? "Check-in failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <View style={styles.container}>
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>Vibe Submitted!</Text>
          <Text style={styles.resultScore}>{Math.round(result.score)}</Text>
          <Text style={styles.resultLabel}>New venue score</Text>
          {result.badge && (
            <View style={styles.badgeBox}>
              <Text style={styles.badgeText}>🏅 Badge earned: {result.badge}</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.venueName}>{name}</Text>
      <Text style={styles.instruction}>How's the vibe right now?</Text>

      <View style={styles.emojiRow}>
        {EMOJI_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.emojiBtn, selected === opt.value && styles.emojiBtnActive]}
            onPress={() => setSelected(opt.value)}
          >
            <Text style={styles.emoji}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.hint}>
        {/* TODO Weeks 5–6: replace with on-device YAMNet audio capture */}
        Using emoji rating (audio check-in coming soon)
      </Text>

      <TouchableOpacity
        style={[styles.submitBtn, (selected == null || submitting) && styles.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={selected == null || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>Submit Vibe</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f14",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  venueName: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  instruction: { color: "#aaa", fontSize: 15, marginBottom: 36, textAlign: "center" },
  emojiRow: { flexDirection: "row", gap: 12, marginBottom: 32 },
  emojiBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1a1a22",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  emojiBtnActive: { borderColor: "#14b8a6", backgroundColor: "#0d2926" },
  emoji: { fontSize: 26 },
  hint: { color: "#555", fontSize: 11, marginBottom: 32, textAlign: "center" },
  submitBtn: {
    backgroundColor: "#14b8a6",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 48,
    alignItems: "center",
  },
  submitBtnDisabled: { backgroundColor: "#1a1a22" },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  resultBox: { alignItems: "center", gap: 12 },
  resultTitle: { color: "#14b8a6", fontSize: 18, fontWeight: "700" },
  resultScore: { color: "#fff", fontSize: 64, fontWeight: "800" },
  resultLabel: { color: "#aaa", fontSize: 14 },
  badgeBox: {
    backgroundColor: "#1a1a22",
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  badgeText: { color: "#f59e0b", fontSize: 14, fontWeight: "600" },
  doneBtn: {
    marginTop: 16,
    backgroundColor: "#14b8a6",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  doneBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
