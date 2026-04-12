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
├── mobile/                  # React Native + Expo SDK 54
│   ├── src/
│   │   ├── screens/         # VenueListScreen, VenueDetailScreen, CheckInScreen, ProfileScreen
│   │   ├── components/      # VenueCard, VibeBadge
│   │   ├── api/             # client.ts, places.ts, vibe.ts, user.ts, websocket.ts
│   │   ├── store/           # useVibeStore.ts (Zustand)
│   │   └── config.ts        # API_BASE_URL, DEFAULT_LOCATION, SKIP_AUTH
│   ├── App.tsx              # Navigation (bottom tabs + native stack)
│   ├── index.js             # Expo entry point
│   └── app.json             # Expo config (SDK 54, mic permissions)
├── api/                     # Go 1.22 + Gin REST API
│   ├── config/              # Env-based configuration
│   ├── cache/               # Redis client, venue score cache, pub/sub
│   ├── db/                  # sqlx Postgres connection pool
│   ├── handlers/            # vibe.go, places.go, user.go, ws.go, analyse.go, admin.go
│   ├── middleware/          # auth.go (Firebase JWT / SKIP_AUTH)
│   ├── models/              # place.go, user.go, vibe.go
│   ├── scoring/             # engine.go — formula, decay, outlier, Haversine
│   └── main.go
└── infra/
    ├── docker-compose.yml   # Postgres, Redis, pgAdmin, YAMNet sidecar
    ├── postgres/
    │   ├── init.sql         # Full schema + 61 Bengaluru venue seeds
    │   └── places_seed.csv  # Venue data from Google Places API
    └── yamnet/              # Audio analysis sidecar (port 8082)
        ├── app.py           # Flask + TensorFlow Hub YAMNet inference
        ├── requirements.txt
        └── Dockerfile
```

---

## API

All endpoints require `Authorization: Bearer <firebase_jwt>`. Set `SKIP_AUTH=true` locally and pass `X-User-ID` instead.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/vibe/analyse` | Upload 10s audio → YAMNet signals (crowd, music, ambient) |
| `POST` | `/v1/vibe` | Submit a vibe check-in with audio signals or manual rating |
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

## Services & ports

| Service | Port | Description |
|---|---|---|
| **Go API** | `8080` | REST + WebSocket backend — run with `go run .` |
| **Expo Metro** | `8081` | React Native dev bundler — started by `npx expo start` |
| **YAMNet sidecar** | `8082` | Python Flask service running Google's YAMNet audio classifier |
| **PostgreSQL** | `5432` | Primary database (Postgres 16 + PostGIS) — Docker |
| **Redis** | `6379` | Score cache, rate-limiting counters, WebSocket pub/sub — Docker |
| **pgAdmin** | `5050` | Database GUI — Docker (`vibe@admin.com` / `vibeadmin`) |

> All Docker services are defined in `infra/docker-compose.yml`. The YAMNet sidecar runs as a Docker container (`infra/yamnet/`) and is proxied by the Go API at `POST /v1/vibe/analyse`.

---

## Running the app locally

> This section is written for anyone setting up VibeMeter for the first time — no prior engineering experience assumed.

---

### What you need to install (one time only)

#### 1. Docker Desktop
Docker runs the database, cache, and audio analysis service in containers so you don't need to install them manually.

Download and install from: https://www.docker.com/products/docker-desktop

After installing, open **Docker Desktop** and leave it running in the background.

#### 2. Go
The backend API is written in Go.

Download from: https://go.dev/dl/ — install version **1.22 or higher**.

Verify it works:
```bash
go version
# should print: go version go1.22.x ...
```

#### 3. Node.js (via nvm)
The mobile app build tool (Expo) requires Node.js version **20.19.4 or higher**.

Install nvm (Node version manager) first:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

Restart your terminal, then install and activate the correct Node version:
```bash
nvm install 20.19.4
nvm use 20.19.4
```

Verify:
```bash
node --version
# should print: v20.19.4
```

