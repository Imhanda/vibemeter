import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  getVenueDetail, getVibeSummary, getFollowStatus,
  followVenue, unfollowVenue, VenueDetail, VibeSummary,
} from "../api/places";
import { VenueSocket, ScoreUpdateEvent } from "../api/websocket";
import { confidenceBadge } from "../components/VibeBadge";
import { useVibeStore } from "../store/useVibeStore";
import { RootStackParamList } from "../../App";
import { C, vibeColor, vibeGradient, withAlpha } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "VenueDetail">;

// Animates a number from 0 to target over 900ms
function AnimatedScore({ target }: { target: number | null }) {
  const [display, setDisplay] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (target == null) return;
    anim.setValue(0);
    const id = anim.addListener(({ value }) => setDisplay(Math.round(value)));
    Animated.timing(anim, {
      toValue: target,
      duration: 900,
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(id);
  }, [target]);

  const color = vibeColor(target);
  return (
    <Text style={[styles.heroScore, { color, textShadowColor: color, textShadowRadius: 12 }]}>
      {target != null ? display : "—"}
    </Text>
  );
}

export function VenueDetailScreen({ route, navigation }: Props) {
  const { placeId } = route.params;
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<VibeSummary | null>(null);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const socketRef = useRef<VenueSocket | null>(null);
  const { updateVenueScore } = useVibeStore();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, status] = await Promise.all([
        getVenueDetail(placeId),
        getFollowStatus(placeId).catch(() => ({ following: false })),
      ]);
      setVenue(data);
      setFollowing(status.following);
      getVibeSummary(placeId).then(setSummary).catch(() => {});
    } catch (e: any) {
      setError(e.message ?? "Failed to load venue");
    } finally {
      setLoading(false);
    }
  }, [placeId]);

  async function toggleFollow() {
    setFollowLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (following) { await unfollowVenue(placeId); setFollowing(false); }
      else { await followVenue(placeId, 10); setFollowing(true); }
    } catch (_) {}
    finally { setFollowLoading(false); }
  }

  useEffect(() => {
    const handleUpdate = (evt: ScoreUpdateEvent) => {
      setVenue((prev) =>
        prev ? { ...prev, vibe_score: evt.vibe_score, confidence: evt.confidence, check_in_count: evt.check_in_count } : prev
      );
      updateVenueScore(evt.place_id, evt.vibe_score, evt.confidence, evt.check_in_count);
    };
    const sock = new VenueSocket(placeId, handleUpdate);
    sock.connect();
    socketRef.current = sock;
    return () => sock.disconnect();
  }, [placeId, updateVenueScore]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={C.teal} size="large" /></View>;
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

  const color = vibeColor(venue.vibe_score);
  const grad = vibeGradient(venue.vibe_score);
  const cbadge = confidenceBadge(venue.confidence, venue.check_in_count);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 52 }}>
      {/* ── Hero section with vibe-color background wash ── */}
      <LinearGradient
        colors={[withAlpha(color, 0.28), C.bgBase]}
        style={styles.heroSection}
      >
        {/* Score hero */}
        <View style={styles.scoreHero}>
          <AnimatedScore target={venue.vibe_score} />
          <Text style={[styles.vibeLabel, { color }]}>
            {venue.vibe_score == null ? "No data" :
              venue.vibe_score > 75 ? "RAGING 🔥" :
              venue.vibe_score >= 50 ? "BUZZING ⚡" : "CHILL 😎"}
          </Text>
        </View>

        {/* Confidence + check-in row */}
        <View style={styles.metaRow}>
          {cbadge !== "" && (
            <View style={[styles.metaChip, { borderColor: color }]}>
              <Text style={[styles.metaChipText, { color }]}>{cbadge}</Text>
            </View>
          )}
          <Text style={styles.checkInCount}>
            {venue.check_in_count} check-in{venue.check_in_count !== 1 ? "s" : ""} · last 3 hours
          </Text>
        </View>

        {/* ── CTA row — ABOVE fold ── */}
        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={[styles.bellBtn, following && { borderColor: C.raging }]}
            onPress={toggleFollow}
            disabled={followLoading}
          >
            {followLoading
              ? <ActivityIndicator size="small" color={C.teal} />
              : <>
                  <Text style={styles.bellIcon}>{following ? "🔕" : "🔔"}</Text>
                  <Text style={[styles.bellLabel, following && { color: C.raging }]}>
                    {following ? "Unsubscribe" : "Notify me"}
                  </Text>
                </>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ctaBtnWrap}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              navigation.navigate("CheckIn", { placeId, name: route.params.name });
            }}
          >
            <LinearGradient
              colors={grad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaBtn}
            >
              <Text style={styles.ctaBtnText}>Check the Vibe  ▶</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* ── AI vibe summary ── */}
      {summary && (
        <View style={[
          styles.summaryCard,
          summary.tone === "lively"   ? { borderColor: C.raging,   backgroundColor: withAlpha(C.raging, 0.08) }
          : summary.tone === "moderate" ? { borderColor: C.buzzing, backgroundColor: withAlpha(C.buzzing, 0.08) }
          : { borderColor: C.chill, backgroundColor: withAlpha(C.chill, 0.08) },
        ]}>
          <Text style={styles.summaryIcon}>
            {summary.tone === "lively" ? "🔥" : summary.tone === "moderate" ? "⚡" : "💤"}
          </Text>
          <Text style={styles.summaryText}>{summary.summary}</Text>
        </View>
      )}

      {/* ── Signal breakdown ── */}
      {venue.signal_breakdown && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Signal Breakdown</Text>
          <View style={styles.card}>
            {([
              ["Crowd Energy", venue.signal_breakdown.crowd_energy],
              ["Music Energy", venue.signal_breakdown.music_energy],
              ["Ambient Volume", venue.signal_breakdown.ambient_db],
            ] as [string, number][]).map(([label, val]) => (
              <View key={label} style={styles.signalRow}>
                <Text style={styles.signalLabel}>{label}</Text>
                <View style={styles.barTrack}>
                  <LinearGradient
                    colors={[withAlpha(color, 0.6), color]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[styles.barFill, { width: `${Math.round(val * 100)}%` as any }]}
                  />
                </View>
                <Text style={styles.signalPct}>{Math.round(val * 100)}%</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── Score history ── */}
      {venue.history.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Score History · last 24h</Text>
          <View style={styles.card}>
            {venue.history.map((h) => {
              const maxScore = Math.max(...venue.history.map((x) => x.score));
              const isPeak = h.score === maxScore;
              return (
                <View key={h.hour} style={styles.historyRow}>
                  <Text style={[styles.historyHour, isPeak && { color: color }]}>{h.hour}</Text>
                  <View style={styles.barTrack}>
                    <LinearGradient
                      colors={[withAlpha(color, isPeak ? 0.7 : 0.3), isPeak ? color : withAlpha(color, 0.5)]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={[styles.barFill, { width: `${Math.round(h.score)}%` as any }]}
                    />
                  </View>
                  <Text style={[styles.historyScore, isPeak && { color }]}>{Math.round(h.score)}</Text>
                  {isPeak && <Text style={styles.peakLabel}>PEAK</Text>}
                </View>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bgBase },
  center: { flex: 1, backgroundColor: C.bgBase, justifyContent: "center", alignItems: "center", gap: 12 },

  heroSection: { paddingTop: 28, paddingBottom: 28, paddingHorizontal: 20, gap: 16 },

  scoreHero: { alignItems: "center", gap: 6 },
  heroScore: {
    fontSize: 80, fontWeight: "900", letterSpacing: -3, lineHeight: 88,
    textShadowOffset: { width: 0, height: 0 },
  },
  vibeLabel: { fontSize: 15, fontWeight: "700", letterSpacing: 2 },

  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center" },
  metaChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  metaChipText: { fontSize: 12, fontWeight: "700" },
  checkInCount: { color: C.textMuted, fontSize: 12 },

  ctaRow: { flexDirection: "row", gap: 10 },
  bellBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.bgElevated,
  },
  bellIcon: { fontSize: 16 },
  bellLabel: { color: C.textSecondary, fontSize: 13, fontWeight: "600" },
  ctaBtnWrap: { flex: 1, borderRadius: 14, overflow: "hidden" },
  ctaBtn: { paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  ctaBtnText: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },

  summaryCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    marginHorizontal: 20, marginTop: 4, marginBottom: 4,
    borderRadius: 16, padding: 16, borderLeftWidth: 4, borderWidth: 0, borderLeftColor: C.teal,
  },
  summaryIcon: { fontSize: 22, marginTop: 1 },
  summaryText: { flex: 1, color: C.textPrimary, fontSize: 14, lineHeight: 21 },

  section: { marginTop: 24, paddingHorizontal: 20 },
  sectionTitle: {
    color: C.textSecondary, fontSize: 11, fontWeight: "700",
    letterSpacing: 2, textTransform: "uppercase", marginBottom: 10,
  },
  card: {
    backgroundColor: C.bgSurface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  signalRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  signalLabel: { color: C.textPrimary, fontSize: 13, width: 110 },
  signalPct: { color: C.textSecondary, fontSize: 12, width: 34, textAlign: "right" },
  barTrack: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4 },

  historyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyHour: { color: C.textMuted, fontSize: 12, width: 42 },
  historyScore: { color: C.textSecondary, fontSize: 12, width: 28, textAlign: "right" },
  peakLabel: { color: C.teal, fontSize: 9, fontWeight: "800", letterSpacing: 1 },

  errorText: { color: C.raging, fontSize: 14 },
  retryBtn: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8, borderWidth: 1, borderColor: C.teal },
  retryText: { color: C.teal, fontWeight: "600" },
});
