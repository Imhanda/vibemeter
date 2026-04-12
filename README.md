# VibeMeter

> Real-time nightlife vibe scoring using ambient audio intelligence

VibeMeter lets you discover nearby bars, pubs, clubs, and restaurants and know whether they're actually lively **right now** — not just whether they have good reviews. Users do a 10-second on-device audio check-in; only three computed floats are posted to the server. No raw audio ever leaves the device.

Scores decay over 3 hours, so the data always reflects the present moment.

---

## How it works

1. User taps **Check the Vibe** at a venue
2. On-device ML (YAMNet via Core ML / TFLite) analyses 10 seconds of ambient audio
3. Three signals are extracted entirely on-device: `crowd_energy`, `music_energy`, `ambient_db`
4. Only those three floats are POSTed to the API — no audio is transmitted
5. The backend aggregates recent check-ins with exponential time-decay and updates the live score
6. All connected clients receive the new score via WebSocket within 3 seconds

---

## Scoring

```
raw_score = (0.40 × crowd_energy + 0.35 × music_energy + 0.25 × ambient_db) × 100
```

Multiple check-ins are aggregated with exponential time-decay weighting:

```
decay_weight = exp(-0.0077 × age_minutes)
  # 0 min  → weight ≈ 1.00
  # 90 min → weight ≈ 0.50
  # 180 min → weight ≈ 0.25  (edge of 3-hour window)

venue_score = Σ(raw_score × decay_weight) / Σ(decay_weight)
confidence  = min(check_in_count / 5, 1.0) × (1 − age_of_oldest / 180)
```

Scores expire automatically from Redis after 3 hours via TTL — no cron job needed.

---

## Tech stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo 0.74+ |
| iOS audio / ML | AVFoundation + Core ML (YAMNet) |
| Android audio / ML | AudioRecord + TFLite (YAMNet + NNAPI) |
| Maps | Google Maps SDK |
| Auth | Firebase Auth (Google + Apple Sign-In) |
| Backend | Go 1.22 + Gin |
| WebSocket | gorilla/websocket + Redis pub/sub |
| Primary DB | PostgreSQL 16 + PostGIS |
| Cache | Redis 7 (score cache + rate limiting + WS fan-out) |
| Queue | AWS SQS (async enrichment) |
| Hosting | GCP Cloud Run |
| CI / CD | GitHub Actions |

---

## Repository structure

```
vibemeter/
├── mobile/                  # React Native + Expo
│   └── src/
│       ├── screens/         # MapScreen, VenueDetail, CheckIn, Profile
│       ├── audio/           # AudioCapture.ts, VibeExtractor.ts
│       ├── api/             # rest.ts, websocket.ts
│       └── store/           # Zustand state slices
├── api/                     # Go backend
│   ├── config/              # Env-based configuration
│   ├── cache/               # Redis client, venue score cache, pub/sub
│   ├── db/                  # sqlx Postgres connection
│   ├── handlers/            # vibe.go, places.go, user.go, ws.go
│   ├── middleware/          # auth.go (Firebase JWT)
│   ├── models/              # place.go, user.go, vibe.go
│   ├── scoring/             # engine.go — decay aggregation, confidence, Haversine
│   └── main.go
├── infra/
│   ├── docker-compose.yml   # Postgres 16 + PostGIS, Redis 7, pgAdmin
│   ├── postgres/init.sql    # Full schema + seed data (30 Bengaluru venues)
│   └── Dockerfile           # API container
└── ml/
    ├── models/              # yamnet.tflite, yamnet.mlmodel, bpm_head.tflite
    └── notebooks/           # Weight tuning, signal exploration
```

---

## API

All endpoints require `Authorization: Bearer <firebase_jwt>`. Set `SKIP_AUTH=true` locally and pass `X-User-ID` instead.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/vibe` | Submit a vibe check-in |
| `GET` | `/v1/vibe/:place_id` | Venue detail + score history |
| `GET` | `/v1/places/nearby` | Nearby venues with live scores |
| `GET` | `/v1/user/profile` | Authenticated user profile + badges |
| `POST` | `/v1/user/follow/:place_id` | Subscribe to venue push notifications |
| `GET` | `/v1/ws` | WebSocket — subscribe to live score updates |

### POST /v1/vibe

```json
{
  "place_id":     "ChIJ...",
  "music_energy": 0.82,
  "crowd_energy": 0.74,
  "ambient_db":   0.65,
  "client_lat":   12.9716,
  "client_lng":   77.5946
}
```

```json
{
  "status":       "accepted",
  "venue_score":  74,
  "confidence":   0.80,
  "badge_earned": "first_vibecheck"
}
```

Returns `429` if rate limit exceeded (2 check-ins per user per venue per hour).
Returns `403` if device is more than 300 m from the venue.

### GET /v1/places/nearby

```
?lat=12.9716&lng=77.5946&radius=500&type=bar&min_score=40&limit=50
```

Scores are read from Redis — no Postgres hit on this path.

### WebSocket

```json
// Client → Server
{ "type": "subscribe", "place_id": "ChIJ..." }

