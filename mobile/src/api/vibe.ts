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
  tags?: string[];
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

export interface VibePrecheck {
  can_check_in: boolean;
  reason?: "rate_limit" | "too_far";
  limit?: number;
  retry_after_seconds?: number;
  distance_m?: number;
  radius_m?: number;
}

/** Ask the server whether a check-in would be accepted right now, so the
 *  screen can show the gate before the user records or rates. */
export function precheckVibe(placeId: string, lat: number, lng: number): Promise<VibePrecheck> {
  return api.get<VibePrecheck>(`/v1/vibe/${placeId}/precheck?lat=${lat}&lng=${lng}`);
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

  // Longer budget than a plain API call — this is an upload plus server-side
  // inference — but still bounded, so the check-in screen can never spin
  // forever on a stalled connection.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/v1/vibe/analyse`, {
      method: "POST",
      headers,
      body: formData,
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw Object.assign(new Error("Analysis timed out — check your connection and try again."), { status: 0 });
    }
    throw Object.assign(new Error(e?.message ?? "Network request failed — check your connection."), { status: 0 });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error ?? "Analysis failed"), { status: res.status });
  }

  return res.json() as Promise<AudioSignals>;
}
