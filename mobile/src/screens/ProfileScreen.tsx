import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { getUserProfile, UserProfile } from "../api/user";

const BADGE_LABELS: Record<string, string> = {
  first_vibecheck: "🎉 First Vibe Check",
  night_owl: "🦉 Night Owl",
  streak_7: "🔥 7-Day Streak",
};

export function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUserProfile();
      setProfile(data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#14b8a6" size="large" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "Profile not found"}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24 }}>
      {/* Avatar placeholder */}
      <View style={styles.avatarPlaceholder}>
        <Text style={styles.avatarText}>
          {profile.display_name ? profile.display_name[0].toUpperCase() : "V"}
        </Text>
      </View>
      <Text style={styles.name}>{profile.display_name || "Anonymous Vibe"}</Text>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.check_ins}</Text>
          <Text style={styles.statLabel}>Check-ins</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.streak_days}</Text>
          <Text style={styles.statLabel}>Day streak</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.badges.length}</Text>
          <Text style={styles.statLabel}>Badges</Text>
        </View>
      </View>

      {/* Badges */}
      {profile.badges.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Badges</Text>
          {profile.badges.map((b) => (
            <View key={b} style={styles.badgeRow}>
              <Text style={styles.badgeText}>
                {BADGE_LABELS[b] ?? `🏅 ${b}`}
              </Text>
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
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#14b8a6",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
  },
  avatarText: { color: "#fff", fontSize: 32, fontWeight: "700" },
  name: { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 24 },
  statsRow: {
    flexDirection: "row",
    backgroundColor: "#1a1a22",
    borderRadius: 16,
    padding: 20,
    justifyContent: "space-around",
  },
  statBox: { alignItems: "center", flex: 1 },
  statValue: { color: "#14b8a6", fontSize: 26, fontWeight: "800" },
  statLabel: { color: "#888", fontSize: 11, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: "#333" },
  section: { marginTop: 28 },
  sectionTitle: { color: "#aaa", fontSize: 11, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 },
  badgeRow: {
    backgroundColor: "#1a1a22",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  badgeText: { color: "#f59e0b", fontSize: 14, fontWeight: "600" },
  errorText: { color: "#ef4444", fontSize: 14 },
  retryBtn: { backgroundColor: "#1a1a22", borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: "#14b8a6", fontWeight: "600" },
});
