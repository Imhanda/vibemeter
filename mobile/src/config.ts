function getApiBaseUrl(): string {
  // AWS EC2 via nip.io HTTPS. Must present a valid TLS certificate — iOS App
  // Transport Security requires HTTPS with TLS 1.2+ and there is no ATS
  // exception in app.json. See docs/APP_STORE_SUBMISSION.md.
  return "https://13.63.7.88.nip.io";
}

export const API_BASE_URL = getApiBaseUrl();

// Fallback location (central Bengaluru) used only when the user denies the
// location permission. Real GPS comes from src/hooks/useLocation.ts.
export const DEFAULT_LOCATION = {
  lat: 12.9716,
  lng: 77.5946,
};

// Auth bypass for LOCAL DEVELOPMENT ONLY. Must stay false for any build that
// leaves this machine (TestFlight, App Store) — with it true the API trusts an
// unauthenticated X-User-ID header. When false, real Firebase ID tokens are
// sent as Bearer auth (see src/api/client.ts).
export const SKIP_AUTH = false;
export const DEV_USER_ID = "dev-user";

// Hosted legal documents (also entered in App Store Connect).
export const LEGAL_URLS = {
  privacy: "https://imhanda.github.io/vibemeter/privacy.html",
  terms: "https://imhanda.github.io/vibemeter/terms.html",
  communityGuidelines: "https://imhanda.github.io/vibemeter/community-guidelines.html",
};
