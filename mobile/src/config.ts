import Constants from "expo-constants";

// Derive the API host from the Expo dev server's own IP at runtime.
// This means you never need to hardcode or update the IP when your
// Mac changes networks — the QR code already knows the right address.
function getApiBaseUrl(): string {
  // AWS EC2 deployment — Nginx listens on port 80
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.15:8081"
  if (hostUri) {
    const host = hostUri.split(":")[0]; // strip the Metro port
    return `http://${host}:8080`;
  }
  // Fallback for native builds
  return "http://192.168.1.11:8080";
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
