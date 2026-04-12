import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getVenueDetail, VenueDetail } from "../api/places";
import { VenueSocket, ScoreUpdateEvent } from "../api/websocket";
import { VibeBadge, confidenceBadge } from "../components/VibeBadge";
import { useVibeStore } from "../store/useVibeStore";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "VenueDetail">;

export function VenueDetailScreen({ route, navigation }: Props) {
  const { placeId } = route.params;
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<VenueSocket | null>(null);
  const { updateVenueScore } = useVibeStore();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getVenueDetail(placeId);
      setVenue(data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load venue");
    } finally {
      setLoading(false);
    }
  }, [placeId]);

  // Subscribe to live score updates via WebSocket
  useEffect(() => {
    const handleUpdate = (evt: ScoreUpdateEvent) => {
      setVenue((prev) =>
        prev
          ? {
              ...prev,
              vibe_score: evt.vibe_score,
              confidence: evt.confidence,
              check_in_count: evt.check_in_count,
            }
          : prev
      );
      updateVenueScore(evt.place_id, evt.vibe_score, evt.confidence, evt.check_in_count);
    };

    const sock = new VenueSocket(placeId, handleUpdate);
    sock.connect();
    socketRef.current = sock;
    return () => sock.disconnect();
  }, [placeId, updateVenueScore]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#14b8a6" size="large" />
      </View>
    );
  }

  if (error || !venue) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "Venue not found"}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const cbadge = confidenceBadge(venue.confidence, venue.check_in_count);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Score hero */}
      <View style={styles.hero}>
        <VibeBadge score={venue.vibe_score} confidence={venue.confidence} size="lg" />
        {cbadge !== "" && (
          <Text style={styles.confidenceLabel}>{cbadge}</Text>
        )}
        <Text style={styles.checkInCount}>
          {venue.check_in_count} check-in{venue.check_in_count !== 1 ? "s" : ""} in the last 3 hours
        </Text>
      </View>

      {/* Check in button */}
      <TouchableOpacity
        style={styles.checkInBtn}
        onPress={() =>
          navigation.navigate("CheckIn", { placeId, name: route.params.name })
        }
      >
        <Text style={styles.checkInBtnText}>Check the Vibe</Text>
      </TouchableOpacity>

      {/* Signal breakdown */}
      {venue.signal_breakdown && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Signal Breakdown</Text>
          {(
            [
              ["Crowd Energy", venue.signal_breakdown.crowd_energy],
              ["Music Energy", venue.signal_breakdown.music_energy],
              ["Ambient Volume", venue.signal_breakdown.ambient_db],
            ] as [string, number][]
          ).map(([label, val]) => (
            <View key={label} style={styles.signalRow}>
              <Text style={styles.signalLabel}>{label}</Text>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${Math.round(val * 100)}%` }]} />
              </View>
              <Text style={styles.signalVal}>{Math.round(val * 100)}%</Text>
            </View>
          ))}
        </View>
      )}

      {/* Score history */}
      {venue.history.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Score History (last 24h)</Text>
          {venue.history.map((h) => (
            <View key={h.hour} style={styles.historyRow}>
              <Text style={styles.historyHour}>{h.hour}</Text>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${Math.round(h.score)}%` }]} />
              </View>
              <Text style={styles.historyScore}>{Math.round(h.score)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f14" },
  center: { flex: 1, backgroundColor: "#0f0f14", justifyContent: "center", alignItems: "center", gap: 12 },
  hero: { alignItems: "center", paddingVertical: 32, gap: 8 },
  confidenceLabel: {
    color: "#14b8a6",
    fontSize: 13,
    fontWeight: "600",
    borderWidth: 1,
    borderColor: "#14b8a6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  checkInCount: { color: "#666", fontSize: 12, marginTop: 4 },
  checkInBtn: {
    marginHorizontal: 24,
    backgroundColor: "#14b8a6",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  checkInBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  section: { marginTop: 28, paddingHorizontal: 20 },
  sectionTitle: { color: "#aaa", fontSize: 11, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 },
  signalRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 10 },
  signalLabel: { color: "#ccc", fontSize: 13, width: 110 },
  signalVal: { color: "#888", fontSize: 12, width: 34, textAlign: "right" },
  barBg: { flex: 1, height: 6, backgroundColor: "#1a1a22", borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: "#14b8a6", borderRadius: 3 },
  historyRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 10 },
  historyHour: { color: "#888", fontSize: 12, width: 42 },
  historyScore: { color: "#aaa", fontSize: 12, width: 28, textAlign: "right" },
  errorText: { color: "#ef4444", fontSize: 14 },
  retryBtn: { backgroundColor: "#1a1a22", borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: "#14b8a6", fontWeight: "600" },
});
