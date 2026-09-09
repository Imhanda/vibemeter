# VibeMeter

> Real-time nightlife vibe scoring using ambient audio intelligence

VibeMeter lets you discover nearby bars, pubs, clubs, and restaurants and know whether they're actually lively **right now** — not just whether they have good reviews. Users do a ~10-second ambient-sound check-in; the recording is sent to the backend, scored into three numeric signals, and discarded immediately — it is never stored on the device or the server. Users can also skip the mic and rate the vibe manually.

Live scores are computed over a rolling 3-hour window, so the data always reflects the present moment.

---

## How it works

1. User taps **Check the Vibe** at a venue and either records ~10 seconds of ambient sound or picks a manual rating
2. For a sound check-in, the audio is uploaded over HTTPS to the API, which proxies it to the YAMNet sidecar
3. YAMNet classifies the clip in memory into `crowd_energy`, `music_energy`, `ambient_db`; the audio bytes are then discarded — never written to disk or stored
4. Those three floats (plus the venue ID and the user's location for the geo-fence check) are what persist
5. The backend aggregates recent check-ins with exponential time-decay and updates the live score
6. All connected clients receive the new score via WebSocket within a few seconds

---

## Scoring

```
raw_score = (0.55 × crowd_energy + 0.40 × music_energy + 0.05 × ambient_db) × 100
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
| Mobile | React Native + Expo (SDK 54) |
| Audio capture | `expo-audio` (~10 s clip, uploaded for scoring) |
| Server-side ML | YAMNet (TensorFlow Hub) in a Flask sidecar |
| Maps | Google Maps SDK |
| Auth | Firebase Auth (Sign in with Apple + Google) |
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
| `POST` | `/v1/vibe/analyse` | Upload ~10s audio → YAMNet signals (crowd, music, ambient); audio discarded after inference |
| `POST` | `/v1/vibe` | Submit a vibe check-in with audio signals or manual rating |
| `GET` | `/v1/vibe/:place_id` | Venue detail + score history |
| `GET` | `/v1/vibe/:place_id/precheck` | Whether a check-in is allowed now (rate limit / geo-fence) |
| `GET` | `/v1/places/nearby` | Nearby venues with live scores (`?window=last_night` for previous-night peaks) |
| `GET` | `/v1/user/profile` | Authenticated user profile + badges |
| `POST` | `/v1/user/follow/:place_id` | Subscribe to venue push notifications |
| `DELETE` | `/v1/me` | Delete account (anonymises contributions) |
| `POST` | `/v1/venues/:id/reports` | Report a venue's score (`wrong` / `closed` / `spam` / `unsafe`) |
| `GET` | `/v1/admin/reports` | Moderation queue (admin) |
| `POST` | `/v1/admin/reports/:id/resolve` | Resolve a report (admin) |
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

## Setup

For step-by-step instructions to run the app locally (including tool installation, Docker setup, API keys, and building to iPhone), see **[SETUP.md](SETUP.md)**.

---

## Anti-spam & integrity

- **Rate limit** — max 2 audio check-ins per user per venue per hour (Redis counter)
- **Geo-fence** — server-side Haversine check; device must be within 300 m of the venue
- **Trust score** — new accounts contribute at 0.7× weight, rising to 1.0× after 10 verified check-ins over 7 days
- **Outlier detection** — scores deviating >40 points from the rolling average are flagged and contribute at 0.3× weight until reviewed
- **Manual fallback** — emoji ratings (no mic) are weighted at 0.7× to reduce gaming incentive

---

## Privacy

The audio pipeline is **server-side**. This is a deliberate choice; the App Store privacy label declares **Audio Data — collected, app functionality, not linked to identity**, and all in-app copy reflects it.

- **Audio is transmitted** — ~10 s of audio is uploaded over HTTPS to the API, which proxies it to the YAMNet sidecar. It is used solely for classification.
- **In-memory only** — the sidecar runs inference in RAM and returns three floats. The audio bytes are never written to disk, logged, or stored in a database or object storage.
- **No voice transcription** — YAMNet classifies sound categories (music, crowd, noise), not speech content or speaker identity.
- **Manual fallback** — users can decline the microphone and rate with an emoji scale.
- **Microphone scope** — permission is requested (behind an in-app primer) only when the user checks in. No background access.
- **Account deletion** — in-app (`DELETE /v1/me`) anonymises the user's `vibe_contributions` and `trust_events` (user_id → NULL) and hard-deletes `users`, `badges`, `notification_subscriptions` and `push_tokens`. The client then deletes the Firebase Auth record. No audio to purge.

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
