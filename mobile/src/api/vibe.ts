import { api } from "./client";

export interface SubmitVibeRequest {
  place_id: string;
  crowd_energy?: number;
  music_energy?: number;
  ambient_db?: number;
  manual_rating?: number;
  client_lat: number;
  client_lng: number;
}

export interface SubmitVibeResponse {
  status: string;
  venue_score: number;
  confidence: number;
  badge_earned: string | null;
}

export function submitVibe(req: SubmitVibeRequest): Promise<SubmitVibeResponse> {
  return api.post<SubmitVibeResponse>("/v1/vibe", req);
}
