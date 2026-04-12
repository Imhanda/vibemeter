// Central place to change the API base URL.
// Point to your local Go server when running on a simulator,
// or your deployed Cloud Run URL in production.
export const API_BASE_URL = "http://192.168.1.5:8080";

// Hardcoded Bengaluru centre — swap for real device GPS in a later sprint.
export const DEFAULT_LOCATION = {
  lat: 12.9716,
  lng: 77.5946,
};

// Dev mode: sends X-User-ID header instead of a real Firebase JWT.
export const DEV_USER_ID = "dev-user";
export const SKIP_AUTH = true;
