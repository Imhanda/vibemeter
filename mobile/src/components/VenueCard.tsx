import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NearbyVenue } from "../api/places";
import { vibeColor } from "./VibeBadge";

interface Props {
  venue: NearbyVenue;
  onPress: () => void;
}

export function VenueCard({ venue, onPress }: Props) {
  const color = vibeColor(venue.vibe_score);
  const distLabel =
    venue.distance_m < 1000
      ? `${Math.round(venue.distance_m)} m`
      : `${(venue.distance_m / 1000).toFixed(1)} km`;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.colorBar, { backgroundColor: color }]} />
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>{venue.name}</Text>
        <Text style={styles.meta}>
          {venue.type.toUpperCase()}  ·  {distLabel}
        </Text>
      </View>
      <View style={styles.scoreBox}>
        {venue.vibe_score != null ? (
          <>
            <Text style={[styles.score, { color }]}>{Math.round(venue.vibe_score)}</Text>
            <Text style={styles.scoreLabel}>vibe</Text>
          </>
        ) : (
          <Text style={styles.noData}>—</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a22",
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    overflow: "hidden",
  },
  colorBar: { width: 5, alignSelf: "stretch" },
  content: { flex: 1, paddingHorizontal: 14, paddingVertical: 14 },
  name: { color: "#fff", fontSize: 16, fontWeight: "600", marginBottom: 4 },
  meta: { color: "#888", fontSize: 12, letterSpacing: 0.5 },
  scoreBox: { paddingRight: 16, alignItems: "center" },
  score: { fontSize: 24, fontWeight: "800" },
  scoreLabel: { color: "#666", fontSize: 10, marginTop: -2 },
  noData: { color: "#555", fontSize: 20, fontWeight: "600" },
});
