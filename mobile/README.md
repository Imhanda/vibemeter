# VibeMeter — Mobile App

React Native + Expo client for the VibeMeter nightlife vibe-scoring platform.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo SDK ~52 |
| Navigation | React Navigation (bottom tabs + native stack) |
| State | Zustand |
| Language | TypeScript (strict mode) |
| Real-time | WebSocket (auto-reconnecting) |

---

## Project structure

```
mobile/
├── App.tsx                        # Root — navigation container, tab + stack setup
├── app.json                       # Expo config (bundle ID, permissions)
├── tsconfig.json
├── package.json
└── src/
    ├── config.ts                  # API base URL, default location, dev auth flag
    ├── api/
    │   ├── client.ts              # Fetch wrapper (auth header, error handling)
    │   ├── places.ts              # getNearbyVenues, getVenueDetail
    │   ├── vibe.ts                # submitVibe
    │   ├── user.ts                # getUserProfile, followVenue
    │   └── websocket.ts           # VenueSocket — live score subscription
    ├── store/
    │   └── useVibeStore.ts        # Zustand — venue list + live score updates
    ├── components/
    │   ├── VibeBadge.tsx          # Score pill + label (sm / lg variants)
    │   └── VenueCard.tsx          # Venue row card with colour-coded score bar
    └── screens/
        ├── VenueListScreen.tsx    # Nearby venues list with type filter chips
        ├── VenueDetailScreen.tsx  # Score hero, signal breakdown, hourly history
        ├── CheckInScreen.tsx      # Emoji vibe picker → POST /v1/vibe
        └── ProfileScreen.tsx      # Check-in count, streak, badges
```

---

## Prerequisites

- Node.js 20+
- Expo CLI — `npm install -g expo-cli` (or use `npx expo`)
- iOS Simulator (Xcode) or Android Emulator, or the **Expo Go** app on a physical device
- VibeMeter backend running locally — see [../api/README or root README](../README.md)

---

## Setup

```bash
cd mobile
npm install
```

---

## Configuration

All environment-level settings live in one file — [`src/config.ts`](src/config.ts):

```typescript
// Point to your local Go API server
export const API_BASE_URL = "http://localhost:8080";

// Default location used when real GPS is not yet wired up
// Currently hardcoded to central Bengaluru
export const DEFAULT_LOCATION = { lat: 12.9716, lng: 77.5946 };

// Dev mode — sends X-User-ID header instead of a Firebase JWT
export const SKIP_AUTH = true;
export const DEV_USER_ID = "dev-user";
```

**Running on a physical device?** The simulator can reach `localhost`, but a real device cannot. Replace `API_BASE_URL` with your machine's local IP (e.g. `http://192.168.1.x:8080`) or a tunnelled URL (ngrok etc.).

---

## Running

### Start the backend first

```bash
# From the repo root
cd infra && docker compose up -d
cd ../api && SKIP_AUTH=true go run main.go
# API listening on :8080
```

### Start the app

```bash
cd mobile
npx expo start
```

Then:
- Press `i` to open in iOS Simulator
- Press `a` to open in Android Emulator
- Scan the QR code with **Expo Go** on a physical device

---

## Screens

### Venues tab

**Venue List** — fetches nearby venues from `GET /v1/places/nearby` using the default Bengaluru location. Filter by type (all / bar / pub / club / restaurant) using the chips at the top. Pull down to refresh.

Venue pins are colour-coded:
- **Teal** — chill (score < 50)
- **Amber** — buzzing (score 50–75)
- **Red** — raging (score > 75)
- **Grey** — no data yet

**Venue Detail** — shows the current vibe score, confidence badge, signal breakdown bars (crowd / music / ambient), and an hourly score history chart. Subscribes to the WebSocket room for live updates — the score animates whenever a new check-in arrives.

**Check In** — emoji scale picker (💤 → 🔥) that maps to `manual_rating 1–5` and posts to `POST /v1/vibe`. Shows the updated venue score and any badge earned on success. Handles:
- `429` — rate limit hit (max 2 check-ins per hour per venue)
- `403` — device is more than 300 m from the venue (geo-fence)

### Profile tab

Shows check-in count, streak days, and earned badges pulled from `GET /v1/user/profile`.

---

## API integration

All backend calls go through [`src/api/client.ts`](src/api/client.ts), which:
- Prepends `API_BASE_URL` to every path
- Adds `X-User-ID: dev-user` in dev mode (swap for `Authorization: Bearer <jwt>` when Firebase Auth is wired)
- Throws a typed error with `.status` set to the HTTP status code so screens can handle 429 / 403 specifically

```typescript
// Example — submit a manual vibe check-in
import { submitVibe } from "./src/api/vibe";

const result = await submitVibe({
  place_id: "ChIJ...",
  manual_rating: 4,
  client_lat: 12.9716,
  client_lng: 77.5946,
});
// result.venue_score, result.badge_earned
```

### WebSocket live updates

`VenueSocket` in [`src/api/websocket.ts`](src/api/websocket.ts) connects to `ws://localhost:8080/v1/ws`, sends a subscribe frame, and auto-reconnects after a 3-second delay if the connection drops.

```typescript
const sock = new VenueSocket(placeId, (event) => {
  console.log(event.vibe_score); // live score
});
sock.connect();
// ...
sock.disconnect(); // call in useEffect cleanup
```

---

## Current limitations (MVP dev mode)

| Feature | Status |
|---|---|
| Location | Hardcoded Bengaluru centre — `expo-location` wired up in next sprint |
| Auth | `X-User-ID` dev header — Firebase Google Sign-In coming in next sprint |
| Audio check-in | Emoji fallback only — on-device YAMNet audio capture in Weeks 5–6 |
| Map view | Venue list — Google Maps SDK pin view in next sprint |

---

## Adding real venues (Places sync)

The backend has an admin endpoint that pulls from the Google Places API and seeds the database. Run it once to populate venues, then again any time you want to refresh:

```bash
# Seed bars in central Bengaluru (default)
curl -X POST "http://localhost:8080/v1/admin/places/sync" \
  -H "X-User-ID: dev-user"

# Seed nightclubs, wider radius, up to 3 pages (~60 venues)
curl -X POST "http://localhost:8080/v1/admin/places/sync?type=night_club&radius=3000&pages=3" \
  -H "X-User-ID: dev-user"
```

Requires `GOOGLE_PLACES_API_KEY` set in the API server environment. Returns:
```json
{ "status": "ok", "inserted": 18, "updated": 2, "failed": 0, "total": 20 }
```