// Server → Client (on every new check-in)
{
  "type":          "score_update",
  "place_id":      "ChIJ...",
  "vibe_score":    74,
  "confidence":    0.80,
  "check_in_count": 6,
  "ts":            "2026-04-05T21:14:22Z"
}
```

---

## Local development

### Prerequisites

- Docker + Docker Compose
- Go 1.22+
- Node.js 18 LTS or 20 LTS (required by Expo SDK 54)
- **Expo Go** app on your phone — install from [App Store](https://apps.apple.com/app/expo-go/id982107779) or [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent)
  - iOS: Expo Go **2.32+**
  - Android: Expo Go **2.32+**
  - Expo Go must support **SDK 54** (the current version supports the latest two SDK releases)

### 1. Start the data layer

```bash
cd infra
docker compose up -d
```

This starts Postgres 16 + PostGIS, Redis 7, and pgAdmin (at `localhost:5050`). The schema and seed data (3 Bengaluru venues) are applied automatically from `infra/postgres/init.sql`.

### 2. Run the API

```bash
cd api
SKIP_AUTH=true go run main.go
# Listening on :8080
```

### 3. Run the mobile app (Expo Go)

> Your phone and computer must be on the **same Wi-Fi network**.

```bash
cd mobile
npm install          # first time only
npm start            # starts the Expo dev server
```

Expo will print a QR code in the terminal.

**iOS** — open the native Camera app, point it at the QR code, and tap the Expo Go banner.

**Android** — open Expo Go, tap **Scan QR code**, and scan the code from the terminal.

The app will bundle and launch on your device. Hot reloading is enabled by default — any file save refreshes the app instantly.

> **Tip:** if the QR code scan fails, press `w` to open the dev tools in a browser and use the **Expo Go** deep-link button, or run `npm start -- --tunnel` to bypass local network restrictions.

### 4. Run the tests

Unit tests require no running infrastructure — no Postgres or Redis needed.

```bash
cd api

# All unit tests
go test ./scoring/... ./handlers/...

# Verbose output
go test ./scoring/... ./handlers/... -v

# Specific package
go test ./scoring/... -v   # scoring engine (formula, decay, outlier, geo)
go test ./handlers/... -v  # handler input validation

# With coverage report
go test ./scoring/... ./handlers/... -cover

# Generate an HTML coverage report
go test ./scoring/... ./handlers/... -coverprofile=coverage.out
go tool cover -html=coverage.out
```

> **What the unit tests cover**
> - `scoring/engine_test.go` — raw score formula (audio + manual), time-decay aggregation, flagged contribution weighting, outlier detection, Haversine distance
> - `handlers/vibe_test.go` — `POST /v1/vibe` input validation (missing fields, bad manual ratings, malformed JSON)
> - `handlers/places_test.go` — `GET /v1/places/nearby` parameter validation (missing/non-numeric lat & lng)
> - `handlers/user_test.go` — `POST /v1/user/follow/:place_id` threshold validation

### 5. Try it out

```bash
# Nearby venues
curl "http://localhost:8080/v1/places/nearby?lat=12.9716&lng=77.6400&radius=500" \
  -H "X-User-ID: test-user"

# Submit a vibe check-in
curl -X POST http://localhost:8080/v1/vibe \
  -H "X-User-ID: test-user" \
  -H "Content-Type: application/json" \
  -d '{
    "place_id":     "1",
    "crowd_energy": 0.8,
    "music_energy": 0.7,
    "ambient_db":   0.6,
    "client_lat":   12.9716,
    "client_lng":   77.6400
  }'

# Venue detail
curl http://localhost:8080/v1/vibe/1 -H "X-User-ID: test-user"
```

### 6. Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://vibemeter:vibemeter@localhost:5432/vibemeter?sslmode=disable` | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `FIREBASE_PROJECT_ID` | — | Required in production for JWT validation |
| `GOOGLE_PLACES_API_KEY` | — | Backend key for venue metadata |
| `GEO_FENCE_RADIUS_M` | `300` | Max metres from venue to check in |
| `SCORE_WINDOW_MINUTES` | `180` | Rolling window for score aggregation |
| `RATE_LIMIT_MAX` | `2` | Max audio check-ins per user per venue per hour |
| `SKIP_AUTH` | `false` | Set `true` locally; reads `X-User-ID` header |
| `PORT` | `8080` | API listen port |

---

## Anti-spam & integrity

- **Rate limit** — max 2 audio check-ins per user per venue per hour (Redis counter)
- **Geo-fence** — server-side Haversine check; device must be within 300 m of the venue
- **Trust score** — new accounts contribute at 0.7× weight, rising to 1.0× after 10 verified check-ins over 7 days
- **Outlier detection** — scores deviating >40 points from the rolling average are flagged and contribute at 0.3× weight until reviewed
- **Manual fallback** — emoji ratings (no mic) are weighted at 0.7× to reduce gaming incentive

---

## Privacy

- **No raw audio transmitted** — the API accepts only three floats per check-in. Reconstructing audio from these values is architecturally impossible.
- **No voice transcription** — the Speech Activity Detector produces a single float (presence density), not words or identities.
- **No audio persistence** — the PCM buffer lives in memory for <2 seconds during ML inference, then is discarded. Never written to disk.
- **Microphone scope** — permission is requested only when the user taps Check the Vibe. No background access.
- **GDPR / DPDPA** — a user deletion request is satisfied by deleting their rows from `vibe_contributions` and `users`. No audio to purge.

---

## Roadmap

| Phase | Timeline | Highlights |
|---|---|---|
| **0 — MVP** | Weeks 1–8 | iOS, Bengaluru — full API, on-device YAMNet, WebSocket live scores, TestFlight beta |
| **1 — Growth** | Weeks 9–20 | Android, Apple Sign-In, push notifications, badges, city leaderboard |
| **2 — Intelligence** | Months 6–9 | Venue-type-aware weights, owner dashboard, multi-city, trending venues |
| **3 — Social** | Months 10+ | Social graph, promoted listings, public API, Apple Watch |

---

## License

Private & Confidential — VibeMeter © 2026
