import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { C } from "../theme";
import { REPORT_REASONS, ReportReason, reportVenue } from "../api/reports";

interface Props {
  visible: boolean;
  placeId: string;
  vibeId?: string;
  onClose: () => void;
}

export function ReportSheet({ visible, placeId, vibeId, onClose }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setReason(null);
    setDetail("");
    setSubmitting(false);
    setDone(false);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function submit() {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportVenue(placeId, reason, detail.trim() || undefined, vibeId);
      setDone(true);
    } catch (e: any) {
      setError(
        e?.status === 429
          ? "You've sent a lot of reports today — try again tomorrow."
          : e?.message ?? "Could not send report",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {done ? (
            <View style={styles.doneBox}>
              <Text style={styles.doneEmoji}>✓</Text>
              <Text style={styles.title}>Report received</Text>
              <Text style={styles.body}>
                Thanks — our team reviews reports within 24 hours.
              </Text>
              <TouchableOpacity onPress={close} style={styles.primaryWrap} accessibilityRole="button">
                <LinearGradient colors={[C.teal, C.tealDim]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primary}>
                  <Text style={styles.primaryText}>Done</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.title}>Report this venue</Text>
              <Text style={styles.body}>What's wrong? We review every report within 24 hours.</Text>

              <View style={styles.reasons}>
                {REPORT_REASONS.map((r) => {
                  const active = reason === r.id;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[styles.reason, active && styles.reasonActive]}
                      onPress={() => setReason(r.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${r.label}. ${r.hint}`}
                    >
                      <Text style={[styles.reasonLabel, active && styles.reasonLabelActive]}>{r.label}</Text>
                      <Text style={styles.reasonHint}>{r.hint}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                style={styles.input}
                placeholder="Anything else? (optional)"
                placeholderTextColor={C.textFaint}
                value={detail}
                onChangeText={setDetail}
                multiline
                maxLength={500}
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.actions}>
                <TouchableOpacity onPress={close} style={styles.cancelBtn} accessibilityRole="button">
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={submit}
                  disabled={!reason || submitting}
                  style={[styles.submitBtn, (!reason || submitting) && styles.submitDisabled]}
                  accessibilityRole="button"
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.submitText}>Send report</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.bgSurface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
    gap: 10,
  },
  handle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  title: { color: C.textPrimary, fontSize: 18, fontWeight: "700" },
  body: { color: C.textSecondary, fontSize: 13, lineHeight: 19 },
  reasons: { gap: 8, marginTop: 4 },
  reason: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgElevated,
    padding: 12,
    gap: 2,
  },
  reasonActive: { borderColor: C.teal, backgroundColor: "#0A8F7A22" },
  reasonLabel: { color: C.textPrimary, fontSize: 14, fontWeight: "600" },
  reasonLabelActive: { color: C.teal },
  reasonHint: { color: C.textSecondary, fontSize: 12 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgElevated,
    color: C.textPrimary,
    padding: 12,
    minHeight: 64,
    textAlignVertical: "top",
    fontSize: 14,
    marginTop: 4,
  },
  error: { color: C.raging, fontSize: 12 },
  actions: { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.border, alignItems: "center",
  },
  cancelText: { color: C.textSecondary, fontWeight: "600", fontSize: 15 },
  submitBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: C.teal, alignItems: "center" },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: C.bgBase, fontWeight: "700", fontSize: 15 },
  primaryWrap: { alignSelf: "stretch", marginTop: 8 },
  primary: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  doneBox: { alignItems: "center", gap: 8, paddingVertical: 12 },
  doneEmoji: { color: C.teal, fontSize: 40, fontWeight: "900" },
});
