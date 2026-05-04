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
  active_tags: string[];
}

export interface VenueDetail {
  place_id: string;
  name: string;
  vibe_score: number | null;
  confidence: number | null;
  check_in_count: number;
  active_tags: string[];
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
  minScore?: number,
  tags?: string[],
): Promise<NearbyVenue[]> {
  let path = `/v1/places/nearby?lat=${lat}&lng=${lng}&radius=${radius}`;
  if (type) path += `&type=${type}`;
  if (minScore != null) path += `&min_score=${minScore}`;
  if (tags && tags.length > 0) path += `&tags=${tags.join(",")}`;
  return api.get<NearbyVenue[]>(path);
}

export function getVenueDetail(placeId: string): Promise<VenueDetail> {
  return api.get<VenueDetail>(`/v1/vibe/${placeId}`);
}

export interface SearchRequest {
  query: string;
  lat: number;
  lng: number;
  radius?: number;
}

export function searchVenues(req: SearchRequest): Promise<NearbyVenue[]> {
  return api.post<NearbyVenue[]>("/v1/places/search", req);
}

export interface VibeSummary {
  summary: string;
  tone: "lively" | "moderate" | "quiet";
}

export function getVibeSummary(placeId: string): Promise<VibeSummary> {
  return api.get<VibeSummary>(`/v1/vibe/${placeId}/summary`);
}

export interface FollowStatus {
  following: boolean;
  threshold?: number;
}

export function getFollowStatus(placeId: string): Promise<FollowStatus> {
  return api.get<FollowStatus>(`/v1/user/follow/${placeId}`);
}

export function followVenue(placeId: string, threshold = 75): Promise<void> {
  return api.post<void>(`/v1/user/follow/${placeId}`, { threshold });
}

export function unfollowVenue(placeId: string): Promise<void> {
  return api.delete<void>(`/v1/user/follow/${placeId}`);
}
