import { API_BASE_URL } from "../config";
import { api } from "./client";
import { auth } from "../config/firebase";

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

export interface AudioSignals {
  ambient_db: number;
  crowd_energy: number;
  music_energy: number;
}

export function submitVibe(req: SubmitVibeRequest): Promise<SubmitVibeResponse> {
  return api.post<SubmitVibeResponse>("/v1/vibe", req);
}

/** POST the recorded audio file to the backend YAMNet proxy, get back the
 *  three vibe signals. Audio is processed in-memory server-side and discarded. */
export async function analyseAudio(fileUri: string): Promise<AudioSignals> {
  const formData = new FormData();
  formData.append("audio", {
    uri: fileUri,
    name: "vibe.m4a",
    type: "audio/m4a",
  } as any);

  const headers: Record<string, string> = {};
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}/v1/vibe/analyse`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error ?? "Analysis failed"), { status: res.status });
  }

  return res.json() as Promise<AudioSignals>;
}
