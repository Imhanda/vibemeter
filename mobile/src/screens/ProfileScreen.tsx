import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { signOut } from "firebase/auth";
import { auth } from "../config/firebase";
import { useAuthStore } from "../store/useAuthStore";
import { getUserProfile, UserProfile } from "../api/user";

const BADGE_LABELS: Record<string, string> = {
  first_vibecheck: "🎉 First Vibe Check",
  night_owl: "🦉 Night Owl",
  streak_7: "🔥 7-Day Streak",
};

function TrustBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "#14b8a6" : pct >= 50 ? "#f59e0b" : "#ef4444";
  const label = pct >= 80 ? "Trusted" : pct >= 50 ? "Building trust" : "New";
  return (
    <View style={trust.container}>
      <View style={trust.labelRow}>
        <Text style={trust.label}>Trust Score</Text>
        <Text style={[trust.value, { color }]}>{pct}% · {label}</Text>
      </View>
      <View style={trust.barBg}>
        <View style={[trust.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function ProfileScreen() {
  const { displayName, photoURL, clearUser } = useAuthStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const firebaseUser = auth.currentUser;

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

  useEffect(() => { load(); }, []);

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await signOut(auth);
          clearUser();
        },
      },
    ]);
  }

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

  const name = displayName || profile.display_name || "Anonymous Vibe";
  const email = firebaseUser?.email;
  const photo = photoURL || profile.photo_url;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{name[0].toUpperCase()}</Text>
          </View>
        )}
      </View>

      <Text style={styles.name}>{name}</Text>
      {email && <Text style={styles.email}>{email}</Text>}

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

      {/* Trust score */}
      <TrustBar score={profile.trust_score ?? 0.7} />

      {/* Badges */}
      {profile.badges.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Badges</Text>
          {[...new Set(profile.badges)].map((b) => (
            <View key={b} style={styles.badgeRow}>
              <Text style={styles.badgeText}>{BADGE_LABELS[b] ?? `🏅 ${b}`}</Text>
            </View>
          ))}
        </View>
      )}

      {profile.badges.length === 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Badges</Text>
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No badges yet — check in to earn your first one!</Text>
          </View>
        </View>
      )}

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const trust = StyleSheet.create({
  container: { marginTop: 20, backgroundColor: "#1a1a22", borderRadius: 16, padding: 16 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  label: { color: "#aaa", fontSize: 12 },
  value: { fontSize: 12, fontWeight: "700" },
  barBg: { height: 6, backgroundColor: "#2a2a35", borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f14" },
  center: { flex: 1, backgroundColor: "#0f0f14", justifyContent: "center", alignItems: "center", gap: 12 },
  avatarContainer: { alignItems: "center", marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: "#14b8a6" },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "#14b8a6", alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 36, fontWeight: "700" },
  name: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  email: { color: "#555", fontSize: 13, textAlign: "center", marginTop: 4, marginBottom: 24 },
  statsRow: {
    flexDirection: "row", backgroundColor: "#1a1a22",
    borderRadius: 16, padding: 20, justifyContent: "space-around", marginTop: 16,
  },
  statBox: { alignItems: "center", flex: 1 },
  statValue: { color: "#14b8a6", fontSize: 26, fontWeight: "800" },
  statLabel: { color: "#888", fontSize: 11, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: "#333" },
  section: { marginTop: 28 },
  sectionTitle: { color: "#aaa", fontSize: 11, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 },
  badgeRow: { backgroundColor: "#1a1a22", borderRadius: 10, padding: 14, marginBottom: 8 },
  badgeText: { color: "#f59e0b", fontSize: 14, fontWeight: "600" },
  emptyBox: { backgroundColor: "#1a1a22", borderRadius: 10, padding: 16 },
  emptyText: { color: "#555", fontSize: 13, textAlign: "center" },
  signOutBtn: {
    marginTop: 36, borderRadius: 12, paddingVertical: 14,
    alignItems: "center", borderWidth: 1, borderColor: "#ef4444",
  },
  signOutText: { color: "#ef4444", fontSize: 15, fontWeight: "600" },
  errorText: { color: "#ef4444", fontSize: 14 },
  retryBtn: { backgroundColor: "#1a1a22", borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: "#14b8a6", fontWeight: "600" },
});
