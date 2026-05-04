import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getNearbyVenues, searchVenues } from "../api/places";
import { VenueCard } from "../components/VenueCard";
import { useVibeStore } from "../store/useVibeStore";
import { useLocation } from "../hooks/useLocation";
import { DEFAULT_LOCATION } from "../config";
import { RootStackParamList } from "../../App";

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

const DEFAULT_RADIUS = 1500;
const MIN_RADIUS = 100;
const MAX_RADIUS = 30000;

function formatRadius(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
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
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [sliderValue, setSliderValue] = useState(DEFAULT_RADIUS);

  const load = useCallback(
    async (isRefresh = false, overrideRadius?: number) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const type = filter === "all" ? undefined : filter;
        const r = overrideRadius ?? radius;
        const data = await getNearbyVenues(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng, r, type, undefined, tagFilter);
        setVenues(data);
      } catch (e: any) {
        setError(e.message ?? "Failed to load venues");
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    },
    [filter, tagFilter, radius, setVenues]
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
      {/* Location indicator */}
      <Text style={styles.locationLabel}>
        {usingGPS ? "📍 Using your location" : "📍 Using default location (Bengaluru)"}
      </Text>

      {/* Natural language search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="lively bar with music..."
          placeholderTextColor="#555"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={() => handleSearch(searchQuery)}
          returnKeyType="search"
        />
        {isSearching ? (
          <ActivityIndicator color="#14b8a6" style={{ marginLeft: 8 }} />
        ) : searchQuery.length > 0 ? (
          <TouchableOpacity onPress={() => { setSearchQuery(""); load(); }}>
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Radius slider */}
      <View style={styles.sliderContainer}>
        <View style={styles.sliderLabelRow}>
          <Text style={styles.sliderLabel}>Search radius</Text>
          <Text style={styles.sliderValue}>{formatRadius(sliderValue)}</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={MIN_RADIUS}
          maximumValue={MAX_RADIUS}
          step={100}
          value={sliderValue}
          minimumTrackTintColor="#14b8a6"
          maximumTrackTintColor="#2a2a35"
          thumbTintColor="#14b8a6"
          onValueChange={(v) => setSliderValue(Math.round(v))}
          onSlidingComplete={(v) => {
            const r = Math.round(v);
            setRadius(r);
            setSliderValue(r);
            load(false, r);
          }}
        />
        <View style={styles.sliderRange}>
          <Text style={styles.sliderRangeText}>100 m</Text>
          <Text style={styles.sliderRangeText}>30 km</Text>
        </View>
      </View>

      {/* Type filter chips */}
      <View style={styles.filterRow}>
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
      </View>

      {/* Vibe tag filters */}
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

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color="#14b8a6" size="large" />
        </View>
      )}

      {error && !loading && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && (
        <FlatList
          data={venues}
          keyExtractor={(v) => v.place_id}
          renderItem={({ item }) => (
            <VenueCard
              venue={item}
              onPress={() =>
                navigation.navigate("VenueDetail", {
                  placeId: item.place_id,
                  name: item.name,
                })
              }
            />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No venues found within {formatRadius(radius)}.</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor="#14b8a6"
            />
          }
          contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f14" },
  locationLabel: { color: "#555", fontSize: 11, paddingHorizontal: 16, paddingTop: 8 },
  searchRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginVertical: 8 },
  searchInput: {
    flex: 1, backgroundColor: "#1a1a22", borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 9, color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "#2a2a35",
  },
  clearBtn: { color: "#555", fontSize: 16, paddingHorizontal: 10 },
  sliderContainer: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  sliderLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sliderLabel: { color: "#aaa", fontSize: 12 },
  sliderValue: { color: "#14b8a6", fontSize: 12, fontWeight: "700" },
  slider: { width: "100%", height: 36 },
  sliderRange: { flexDirection: "row", justifyContent: "space-between", marginTop: -4 },
  sliderRangeText: { color: "#555", fontSize: 10 },
  filterRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: "#1a1a22", borderWidth: 1, borderColor: "#333",
  },
  chipActive: { backgroundColor: "#14b8a6", borderColor: "#14b8a6" },
  chipText: { color: "#888", fontSize: 12, textTransform: "capitalize" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  errorText: { color: "#ef4444", fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  retryBtn: { backgroundColor: "#1a1a22", borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: "#14b8a6", fontWeight: "600" },
  emptyText: { color: "#555", fontSize: 14 },
  tagScroll: { height: 44 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  tagChip: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: "#1a1a22", borderWidth: 1, borderColor: "#333",
  },
  tagChipActive: { backgroundColor: "#0d2926", borderColor: "#14b8a6" },
  tagChipText: { color: "#777", fontSize: 12 },
  tagChipTextActive: { color: "#14b8a6", fontWeight: "600" },
});
