import React, { useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
} from "react-native";
import { Audio } from "expo-av";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { submitVibe, analyseAudio, AudioSignals } from "../api/vibe";
import { useLocation } from "../hooks/useLocation";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "CheckIn">;
type Mode = "listen" | "manual";
type RecordState = "idle" | "recording" | "uploading" | "done";

const RECORD_SECONDS = 10;

// Live level bar: map raw dBFS to 0-1 for display only.
// Uses running min as device-agnostic floor.
function liveLevelNorm(db: number, floor: number): number {
  const RANGE = 30; // dB range above floor to fill bar
  return Math.max(0, Math.min((db - floor) / RANGE, 1));
}

const EMOJI_OPTIONS: { label: string; value: number }[] = [
  { label: "💤", value: 1 },
  { label: "😐", value: 2 },
  { label: "😊", value: 3 },
  { label: "⚡", value: 4 },
  { label: "🔥", value: 5 },
];

export function CheckInScreen({ route, navigation }: Props) {
  const { placeId, name } = route.params;
  const { coords } = useLocation();
  const [mode, setMode] = useState<Mode>("listen");

  // Listen-mode state
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [countdown, setCountdown] = useState(RECORD_SECONDS);
  const [levelNorm, setLevelNorm] = useState(0);
  const [signals, setSignals] = useState<AudioSignals | null>(null);
  const [analyseError, setAnalyseError] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const uriRef = useRef<string | null>(null);
  const levelFloorRef = useRef<number>(0);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Manual-mode state
  const [selected, setSelected] = useState<number | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; badge: string | null } | null>(null);

  // Pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    return () => { stopRecording(true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPulse() {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.18, duration: 700, easing: Easing.ease, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, easing: Easing.ease, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  }

  function stopPulse() {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  }

  async function startRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert("Permission denied", "Microphone access is needed to score the vibe.");
        return;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      await rec.startAsync();
      recordingRef.current = rec;
      levelFloorRef.current = 0;
      uriRef.current = null;
      setSignals(null);
      setAnalyseError(null);
      setRecordState("recording");
      setCountdown(RECORD_SECONDS);
      startPulse();

      // Poll metering for live level bar
      sampleTimerRef.current = setInterval(async () => {
        const status = await rec.getStatusAsync();
        if (status.isRecording && status.metering !== undefined) {
          const db = status.metering;
          // Track running floor (min seen so far) as device-specific baseline
          if (levelFloorRef.current === 0 || db < levelFloorRef.current) {
            levelFloorRef.current = db;
          }
          setLevelNorm(liveLevelNorm(db, levelFloorRef.current));
        }
      }, 200);

      // Countdown then auto-stop
      let remaining = RECORD_SECONDS;
      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) stopRecording(false);
      }, 1000);
    } catch (e: any) {
      Alert.alert("Recording error", e.message ?? "Could not start recording");
    }
  }

  async function stopRecording(silent: boolean) {
    if (sampleTimerRef.current) { clearInterval(sampleTimerRef.current); sampleTimerRef.current = null; }
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    stopPulse();
    setLevelNorm(0);

    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;

    try { await rec.stopAndUnloadAsync(); } catch (_) { /* already stopped */ }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    if (silent) { setRecordState("idle"); return; }

    const uri = rec.getURI();
    if (!uri) { setRecordState("idle"); return; }
    uriRef.current = uri;

    // Upload to backend YAMNet sidecar
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
        payload = {
          place_id: placeId,
          client_lat: coords.lat,
          client_lng: coords.lng,
          ...signals,
        };
      } else {
        payload = {
          place_id: placeId,
          manual_rating: selected!,
          client_lat: coords.lat,
          client_lng: coords.lng,
        };
      }
      const resp = await submitVibe(payload);
      setResult({ score: resp.venue_score, badge: resp.badge_earned });
    } catch (e: any) {
      const status = e.status;
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
  }

  // ── Result screen ─────────────────────────────────────────────────────────
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
          <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.venueName}>{name}</Text>

      {/* Mode tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, mode === "listen" && styles.tabActive]} onPress={() => setMode("listen")}>
          <Text style={[styles.tabText, mode === "listen" && styles.tabTextActive]}>🎤 Listen</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, mode === "manual" && styles.tabActive]} onPress={() => setMode("manual")}>
          <Text style={[styles.tabText, mode === "manual" && styles.tabTextActive]}>⭐ Rate</Text>
        </TouchableOpacity>
      </View>

      {/* ── Listen mode ── */}
      {mode === "listen" && (
        <View style={styles.listenArea}>
          {recordState === "idle" && (
            <>
              <Text style={styles.instruction}>
                Tap to record 10 seconds of ambient sound.{"\n"}YAMNet will classify music, crowd, and ambience.
              </Text>
              {analyseError && <Text style={styles.errorText}>{analyseError} — try again</Text>}
              <TouchableOpacity style={styles.micBtn} onPress={startRecording}>
                <Text style={styles.micIcon}>🎤</Text>
              </TouchableOpacity>
            </>
          )}

          {recordState === "recording" && (
            <>
              <Text style={styles.countdown}>{countdown}s</Text>
              <Animated.View style={[styles.micBtn, styles.micBtnRecording, { transform: [{ scale: pulseAnim }] }]}>
                <Text style={styles.micIcon}>🎙️</Text>
              </Animated.View>
              <View style={styles.levelBarBg}>
                <View style={[styles.levelBarFill, { width: `${Math.round(levelNorm * 100)}%` as any }]} />
              </View>
              <Text style={styles.listeningLabel}>Listening…</Text>
              <TouchableOpacity onPress={() => stopRecording(false)}>
                <Text style={styles.cancelText}>Stop early</Text>
              </TouchableOpacity>
            </>
          )}

          {recordState === "uploading" && (
            <>
              <ActivityIndicator color="#14b8a6" size="large" />
              <Text style={styles.instruction}>Analysing with YAMNet…</Text>
              <Text style={styles.subInstruction}>Classifying music, crowd & ambient audio</Text>
            </>
          )}

          {recordState === "done" && signals && (
            <>
              <Text style={styles.instruction}>Analysis complete</Text>
              <View style={styles.signalBreakdown}>
                <SignalBar label="🎶 Music" value={signals.music_energy} />
                <SignalBar label="👥 Crowd" value={signals.crowd_energy} />
                <SignalBar label="🔊 Ambient" value={signals.ambient_db} />
              </View>
              <View style={styles.scorePreviewBox}>
                <Text style={styles.scorePreviewLabel}>Estimated vibe score</Text>
                <Text style={styles.scorePreviewValue}>
                  {Math.round(
                    (0.55 * signals.crowd_energy +
                      0.40 * signals.music_energy +
                      0.05 * signals.ambient_db) * 100
                  )}
                </Text>
                <Text style={styles.scorePreviewSub}>out of 100 — submit to update the venue</Text>
              </View>
              <TouchableOpacity onPress={() => { setRecordState("idle"); setSignals(null); }}>
                <Text style={styles.cancelText}>Record again</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* ── Manual mode ── */}
      {mode === "manual" && (
        <View style={styles.listenArea}>
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
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.submitBtn,
          (submitting ||
            (mode === "listen" && recordState !== "done") ||
            (mode === "manual" && selected == null))
          && styles.submitBtnDisabled,
        ]}
        onPress={handleSubmit}
        disabled={
          submitting ||
          (mode === "listen" && recordState !== "done") ||
          (mode === "manual" && selected == null)
        }
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Vibe</Text>}
      </TouchableOpacity>
    </View>
  );
}

