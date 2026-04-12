import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getNearbyVenues } from "../api/places";
import { VenueCard } from "../components/VenueCard";
import { useVibeStore } from "../store/useVibeStore";
import { DEFAULT_LOCATION } from "../config";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "VenueList">;

const TYPE_FILTERS = ["all", "bar", "pub", "club", "restaurant"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

export function VenueListScreen({ navigation }: Props) {
  const { venues, setVenues } = useVibeStore();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TypeFilter>("all");

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const type = filter === "all" ? undefined : filter;
        const data = await getNearbyVenues(
          DEFAULT_LOCATION.lat,
          DEFAULT_LOCATION.lng,
          1500,
          type
        );
        setVenues(data);
      } catch (e: any) {
        setError(e.message ?? "Failed to load venues");
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    },
    [filter, setVenues]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      {/* Filter chips */}
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
              <Text style={styles.emptyText}>No venues found nearby.</Text>
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
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: "#1a1a22",
    borderWidth: 1,
    borderColor: "#333",
  },
  chipActive: { backgroundColor: "#14b8a6", borderColor: "#14b8a6" },
  chipText: { color: "#888", fontSize: 12, textTransform: "capitalize" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  errorText: { color: "#ef4444", fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  retryBtn: {
    backgroundColor: "#1a1a22",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retryText: { color: "#14b8a6", fontWeight: "600" },
  emptyText: { color: "#555", fontSize: 14 },
});
