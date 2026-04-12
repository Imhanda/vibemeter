import { api } from "./client";

export interface NearbyVenue {
  place_id: string;
  name: string;
  type: string;
  distance_m: number;
  vibe_score: number | null;
  confidence: number | null;
  check_in_count: number;
  last_updated: string | null;
  photo_url: string;
}

export interface VenueDetail {
  place_id: string;
  name: string;
  vibe_score: number | null;
  confidence: number | null;
  check_in_count: number;
  signal_breakdown: {
    crowd_energy: number;
    music_energy: number;
    ambient_db: number;
  } | null;
  history: { hour: string; score: number; count: number }[];
}

export function getNearbyVenues(
  lat: number,
  lng: number,
  radius = 1000,
  type?: string,
  minScore?: number
): Promise<NearbyVenue[]> {
  let path = `/v1/places/nearby?lat=${lat}&lng=${lng}&radius=${radius}`;
  if (type) path += `&type=${type}`;
  if (minScore != null) path += `&min_score=${minScore}`;
  return api.get<NearbyVenue[]>(path);
}

export function getVenueDetail(placeId: string): Promise<VenueDetail> {
  return api.get<VenueDetail>(`/v1/vibe/${placeId}`);
}