#### 4. Expo Go on your phone
Install the **Expo Go** app on your iPhone or Android phone:
- iPhone: [App Store — Expo Go](https://apps.apple.com/app/expo-go/id982107779)
- Android: [Google Play — Expo Go](https://play.google.com/store/apps/details?id=host.exp.exponent)

> Your phone and your Mac/PC must be on the **same Wi-Fi network** for the app to connect.

---

### Starting everything up

Open a terminal and follow these steps in order. Each step needs its own terminal tab.

#### Step 1 — Start the backend services (Terminal tab 1)

```bash
cd vibemeter/infra
docker compose up -d
```

This starts the database, cache, and the audio analysis service. The first time you run this it will download Docker images — it may take 3–5 minutes.

Wait until all containers show as **running**:
```bash
docker compose ps
```

You should see `vibemeter-postgres`, `vibemeter-redis`, `vibemeter-yamnet`, and `vibemeter-pgadmin` all with status `Up`.

Confirm the audio analysis service is ready:
```bash
curl http://localhost:8082/health
# should return: {"status":"ok"}
```

> If the yamnet container is still starting up, wait 30 seconds and try again.

#### Step 2 — Start the API server (Terminal tab 2)

```bash
cd vibemeter/api
SKIP_AUTH=true go run .
```

You should see:
```
Connected to DB
Connected to Redis
VibeMeter API starting on :8080
```

Leave this terminal running.

Confirm the API is up:
```bash
curl http://localhost:8080/health
# should return: {"status":"ok"}
```

#### Step 3 — Start the mobile app (Terminal tab 3)

```bash
cd vibemeter/mobile
source ~/.nvm/nvm.sh && nvm use 20.19.4
npm install          # first time only — downloads app dependencies
npx expo start --clear
```

A QR code will appear in the terminal.

**iPhone** — open the native Camera app, point it at the QR code, and tap the **Open in Expo Go** banner that appears.

**Android** — open Expo Go, tap **Scan QR code**, and scan the code.

The app will download and launch on your device (takes ~30 seconds the first time). The VibeMeter logo will appear, then the venue list.

---

### Using the app

1. **Venue list** — browse nearby Bengaluru nightlife venues with their current vibe scores
2. **Tap a venue** — see the live score, signal breakdown (music / crowd / ambient), and check-in history
3. **Check the Vibe** — tap the button on any venue detail page to submit a vibe check-in:
   - **Listen tab** — tap the mic, hold your phone up for 10 seconds, get real audio scores from YAMNet
   - **Rate tab** — pick an emoji (💤 to 🔥) as a quick manual rating
4. **Profile** — see your check-in count, streak, and earned badges

---

### Stopping everything

```bash
# Stop the Expo dev server
# Press Ctrl+C in terminal tab 3

# Stop the API server
# Press Ctrl+C in terminal tab 2

# Stop Docker services
cd vibemeter/infra
docker compose down
```

---

### Starting fresh (if something is broken)

```bash
cd vibemeter/infra

# Stop and remove all containers + data (resets the database)
docker compose down -v

# Rebuild and restart everything from scratch
docker compose up --build -d
```

Then restart the API and Expo as above.

---

### Troubleshooting

| Problem | Fix |
|---|---|
| App shows "Network request failed" | Make sure your phone and Mac are on the same Wi-Fi network. Check that the API is running on port 8080. |
| QR code scan fails | Try `npx expo start --tunnel` instead — this routes through Expo's servers and bypasses local network restrictions. |
| Port 8081 already in use | Run `kill $(lsof -ti :8081)` then restart Expo. |
| Docker containers not starting | Make sure Docker Desktop is open and running. |
| YAMNet health check fails | The model takes ~60 seconds to load on first start. Wait and retry. |
| Old icon/splash still showing | Force-close Expo Go on your phone, clear its cache in Settings, then re-scan the QR code. |

---

### Developer environment variables

These are only needed if you are changing API behaviour:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://vibemeter:vibemeter@localhost:5432/vibemeter?sslmode=disable` | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `YAMNET_URL` | `http://localhost:8082` | YAMNet sidecar base URL |
| `FIREBASE_PROJECT_ID` | — | Required in production for JWT validation |
| `GOOGLE_PLACES_API_KEY` | — | Backend key for venue metadata sync |
| `GEO_FENCE_RADIUS_M` | `300` | Max metres from venue to check in |
| `SCORE_WINDOW_MINUTES` | `180` | Rolling window for score aggregation |
| `RATE_LIMIT_MAX` | `2` | Max audio check-ins per user per venue per hour |
| `SKIP_AUTH` | `false` | Set `true` locally; reads `X-User-ID` header instead of Firebase JWT |
| `PORT` | `8080` | API listen port |

---

### Running the backend tests

```bash
cd vibemeter/api
go test ./scoring/... ./handlers/...

# With coverage
go test ./scoring/... ./handlers/... -cover
```

---

## Anti-spam & integrity

- **Rate limit** — max 2 audio check-ins per user per venue per hour (Redis counter)
- **Geo-fence** — server-side Haversine check; device must be within 300 m of the venue
- **Trust score** — new accounts contribute at 0.7× weight, rising to 1.0× after 10 verified check-ins over 7 days
- **Outlier detection** — scores deviating >40 points from the rolling average are flagged and contribute at 0.3× weight until reviewed
- **Manual fallback** — emoji ratings (no mic) are weighted at 0.7× to reduce gaming incentive

---

## Privacy

- **Minimal audio transmission** — 10 seconds of audio is uploaded to the backend solely for YAMNet classification. No audio is stored in a database or object storage.
- **In-memory processing only** — the YAMNet sidecar receives audio bytes, runs inference in RAM, and returns three floats. The audio is discarded immediately after analysis — never written to disk.
- **No voice transcription** — YAMNet classifies sound categories (music, crowd, noise), not speech content or speaker identity.
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
