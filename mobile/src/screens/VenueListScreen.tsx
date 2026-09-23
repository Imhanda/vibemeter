import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Linking,
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getNearbyVenues, searchVenues, NearbyVenue } from "../api/places";
import { VenueCard } from "../components/VenueCard";
import { useVibeStore } from "../store/useVibeStore";
import { useLocation } from "../hooks/useLocation";
import { RootStackParamList } from "../../App";
import { C } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "VenueList">;

const TYPE_FILTERS = ["all", "bar", "club", "restaurant"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

type ListView = "now" | "last_night";
const CACHE_KEY = "venues:lastList";

// A venue has no *live* crowd signal when its score is missing or only derived
// from the Google rating / last night — i.e. nobody has checked in recently.
function hasLiveVibe(v: NearbyVenue): boolean {
  return v.vibe_score != null && v.score_source !== "google" && v.score_source !== "last_night";
}

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
  const { coords, loading: locationLoading, usingGPS, placeName, requestLocation } = useLocation();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // True only while `venues` holds search results (searchVenues), not a
  // plain nearby/browse list — gates the "Results" / "More venues nearby"
  // section split in the list below.
  const [isSearchResult, setIsSearchResult] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [radius, setRadius] = useState(1000);
  const [radiusModalVisible, setRadiusModalVisible] = useState(false);
  const [draftRadius, setDraftRadius] = useState(1000);
  const [view, setView] = useState<ListView>("now");
  const [stale, setStale] = useState(false);

  // A brand-new area comes back empty on the very first look: the server
  // seeds unfamiliar areas from OpenStreetMap in the background rather than
  // making this request wait on that (a third-party call with no SLA), so
  // "nothing nearby" the moment you land somewhere new may just mean the
  // seed hasn't landed yet. Auto-retry once, a few seconds later, so it shows
  // up without the user having to know to pull-to-refresh. Keyed by
  // coords so moving to yet another new area gets its own retry.
  const emptyRetryRef = useRef<{ key: string; timer: ReturnType<typeof setTimeout> | null }>({
    key: "",
    timer: null,
  });

  const load = useCallback(
    async (isRefresh = false, r?: number, v: ListView = view) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      setIsSearchResult(false);
      try {
        const type = filter === "all" ? undefined : filter;
        const data = await getNearbyVenues(
          coords.lat, coords.lng,
          r ?? radius, type, undefined, tagFilter,
          v === "last_night" ? "last_night" : undefined,
        );
        setVenues(data);
        setStale(false);
        if (v === "now") {
          AsyncStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ ts: Date.now(), venues: data }),
          ).catch(() => {});

          const key = `${coords.lat.toFixed(3)},${coords.lng.toFixed(3)}`;
          if (data.length === 0 && emptyRetryRef.current.key !== key) {
            emptyRetryRef.current.key = key;
            emptyRetryRef.current.timer = setTimeout(() => load(true), 6000);
          } else if (data.length > 0) {
            emptyRetryRef.current.key = key; // seeded now — don't retry again for this spot
          }
        }
      } catch (e: any) {
        // Offline / server down — fall back to the last list we saw.
        try {
          const raw = await AsyncStorage.getItem(CACHE_KEY);
          if (raw && v === "now") {
            const cached = JSON.parse(raw) as { ts: number; venues: NearbyVenue[] };
            if (cached.venues?.length) {
              setVenues(cached.venues);
              setStale(true);
              setError(null);
              return;
            }
          }
        } catch {
          /* ignore cache errors */
        }
        setError(e.message ?? "Failed to load venues");
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    },
    [coords, filter, tagFilter, radius, view, setVenues]
  );

  const handleSearch = async (query: string) => {
    if (!query.trim()) { load(); return; }
    setIsSearching(true);
    setError(null);
    try {
      const data = await searchVenues({ query, lat: coords.lat, lng: coords.lng, radius });
      setVenues(data);
      setIsSearchResult(true);
    } catch (e: any) {
      setError(e.message ?? "Search failed");
      setIsSearchResult(false);
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

  // Tapping the location chip should always do *something*: if permission
  // was never asked, this triggers the OS prompt; if it was already denied,
  // the OS won't re-prompt, so fall back to sending the user to Settings.
  async function handleLocationChipPress() {
    const granted = await requestLocation();
    if (!granted) {
      Alert.alert(
        "Location access needed",
        "VibeMeter uses your location to show venues near you. Enable location access in Settings to use your current location.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
    }
  }

  useEffect(() => {
    if (!locationLoading) load();
  }, [locationLoading, load]);

  // Cancel a pending empty-area retry (see emptyRetryRef above) whenever
  // `load` changes identity — i.e. coords/filter/tags/radius/view changed —
  // so a stale retry for a place/filter the user has since moved on from
  // never fires with outdated params. A fresh load already happens via the
  // effect above for whatever changed.
  useEffect(() => {
    return () => {
      if (emptyRetryRef.current.timer) clearTimeout(emptyRetryRef.current.timer);
    };
  }, [load]);

  function switchView(v: ListView) {
    if (v === view) return;
    setView(v);
    load(false, undefined, v);
  }

  const now = new Date();
  const clock = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const daytimeQuiet = view === "now" && !loading && venues.length > 0 && !venues.some(hasLiveVibe);
  const showViewTabs = daytimeQuiet || view === "last_night";

  // Search results split into "the match" and the rest of the nearby list,
  // shown as two labelled sections instead of one blended list — a tester
  // flagged that searching "Hard Rock Cafe" surfaced every other cafe right
  // below it with no visual distinction from the actual match.
  const listRows = useMemo(() => {
    type Row =
      | { kind: "header"; key: string; title: string }
      | { kind: "venue"; key: string; venue: NearbyVenue };
    if (!isSearchResult) {
      return venues.map((v): Row => ({ kind: "venue", key: v.place_id, venue: v }));
    }
    const matches = venues.filter((v) => v.is_match);
    const rest = venues.filter((v) => !v.is_match);
    if (matches.length === 0) {
      // Nothing matched by name (e.g. a natural-language query) — nothing
      // to split, just show the ranked list as-is.
      return venues.map((v): Row => ({ kind: "venue", key: v.place_id, venue: v }));
    }
    const rows: Row[] = [{ kind: "header", key: "h-results", title: "Results" }];
    rows.push(...matches.map((v): Row => ({ kind: "venue", key: v.place_id, venue: v })));
    if (rest.length > 0) {
      rows.push({ kind: "header", key: "h-rest", title: "More venues nearby" });
      rows.push(...rest.map((v): Row => ({ kind: "venue", key: v.place_id, venue: v })));
    }
    return rows;
  }, [venues, isSearchResult]);

  return (
    <View style={styles.container}>
      {/* ── Custom header ─────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.logoText}>VIBEMETER</Text>
          <TouchableOpacity style={styles.locationChip} onPress={handleLocationChipPress}>
            <Text style={styles.locationChipText} numberOfLines={1}>
              📍 {placeName ?? (usingGPS ? "Your location" : "Bengaluru")}
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

      {/* ── Time-of-day context ───────────────────────── */}
      {showViewTabs && (
        <View style={styles.viewTabs}>
          {(["now", "last_night"] as ListView[]).map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.viewTab, view === v && styles.viewTabActive]}
              onPress={() => switchView(v)}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === v }}
            >
              <Text style={[styles.viewTabText, view === v && styles.viewTabTextActive]}>
                {v === "now" ? "Now" : "Last night"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {daytimeQuiet && (
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerTitle}>It's {clock} — nothing's going yet</Text>
          <Text style={styles.infoBannerText}>
            See what was busy last night, or tap 🔔 on a venue to get pinged when it heats up tonight.
          </Text>
        </View>
      )}

      {view === "last_night" && !loading && (
        <Text style={styles.viewCaption}>Peak vibe scores from last night</Text>
      )}

      {stale && (
        <View style={styles.staleBanner}>
          <Text style={styles.staleText}>⚠︎ Offline — showing venues from your last visit. Pull to refresh.</Text>
        </View>
      )}

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
            data={listRows}
            keyExtractor={(row) => row.key}
            renderItem={({ item: row }) =>
              row.kind === "header" ? (
                <Text style={styles.sectionHeader}>{row.title}</Text>
              ) : (
                <VenueCard
                  venue={row.venue}
                  onPress={() =>
                    navigation.navigate("VenueDetail", { placeId: row.venue.place_id, name: row.venue.name })
                  }
                />
              )
            }
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

  sectionHeader: {
    color: C.textSecondary, fontSize: 11, fontWeight: "700",
    letterSpacing: 2, textTransform: "uppercase",
    paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8,
  },

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

  viewTabs: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8,
  },
  viewTab: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.bgElevated,
  },
  viewTabActive: { borderColor: C.teal, backgroundColor: C.teal },
  viewTabText: { color: C.textSecondary, fontSize: 13, fontWeight: "600" },
  viewTabTextActive: { color: C.bgBase, fontWeight: "700" },
  viewCaption: {
    color: C.textSecondary, fontSize: 12, paddingHorizontal: 20, marginBottom: 6,
  },
  infoBanner: {
    marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 14,
    backgroundColor: C.bgSurface, borderWidth: 1, borderColor: C.border, gap: 4,
  },
  infoBannerTitle: { color: C.textPrimary, fontSize: 14, fontWeight: "700" },
  infoBannerText: { color: C.textSecondary, fontSize: 12, lineHeight: 17 },
  staleBanner: {
    marginHorizontal: 16, marginBottom: 8, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: "#2A2410", borderWidth: 1, borderColor: C.buzzing,
  },
  staleText: { color: C.buzzing, fontSize: 12 },

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
