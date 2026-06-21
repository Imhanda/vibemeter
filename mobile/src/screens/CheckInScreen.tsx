import React, { useState, useRef, useEffect } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import ConfettiCannon from "react-native-confetti-cannon";
import { useAudioRecorder, AudioModule, IOSOutputFormat, AudioQuality, setAudioModeAsync } from "expo-audio";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { submitVibe, analyseAudio, AudioSignals } from "../api/vibe";
import { useLocation } from "../hooks/useLocation";
import { useVibeStore } from "../store/useVibeStore";
import { RootStackParamList } from "../../App";
import { C, vibeColor, vibeGradient, withAlpha } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "CheckIn">;
type Mode = "listen" | "manual";
type RecordState = "idle" | "recording" | "uploading" | "done";

const RECORD_SECONDS = 10;

const EMOJI_OPTIONS: { label: string; value: number }[] = [
  { label: "💤", value: 1 },
  { label: "😐", value: 2 },
  { label: "😊", value: 3 },
  { label: "⚡", value: 4 },
  { label: "🔥", value: 5 },
];

// Vibe gradient per emoji level
function emojiGradient(value: number): readonly [string, string] {
  if (value >= 4) return [C.raging, "#8B0026"];
  if (value === 3) return [C.buzzing, "#7A3800"];
  return [C.chill, "#005A4E"];
}

const VIBE_TAGS: { id: string; label: string }[] = [
  { id: "dj",          label: "🎧 DJ" },
  { id: "live_band",   label: "🎸 Live Band" },
  { id: "karaoke",     label: "🎤 Karaoke" },
  { id: "dance_floor", label: "💃 Dance Floor" },
  { id: "open_bar",    label: "🍹 Open Bar" },
  { id: "sports",      label: "⚽ Sports" },
];

