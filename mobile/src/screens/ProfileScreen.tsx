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
import { LinearGradient } from "expo-linear-gradient";
import { signOut } from "firebase/auth";
import { auth } from "../config/firebase";
import { useAuthStore } from "../store/useAuthStore";
import { getUserProfile, UserProfile } from "../api/user";
import { C, withAlpha } from "../theme";

const BADGE_LABELS: Record<string, string> = {
  first_vibecheck: "🎉 First Vibe Check",
  night_owl:       "🦉 Night Owl",
  streak_7:        "🔥 7-Day Streak",
};

function trustColor(pct: number): string {
  return pct >= 80 ? C.teal : pct >= 50 ? C.buzzing : C.raging;
}

function TrustBar({ score }: { score: number }) {
  const pct   = Math.round(score * 100);
  const color = trustColor(pct);
  const label = pct >= 80 ? "Trusted" : pct >= 50 ? "Building trust" : "New";
  return (
    <View style={trust.wrap}>
      <View style={trust.labelRow}>
        <Text style={trust.label}>Trust Score</Text>
        <Text style={[trust.value, { color }]}>{pct}% · {label}</Text>
      </View>
      <View style={trust.track}>
        <View style={[trust.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
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
    setLoading(true); setError(null);
    try { setProfile(await getUserProfile()); }
    catch (e: any) { setError(e.message ?? "Failed to load profile"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: async () => { await signOut(auth); clearUser(); } },
    ]);
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={C.teal} size="large" /></View>;
  if (error || !profile) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{error ?? "Profile not found"}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={load}>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const name  = displayName || profile.display_name || "Anonymous Vibe";
  const email = firebaseUser?.email;
  const photo = photoURL || profile.photo_url;
  const pct   = Math.round((profile.trust_score ?? 0.7) * 100);
  const tColor = trustColor(pct);

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 20, paddingBottom: 56 }}>
      {/* ── Identity header ── */}
      <View style={s.identityCard}>
        {/* Avatar with gradient ring */}
        <LinearGradient
          colors={[tColor, withAlpha(tColor, 0.3)]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.avatarRing}
        >
          {photo
            ? <Image source={{ uri: photo }} style={s.avatar} />
            : <View style={s.avatarPlaceholder}><Text style={[s.avatarText, { color: tColor }]}>{name[0].toUpperCase()}</Text></View>
          }
        </LinearGradient>
        <View style={s.identityInfo}>
          <Text style={s.name}>{name}</Text>
          {email && <Text style={s.email}>{email}</Text>}
          <TrustBar score={profile.trust_score ?? 0.7} />
        </View>
      </View>

      {/* ── Stats ── */}
      <View style={s.statsCard}>
        {[
          { value: profile.check_ins,     label: "Check-ins",  color: C.teal },
          { value: profile.streak_days,   label: "Day Streak", color: profile.streak_days >= 3 ? C.raging : C.textSecondary },
          { value: profile.badges.length, label: "Badges",     color: C.buzzing },
        ].map((stat, i, arr) => (
          <React.Fragment key={stat.label}>
            <View style={s.statBox}>
              <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
            {i < arr.length - 1 && <View style={s.divider} />}
          </React.Fragment>
        ))}
      </View>

      {/* ── Badges ── */}
      <Text style={s.sectionTitle}>Badges</Text>
      {[...new Set(profile.badges)].length > 0
        ? [...new Set(profile.badges)].map((b) => (
            <View key={b} style={s.badgeCard}>
              <View style={[s.badgeStripe, { backgroundColor: "#F59E0B" }]} />
              <Text style={s.badgeText}>{BADGE_LABELS[b] ?? `🏅 ${b}`}</Text>
            </View>
          ))
        : (
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>No badges yet</Text>
            <Text style={s.emptyText}>Check in to earn your first one</Text>
          </View>
        )
      }

      {/* ── Sign out ── */}
      <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
        <Text style={s.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const trust = StyleSheet.create({
  wrap: { marginTop: 8 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  label: { color: C.textMuted, fontSize: 11 },
  value: { fontSize: 11, fontWeight: "700" },
  track: { height: 5, backgroundColor: C.border, borderRadius: 3, overflow: "hidden" },
  fill:  { height: "100%", borderRadius: 3 },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bgBase },
  center: { flex: 1, backgroundColor: C.bgBase, justifyContent: "center", alignItems: "center", gap: 12 },

  identityCard: {
    flexDirection: "row", gap: 14, alignItems: "center",
    backgroundColor: C.bgSurface, borderRadius: 20,
    borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 14,
  },
  avatarRing: { width: 76, height: 76, borderRadius: 38, padding: 3, alignItems: "center", justifyContent: "center" },
  avatar: { width: 70, height: 70, borderRadius: 35 },
  avatarPlaceholder: { width: 70, height: 70, borderRadius: 35, backgroundColor: C.bgBase, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 30, fontWeight: "800" },
  identityInfo: { flex: 1 },
  name:  { color: C.textPrimary,   fontSize: 18, fontWeight: "700" },
  email: { color: C.textMuted, fontSize: 12, marginBottom: 4 },

  statsCard: {
    flexDirection: "row", backgroundColor: C.bgSurface,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    padding: 20, justifyContent: "space-around", marginBottom: 24,
  },
  statBox: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 28, fontWeight: "900" },
  statLabel: { color: C.textSecondary, fontSize: 11, marginTop: 2 },
  divider: { width: 1, backgroundColor: C.border },

  sectionTitle: {
    color: C.textSecondary, fontSize: 11, fontWeight: "700",
    letterSpacing: 2, textTransform: "uppercase", marginBottom: 10,
  },
  badgeCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.bgSurface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 8, overflow: "hidden",
  },
  badgeStripe: { width: 4, alignSelf: "stretch" },
  badgeText: { color: "#F59E0B", fontSize: 14, fontWeight: "700", padding: 14 },

  emptyBox: {
    backgroundColor: C.bgSurface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    borderStyle: "dashed",
    padding: 24, alignItems: "center", gap: 4, marginBottom: 8,
  },
  emptyTitle: { color: C.textSecondary, fontSize: 15, fontWeight: "700" },
  emptyText:  { color: C.textMuted, fontSize: 13 },

  signOutBtn: {
    marginTop: 28, borderRadius: 14, paddingVertical: 14,
    alignItems: "center", borderWidth: 1, borderColor: withAlpha(C.raging, 0.5),
  },
  signOutText: { color: C.raging, fontSize: 15, fontWeight: "700" },

  errorText: { color: C.raging, fontSize: 14 },
  retryBtn: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8, borderWidth: 1, borderColor: C.teal },
  retryText: { color: C.teal, fontWeight: "600" },
});
