import React, { useRef } from "react";
import { StyleSheet, Text, View, Animated, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { NearbyVenue } from "../api/places";
import { C, vibeColor, withAlpha } from "../theme";

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

  const scale = useRef(new Animated.Value(1)).current;

  function onPressIn() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  }
  function onPressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  }

  const tags: string[] = (venue as any).tags ?? [];

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale }] }]}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} style={styles.pressable}>
        {/* Vibe colour gradient wash over card background */}
        <LinearGradient
          colors={[withAlpha(color, 0.18), "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Left accent bar */}
        <View style={[styles.bar, { backgroundColor: color }]} />

        <View style={styles.content}>
          <Text style={styles.name} numberOfLines={1}>{venue.name}</Text>
          <Text style={styles.meta}>{venue.type.toUpperCase()}  ·  {distLabel}</Text>
          {tags.length > 0 && (
            <View style={styles.tagRow}>
              {tags.slice(0, 2).map((t) => (
                <View key={t} style={styles.tag}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.scoreBox}>
          {venue.vibe_score != null ? (
            <>
              <Text style={[styles.score, {
                color,
                textShadowColor: color,
                textShadowRadius: 8,
                textShadowOffset: { width: 0, height: 0 },
              }]}>
                {Math.round(venue.vibe_score)}
              </Text>
              <Text style={styles.scoreLabel}>VIBE</Text>
            </>
          ) : (
            <Text style={styles.noData}>—</Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginVertical: 5,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: C.bgSurface,
    borderWidth: 1,
    borderColor: C.border,
  },
  pressable: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
  },
  bar: { width: 4, alignSelf: "stretch" },
  content: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, gap: 3 },
  name: { color: C.textPrimary, fontSize: 16, fontWeight: "700" },
  meta: { color: C.textSecondary, fontSize: 12, letterSpacing: 0.4 },
  tagRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  tag: { backgroundColor: C.bgElevated, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { color: C.textMuted, fontSize: 11 },
  scoreBox: { paddingRight: 18, alignItems: "center" },
  score: { fontSize: 36, fontWeight: "900", letterSpacing: -1 },
  scoreLabel: { color: C.textMuted, fontSize: 9, letterSpacing: 1.5, marginTop: -2 },
  noData: { color: C.textMuted, fontSize: 22, fontWeight: "700" },
});