export function CheckInScreen({ route, navigation }: Props) {
  const { placeId, name } = route.params;
  const { coords } = useLocation();
  const { venues, updateVenueScore } = useVibeStore();
  const [mode, setMode] = useState<Mode>("listen");
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [countdown, setCountdown] = useState(RECORD_SECONDS);
  const [signals, setSignals] = useState<AudioSignals | null>(null);
  const [analyseError, setAnalyseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; badge: string | null } | null>(null);

  // Result score count-up
  const [displayScore, setDisplayScore] = useState(0);
  const scoreAnim = useRef(new Animated.Value(0)).current;

  // Badge slide-up
  const badgeTranslate = useRef(new Animated.Value(80)).current;

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uriRef = useRef<string | null>(null);
  const confettiRef = useRef<any>(null);

  const audioRecorder = useAudioRecorder({
    extension: ".m4a", sampleRate: 44100, numberOfChannels: 2, bitRate: 128000,
    android: { outputFormat: "mpeg4", audioEncoder: "aac" },
    ios: {
      outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MAX,
      linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false,
    },
    web: { mimeType: "audio/webm", bitsPerSecond: 128000 },
  });

  // ── Mic ring animations ────────────────────────────
  const ring1Scale   = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.35)).current;
  const ring2Scale   = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0.35)).current;
  const ring3Scale   = useRef(new Animated.Value(1)).current;
  const ring3Opacity = useRef(new Animated.Value(0.35)).current;
  const ringLoop     = useRef<Animated.CompositeAnimation | null>(null);

  // Emoji bounce per index
  const emojiBounce = useRef(EMOJI_OPTIONS.map(() => new Animated.Value(1))).current;

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      try { if (audioRecorder.isRecording) audioRecorder.stop(); } catch (_) {}
    };
  }, []);

  function makeRingAnim(scale: Animated.Value, opacity: Animated.Value, delay: number, duration: number) {
    return Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.parallel([
          Animated.timing(scale,   { toValue: 2.0, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0,   duration, useNativeDriver: true }),
        ])
      ),
    ]);
  }

  function resetRings() {
    ring1Scale.setValue(1); ring1Opacity.setValue(0.35);
    ring2Scale.setValue(1); ring2Opacity.setValue(0.35);
    ring3Scale.setValue(1); ring3Opacity.setValue(0.35);
  }

  function startRings(fast = false) {
    resetRings();
    const dur = fast ? 900 : 1600;
    ringLoop.current = Animated.parallel([
      makeRingAnim(ring1Scale, ring1Opacity, 0,          dur),
      makeRingAnim(ring2Scale, ring2Opacity, dur / 3,    dur),
      makeRingAnim(ring3Scale, ring3Opacity, (dur / 3) * 2, dur),
    ]);
    ringLoop.current.start();
  }

  function stopRings() {
    ringLoop.current?.stop();
    resetRings();
  }

  async function startRecording() {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert("Permission denied", "Microphone access is needed to score the vibe.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      setSignals(null); setAnalyseError(null);
      setRecordState("recording");
      setCountdown(RECORD_SECONDS);
      startRings(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();

      let remaining = RECORD_SECONDS;
      countdownRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) stopRecording(false);
      }, 1000);
    } catch (e: any) {
      setRecordState("idle");
      Alert.alert("Recording error", e.message ?? "Could not start recording");
    }
  }

  async function stopRecording(silent: boolean) {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    stopRings();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { uriRef.current = audioRecorder.uri ?? null; } catch (_) {}
    try { await audioRecorder.stop(); await setAudioModeAsync({ allowsRecording: false }); } catch (_) {}
    if (silent) { setRecordState("idle"); return; }
    const uri = uriRef.current;
    if (!uri) { setRecordState("idle"); return; }
    setRecordState("uploading");
    try {
      const derived = await analyseAudio(uri);
      setSignals(derived);
      setRecordState("done");
    } catch (e: any) {
      setAnalyseError(e.message ?? "Analysis failed");
      setRecordState("idle");
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      let payload: Parameters<typeof submitVibe>[0];
      if (mode === "listen" && signals) {
        payload = { place_id: placeId, client_lat: coords.lat, client_lng: coords.lng, tags: selectedTags, ...signals };
      } else {
        payload = { place_id: placeId, manual_rating: selected!, client_lat: coords.lat, client_lng: coords.lng, tags: selectedTags };
      }
      const resp = await submitVibe(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const existing = venues.find((v) => v.place_id === placeId);
      updateVenueScore(placeId, resp.venue_score, resp.confidence, (existing?.check_in_count ?? 0) + 1);
      setResult({ score: resp.venue_score, badge: resp.badge_earned });
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const s = e.status;
      if (s === 429) Alert.alert("Slow down!", "You've already checked in here recently.");
      else if (s === 403) Alert.alert("Too far away", "You need to be at the venue to check in.");
      else Alert.alert("Error", e.message ?? "Check-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Trigger result animations
  useEffect(() => {
    if (!result) return;
    scoreAnim.setValue(0);
    const id = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    Animated.timing(scoreAnim, { toValue: result.score, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    if (result.badge) {
      Animated.spring(badgeTranslate, { toValue: 0, useNativeDriver: true, bounciness: 10 }).start();
    }
    return () => scoreAnim.removeListener(id);
  }, [result]);

  // ── RESULT SCREEN ────────────────────────────────────
  if (result) {
    const rColor = vibeColor(result.score);
    const rGrad  = vibeGradient(result.score);
    return (
      <View style={styles.container}>
        {result.badge && (
          <ConfettiCannon
            ref={confettiRef}
            count={80}
            origin={{ x: 200, y: 0 }}
            colors={[C.teal, C.raging, C.buzzing, "#F0EEFF"]}
            fadeOut autoStart
          />
        )}
        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>Vibe submitted!</Text>
          <Text style={[styles.resultScore, { color: rColor, textShadowColor: rColor, textShadowRadius: 16 }]}>
            {displayScore}
          </Text>
          <Text style={[styles.resultVibeLabel, { color: rColor }]}>
            {result.score > 75 ? "RAGING 🔥" : result.score >= 50 ? "BUZZING ⚡" : "CHILL 😎"}
          </Text>
          {result.badge && (
            <Animated.View style={[styles.badgeCard, { transform: [{ translateY: badgeTranslate }] }]}>
              <Text style={styles.badgeText}>🏅 Badge earned: {result.badge}</Text>
            </Animated.View>
          )}
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <LinearGradient colors={rGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.doneBtn}>
              <Text style={styles.doneBtnText}>Done</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const canSubmit = !submitting &&
    !(mode === "listen" && recordState !== "done") &&
    !(mode === "manual" && selected == null);

  return (
    <View style={styles.container}>
      {/* Venue + current vibe context */}
      <Text style={styles.venueName}>{name}</Text>

      {/* ── Mode selector ── */}
      <View style={styles.modeRow}>
        {(["listen", "manual"] as Mode[]).map((m) => {
          const active = mode === m;
          const icon  = m === "listen" ? "🎤" : "⭐";
          const label = m === "listen" ? "LISTEN" : "RATE";
          const sub   = m === "listen" ? "Auto-detect" : "Quick vote";
          return (
            <TouchableOpacity
              key={m}
              style={[styles.modeCard, active && styles.modeCardActive]}
              onPress={() => {
                setMode(m);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              {active ? (
                <LinearGradient colors={[C.teal, C.tealDim]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.modeCardGrad}>
                  <Text style={styles.modeIcon}>{icon}</Text>
                  <Text style={styles.modeLabel}>{label}</Text>
                  <Text style={styles.modeSub}>{sub}</Text>
                </LinearGradient>
              ) : (
                <View style={styles.modeCardInner}>
                  <Text style={[styles.modeIcon, { opacity: 0.5 }]}>{icon}</Text>
                  <Text style={[styles.modeLabel, { color: C.textMuted }]}>{label}</Text>
                  <Text style={[styles.modeSub, { color: C.textMuted }]}>{sub}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Listen mode ── */}
      {mode === "listen" && (
        <View style={styles.listenArea}>
          {recordState === "idle" && (
            <>
              <Text style={styles.instruction}>
                Tap to scan{"\n"}10 seconds of ambient sound
              </Text>
              {analyseError && <Text style={styles.errorText}>{analyseError}</Text>}
              <TouchableOpacity onPress={startRecording} style={styles.micWrap}>
                <LinearGradient colors={[C.teal, C.tealDim]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.micBtn}>
                  <Text style={styles.micIcon}>🎤</Text>
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}

          {recordState === "recording" && (
            <>
              <View style={styles.micWrap}>
                {/* Ring 1 */}
                <Animated.View style={[styles.ring, { borderColor: C.raging, transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
                {/* Ring 2 */}
                <Animated.View style={[styles.ring, { borderColor: C.buzzing, transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
                {/* Ring 3 */}
                <Animated.View style={[styles.ring, { borderColor: C.teal, transform: [{ scale: ring3Scale }], opacity: ring3Opacity }]} />
                <LinearGradient colors={[C.raging, "#8B0026"]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.micBtn}>
                  <Text style={[styles.micIcon, { fontSize: 28 }]}>{countdown}</Text>
                </LinearGradient>
              </View>
              <Text style={styles.listeningLabel}>Listening…</Text>
              <TouchableOpacity onPress={() => stopRecording(false)}>
                <Text style={styles.cancelText}>Stop early</Text>
              </TouchableOpacity>
            </>
          )}

          {recordState === "uploading" && (
            <>
              <ActivityIndicator color={C.teal} size="large" />
              <Text style={styles.instruction}>Analysing with YAMNet…</Text>
            </>
          )}

          {recordState === "done" && signals && (
            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>Analysis complete ✓</Text>
              <SignalBar label="🎶 Music" value={signals.music_energy} />
              <SignalBar label="👥 Crowd" value={signals.crowd_energy} />
              <SignalBar label="🔊 Ambient" value={signals.ambient_db} />
              <View style={styles.estimateRow}>
                <Text style={styles.estimateLabel}>Estimated score</Text>
                <Text style={[styles.estimateScore, { color: C.teal }]}>
                  {Math.round((0.55 * signals.crowd_energy + 0.40 * signals.music_energy + 0.05 * signals.ambient_db) * 100)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => { setRecordState("idle"); setSignals(null); }}>
                <Text style={styles.cancelText}>Record again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Rate mode ── */}
      {mode === "manual" && (
        <View style={styles.listenArea}>
          <Text style={styles.instruction}>How's the vibe right now?</Text>
          <View style={styles.emojiRow}>
            {EMOJI_OPTIONS.map((opt, i) => {
              const active = selected === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => {
                    setSelected(opt.value);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    Animated.sequence([
                      Animated.timing(emojiBounce[i], { toValue: 1.22, duration: 100, useNativeDriver: true }),
                      Animated.spring(emojiBounce[i], { toValue: 1, useNativeDriver: true }),
                    ]).start();
                  }}
                >
                  <Animated.View style={{ transform: [{ scale: emojiBounce[i] }] }}>
                    {active ? (
                      <LinearGradient
                        colors={emojiGradient(opt.value)}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={styles.emojiBtnActive}
                      >
                        <Text style={styles.emoji}>{opt.label}</Text>
                      </LinearGradient>
                    ) : (
                      <View style={styles.emojiBtn}>
                        <Text style={[styles.emoji, { opacity: 0.5 }]}>{opt.label}</Text>
                      </View>
                    )}
                  </Animated.View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* ── Tag chips ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={styles.tagRow}>
        {VIBE_TAGS.map((tag) => {
          const active = selectedTags.includes(tag.id);
          return (
            <TouchableOpacity
              key={tag.id}
              style={[styles.tagChip, active && styles.tagChipActive]}
              onPress={() => setSelectedTags((prev) =>
                prev.includes(tag.id) ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]
              )}
            >
              <Text style={[styles.tagChipText, active && styles.tagChipTextActive]}>{tag.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Submit ── */}
      <TouchableOpacity onPress={handleSubmit} disabled={!canSubmit}>
        {canSubmit ? (
          <LinearGradient colors={[C.teal, C.tealDim]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitBtn}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit Vibe</Text>}
          </LinearGradient>
        ) : (
          <View style={[styles.submitBtn, styles.submitDisabled]}>
            <Text style={[styles.submitText, { color: C.textMuted }]}>Submit Vibe</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

function SignalBar({ label, value }: { label: string; value: number }) {
  const color = C.teal;
  return (
    <View style={sig.row}>
      <Text style={sig.label}>{label}</Text>
      <View style={sig.track}>
        <LinearGradient
          colors={[withAlpha(color, 0.6), color]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[sig.fill, { width: `${Math.round(value * 100)}%` as any }]}
        />
      </View>
      <Text style={sig.pct}>{Math.round(value * 100)}%</Text>
    </View>
  );
}

const sig = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", marginVertical: 5, width: "100%" },
  label: { color: C.textSecondary, fontSize: 13, width: 90 },
  track: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: "hidden", marginHorizontal: 8 },
  fill:  { height: "100%", borderRadius: 4 },
  pct:   { color: C.textPrimary, fontSize: 12, width: 36, textAlign: "right" },
});

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: C.bgBase,
    alignItems: "center", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32,
  },
  venueName: { color: C.textPrimary, fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 20 },

  modeRow: { flexDirection: "row", gap: 10, width: "100%", marginBottom: 24 },
  modeCard: {
    flex: 1, borderRadius: 16, overflow: "hidden",
    borderWidth: 1, borderColor: C.border,
  },
  modeCardActive: { borderColor: C.teal },
  modeCardGrad: { paddingVertical: 14, alignItems: "center", gap: 2 },
  modeCardInner: { paddingVertical: 14, alignItems: "center", gap: 2, backgroundColor: C.bgElevated },
  modeIcon:  { fontSize: 24 },
  modeLabel: { color: "#fff", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  modeSub:   { color: "rgba(255,255,255,0.6)", fontSize: 11 },

  listenArea: { alignItems: "center", width: "100%", minHeight: 220, justifyContent: "center", gap: 16, marginBottom: 16 },
  instruction: { color: C.textSecondary, fontSize: 15, textAlign: "center", lineHeight: 22 },
  errorText:   { color: C.raging, fontSize: 12, textAlign: "center" },

  micWrap: { width: 96, height: 96, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 2,
  },
  micBtn: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  micIcon: { fontSize: 40 },
  listeningLabel: { color: C.textSecondary, fontSize: 13 },
  cancelText: { color: C.raging, fontSize: 13, fontWeight: "600" },

  previewCard: {
    width: "100%", backgroundColor: C.bgSurface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, padding: 16, gap: 8, alignItems: "center",
  },
  previewTitle: { color: C.teal, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  estimateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginTop: 4 },
  estimateLabel: { color: C.textSecondary, fontSize: 13 },
  estimateScore: { fontSize: 36, fontWeight: "900" },

  emojiRow: { flexDirection: "row", gap: 8 },
  emojiBtn: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: C.bgElevated, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },
  emojiBtnActive: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 28 },

  tagScroll: { maxHeight: 44, width: "100%", marginBottom: 16 },
  tagRow: { gap: 8, alignItems: "center" },
  tagChip: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.border,
  },
  tagChipActive: { borderColor: C.teal, backgroundColor: withAlpha(C.teal, 0.12) },
  tagChipText: { color: C.textMuted, fontSize: 13 },
  tagChipTextActive: { color: C.teal, fontWeight: "600" },

  submitBtn: { borderRadius: 16, paddingVertical: 17, paddingHorizontal: 64, alignItems: "center", width: "100%" },
  submitDisabled: { backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.border },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  // Result screen
  resultBox: { alignItems: "center", gap: 14 },
  resultLabel: { color: C.textSecondary, fontSize: 16, fontWeight: "600" },
  resultScore: {
    fontSize: 88, fontWeight: "900", letterSpacing: -4,
    textShadowOffset: { width: 0, height: 0 },
  },
  resultVibeLabel: { fontSize: 16, fontWeight: "700", letterSpacing: 2 },
  badgeCard: {
    backgroundColor: C.bgSurface, borderRadius: 14,
    borderLeftWidth: 3, borderLeftColor: "#F59E0B",
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  badgeText: { color: "#F59E0B", fontSize: 15, fontWeight: "700" },
  doneBtn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 56, marginTop: 8 },
  doneBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