function SignalBar({ label, value }: { label: string; value: number }) {
  return (
    <View style={sig.row}>
      <Text style={sig.label}>{label}</Text>
      <View style={sig.barBg}>
        <View style={[sig.barFill, { width: `${Math.round(value * 100)}%` as any }]} />
      </View>
      <Text style={sig.pct}>{Math.round(value * 100)}%</Text>
    </View>
  );
}

const sig = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", marginVertical: 6, width: "100%" },
  label: { color: "#aaa", fontSize: 13, width: 90 },
  barBg: { flex: 1, height: 8, backgroundColor: "#1a1a22", borderRadius: 4, overflow: "hidden", marginHorizontal: 8 },
  barFill: { height: "100%", backgroundColor: "#14b8a6", borderRadius: 4 },
  pct: { color: "#fff", fontSize: 12, width: 36, textAlign: "right" },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f14", alignItems: "center", justifyContent: "center", padding: 24 },
  venueName: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 20, textAlign: "center" },
  tabRow: { flexDirection: "row", marginBottom: 28, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#2a2a35" },
  tab: { paddingVertical: 10, paddingHorizontal: 28, backgroundColor: "#1a1a22" },
  tabActive: { backgroundColor: "#14b8a6" },
  tabText: { color: "#aaa", fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  listenArea: { alignItems: "center", width: "100%", minHeight: 240, justifyContent: "center", gap: 14, marginBottom: 32 },
  instruction: { color: "#aaa", fontSize: 14, textAlign: "center", lineHeight: 20 },
  subInstruction: { color: "#555", fontSize: 12, textAlign: "center" },
  errorText: { color: "#ef4444", fontSize: 12, textAlign: "center" },
  micBtn: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "#1a1a22", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#14b8a6",
  },
  micBtnRecording: { borderColor: "#ef4444", backgroundColor: "#2a0a0a" },
  micIcon: { fontSize: 40 },
  countdown: { color: "#14b8a6", fontSize: 36, fontWeight: "800" },
  levelBarBg: { width: "80%", height: 8, backgroundColor: "#1a1a22", borderRadius: 4, overflow: "hidden" },
  levelBarFill: { height: "100%", backgroundColor: "#14b8a6", borderRadius: 4 },
  listeningLabel: { color: "#aaa", fontSize: 13 },
  cancelText: { color: "#ef4444", fontSize: 13 },
  signalBreakdown: { width: "100%", paddingHorizontal: 8 },
  emojiRow: { flexDirection: "row", gap: 12 },
  emojiBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "#1a1a22", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "transparent",
  },
  emojiBtnActive: { borderColor: "#14b8a6", backgroundColor: "#0d2926" },
  emoji: { fontSize: 26 },
  submitBtn: { backgroundColor: "#14b8a6", borderRadius: 12, paddingVertical: 16, paddingHorizontal: 48, alignItems: "center" },
  submitBtnDisabled: { backgroundColor: "#1a1a22" },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  resultBox: { alignItems: "center", gap: 12 },
  resultTitle: { color: "#14b8a6", fontSize: 18, fontWeight: "700" },
  resultScore: { color: "#fff", fontSize: 64, fontWeight: "800" },
  resultLabel: { color: "#aaa", fontSize: 14 },
  badgeBox: { backgroundColor: "#1a1a22", borderRadius: 10, padding: 12, marginTop: 8 },
  badgeText: { color: "#f59e0b", fontSize: 14, fontWeight: "600" },
  doneBtn: { marginTop: 16, backgroundColor: "#14b8a6", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 40 },
  doneBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  scorePreviewBox: { alignItems: "center", backgroundColor: "#1a1a22", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, marginVertical: 4 },
  scorePreviewLabel: { color: "#aaa", fontSize: 12, marginBottom: 4 },
  scorePreviewValue: { color: "#14b8a6", fontSize: 52, fontWeight: "800", lineHeight: 56 },
  scorePreviewSub: { color: "#555", fontSize: 11, marginTop: 2, textAlign: "center" },
});
