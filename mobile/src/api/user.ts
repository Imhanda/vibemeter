import { api } from "./client";

export interface UserProfile {
  user_id: string;
  display_name: string;
  photo_url: string;
  check_ins: number;
  streak_days: number;
  badges: string[];
}

export function getUserProfile(): Promise<UserProfile> {
  return api.get<UserProfile>("/v1/user/profile");
}

export function followVenue(placeId: string, threshold = 70): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/v1/user/follow/${placeId}`, {
    threshold,
  });
}
