import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getNearbyVenues, searchVenues } from "../api/places";
import { VenueCard } from "../components/VenueCard";
import { useVibeStore } from "../store/useVibeStore";
import { useLocation } from "../hooks/useLocation";
import { RootStackParamList } from "../../App";
import { C } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "VenueList">;

const TYPE_FILTERS = ["all", "bar", "club"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const VIBE_TAGS: { id: string; label: string }[] = [
  { id: "dj",          label: "🎧 DJ" },
  { id: "live_band",   label: "🎸 Live Band" },
  { id: "karaoke",     label: "🎤 Karaoke" },
  { id: "dance_floor", label: "💃 Dance Floor" },
  { id: "open_bar",    label: "🍹 Open Bar" },
  { id: "sports",      label: "⚽ Sports" },
];

const RADIUS_MIN = 500;
const RADIUS_MAX = 15000;
function formatRadius(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`;
}

// Skeleton card (pulsing placeholder)
function SkeletonCard() {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.9, duration: 800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[sk.card, { opacity: anim }]}>
      <View style={sk.bar} />
      <View style={sk.body}>
        <View style={sk.line1} />
        <View style={sk.line2} />
      </View>
      <View style={sk.score} />
    </Animated.View>
  );
}

export function VenueListScreen({ navigation }: Props) {
  const { venues, setVenues } = useVibeStore();
  const { coords, loading: locationLoading, usingGPS } = useLocation();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [radius, setRadius] = useState(1000);
  const [radiusModalVisible, setRadiusModalVisible] = useState(false);
  const [draftRadius, setDraftRadius] = useState(1000);

  const load = useCallback(
    async (isRefresh = false, r?: number) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const type = filter === "all" ? undefined : filter;
        const data = await getNearbyVenues(
          coords.lat, coords.lng,
          r ?? radius, type, undefined, tagFilter
        );
        setVenues(data);
      } catch (e: any) {
        setError(e.message ?? "Failed to load venues");
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    },
    [coords, filter, tagFilter, radius, setVenues]
  );

  const handleSearch = async (query: string) => {
    if (!query.trim()) { load(); return; }
    setIsSearching(true);
    setError(null);
    try {
      const data = await searchVenues({ query, lat: coords.lat, lng: coords.lng, radius });
      setVenues(data);
    } catch (e: any) {
      setError(e.message ?? "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  function openRadiusModal() {
    setDraftRadius(radius);
    setRadiusModalVisible(true);
  }

  function confirmRadius() {
    setRadius(draftRadius);
    load(false, draftRadius);
    setRadiusModalVisible(false);
  }

  function toggleTag(id: string) {
    setTagFilter((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  useEffect(() => {
    if (!locationLoading) load();
  }, [locationLoading, load]);

  return (
    <View style={styles.container}>
      {/* ── Custom header ─────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.logoText}>VIBEMETER</Text>
          <TouchableOpacity style={styles.locationChip} onPress={() => {}}>
            <Text style={styles.locationChipText}>
              📍 {usingGPS ? "Your location" : "Bengaluru"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <View style={[styles.searchWrap, searchFocused && styles.searchWrapFocused]}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="lively bar with music..."
            placeholderTextColor={C.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => handleSearch(searchQuery)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            returnKeyType="search"
          />
          {isSearching ? (
            <Text style={styles.searchSpinner}>⟳</Text>
          ) : searchQuery.length > 0 ? (
            <TouchableOpacity onPress={() => { setSearchQuery(""); load(); }}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ── Filters row ───────────────────────────────── */}
      <View style={styles.filtersRow}>
        {TYPE_FILTERS.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, filter === t && styles.chipActive]}
            onPress={() => setFilter(t)}
          >
            <Text style={[styles.chipText, filter === t && styles.chipTextActive]}>
              {t}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={styles.spacer} />
        {/* Radius chip — opens slider sheet */}
        <TouchableOpacity style={styles.radiusChip} onPress={openRadiusModal}>
          <Text style={styles.radiusChipText}>⊙ {formatRadius(radius)}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Vibe tag scroll ───────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tagScroll}
        contentContainerStyle={styles.tagRow}
      >
        {VIBE_TAGS.map((tag) => {
          const active = tagFilter.includes(tag.id);
          return (
            <TouchableOpacity
              key={tag.id}
              style={[styles.tagChip, active && styles.tagChipActive]}
              onPress={() => toggleTag(tag.id)}
            >
              <Text style={[styles.tagChipText, active && styles.tagChipTextActive]}>
                {tag.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── List / Loading / Error ────────────────────── */}
      {loading && (
        <View style={{ paddingTop: 4 }}>
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
        </View>
      )}

      {error && !loading && (
        <View style={styles.center}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Radius slider modal ───────────────────────── */}
      <Modal
        visible={radiusModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRadiusModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.dragHandle} />
            <Text style={styles.modalTitle}>Search Radius</Text>
            <Text style={styles.modalValue}>{formatRadius(draftRadius)}</Text>
            <Slider
              style={styles.slider}
              minimumValue={RADIUS_MIN}
              maximumValue={RADIUS_MAX}
              step={100}
              value={draftRadius}
              onValueChange={(v) => setDraftRadius(Math.round(v))}
              minimumTrackTintColor={C.teal}
              maximumTrackTintColor={C.border}
              thumbTintColor={C.teal}
            />
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>{formatRadius(RADIUS_MIN)}</Text>
              <Text style={styles.sliderLabel}>{formatRadius(RADIUS_MAX)}</Text>
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setRadiusModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOkBtn} onPress={confirmRadius}>
                <Text style={styles.modalOkText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {!loading && !error && (
        <View style={{ flex: 1 }}>
          <FlatList
            data={venues}
            keyExtractor={(v) => v.place_id}
            renderItem={({ item }) => (
              <VenueCard
                venue={item}
                onPress={() =>
                  navigation.navigate("VenueDetail", { placeId: item.place_id, name: item.name })
                }
              />
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyEmoji}>🎭</Text>
                <Text style={styles.emptyTitle}>Nothing nearby</Text>
                <Text style={styles.emptyText}>Try expanding the radius or changing filters</Text>
              </View>
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load(true)}
                tintColor={C.teal}
              />
            }
            contentContainerStyle={{ paddingBottom: 100, flexGrow: 1 }}
          />
          {/* Fade-out gradient at list bottom */}
          <LinearGradient
            colors={["transparent", C.bgBase]}
            style={styles.fadeBottom}
            pointerEvents="none"
          />
        </View>
      )}
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.bgSurface, borderRadius: 16,
    marginHorizontal: 16, marginVertical: 5,
    borderWidth: 1, borderColor: C.border, minHeight: 72, overflow: "hidden",
  },
  bar: { width: 4, alignSelf: "stretch", backgroundColor: C.border },
  body: { flex: 1, paddingHorizontal: 14, paddingVertical: 16, gap: 8 },
  line1: { height: 14, width: "55%", backgroundColor: C.border, borderRadius: 4 },
  line2: { height: 10, width: "35%", backgroundColor: C.border, borderRadius: 4 },
  score: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.border, marginRight: 18 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bgBase },

  header: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  logoText: {
    color: C.teal, fontSize: 13, fontWeight: "800",
    letterSpacing: 4,
  },
  locationChip: {
    backgroundColor: C.bgElevated, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: C.border,
  },
  locationChipText: { color: C.textSecondary, fontSize: 11 },

  searchWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.bgElevated, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12,
  },
  searchWrapFocused: { borderColor: C.teal },
  searchIcon: { color: C.textMuted, fontSize: 20, marginRight: 6 },
  searchInput: { flex: 1, paddingVertical: 11, color: C.textPrimary, fontSize: 14 },
  searchSpinner: { color: C.teal, fontSize: 18 },
  clearBtn: { color: C.textMuted, fontSize: 15, paddingLeft: 8 },

  filtersRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 8, gap: 8,
  },
  chip: {
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.teal, borderColor: C.teal },
  chipText: { color: C.textSecondary, fontSize: 13, textTransform: "capitalize" },
  chipTextActive: { color: C.bgBase, fontWeight: "700" },
  spacer: { flex: 1 },
  radiusChip: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.tealDim,
  },
  radiusChipText: { color: C.teal, fontSize: 12, fontWeight: "700" },

  tagScroll: { maxHeight: 44 },
  tagRow: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  tagChip: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.border,
  },
  tagChipActive: { borderColor: C.teal, backgroundColor: "#0A8F7A22" },
  tagChipText: { color: C.textMuted, fontSize: 13 },
  tagChipTextActive: { color: C.teal, fontWeight: "600" },

  fadeBottom: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 56,
  },

  // Radius modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: C.bgSurface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 44,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
  },
  dragHandle: {
    width: 40, height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  modalTitle: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 8,
  },
  modalValue: {
    color: C.textPrimary,
    fontSize: 40,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
  },
  slider: {
    width: "100%",
    height: 44,
    marginTop: 8,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  sliderLabel: {
    color: C.textMuted,
    fontSize: 11,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 28,
  },
  modalCancelBtn: {
    flex: 1, paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.bgElevated,
    borderWidth: 1, borderColor: C.border,
    alignItems: "center",
  },
  modalCancelText: {
    color: C.textSecondary,
    fontWeight: "600",
    fontSize: 15,
  },
  modalOkBtn: {
    flex: 1, paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.teal,
    alignItems: "center",
  },
  modalOkText: {
    color: C.bgBase,
    fontWeight: "700",
    fontSize: 15,
  },

  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8, paddingTop: 60 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { color: C.textPrimary, fontSize: 18, fontWeight: "700" },
  emptyText: { color: C.textSecondary, fontSize: 13, textAlign: "center", paddingHorizontal: 40 },
  errorEmoji: { fontSize: 36 },
  errorText: { color: C.raging, fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  retryBtn: {
    marginTop: 4, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8,
    borderWidth: 1, borderColor: C.teal,
  },
  retryText: { color: C.teal, fontWeight: "600" },
});
