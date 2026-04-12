import { create } from "zustand";
import { NearbyVenue } from "../api/places";

interface VibeState {
  venues: NearbyVenue[];
  setVenues: (venues: NearbyVenue[]) => void;
  updateVenueScore: (
    placeId: string,
    score: number,
    confidence: number,
    checkInCount: number
  ) => void;
  selectedPlaceId: string | null;
  setSelectedPlaceId: (id: string | null) => void;
}

export const useVibeStore = create<VibeState>((set) => ({
  venues: [],
  setVenues: (venues) => set({ venues }),
  updateVenueScore: (placeId, score, confidence, checkInCount) =>
    set((state) => ({
      venues: state.venues.map((v) =>
        v.place_id === placeId
          ? { ...v, vibe_score: score, confidence, check_in_count: checkInCount }
          : v
      ),
    })),
  selectedPlaceId: null,
  setSelectedPlaceId: (id) => set({ selectedPlaceId: id }),
}));
