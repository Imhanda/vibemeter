import Constants from "expo-constants";

function getApiBaseUrl(): string {
  // AWS EC2 via nip.io HTTPS (iOS 26 ATS requires HTTPS for all traffic)
  return "https://13.63.7.88.nip.io";
}

export const API_BASE_URL = getApiBaseUrl();

// Hardcoded Bengaluru centre — swap for real device GPS in a later sprint.
export const DEFAULT_LOCATION = {
  lat: 12.9716,
  lng: 77.5946,
};

// Dev mode: sends X-User-ID header instead of a real Firebase JWT.
export const DEV_USER_ID = "dev-user";
export const SKIP_AUTH = true;
