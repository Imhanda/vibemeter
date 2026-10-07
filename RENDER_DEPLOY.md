# VibeMeter — Render + Neon + Upstash Deployment Guide

Replaces the AWS setup in [AWS_DEPLOY.md](AWS_DEPLOY.md) (retired 2026-10-07).

## Architecture

```
Mobile App (Expo / iOS)
      │  HTTPS (Render-managed TLS, no certbot/nginx to maintain)
      ▼
vibemeter-api.onrender.com  (Render web service, Docker, Free plan,
      │                  │   kept awake by an external UptimeRobot ping)
      │ internal network │ internal network
      ▼                  ▼
vibemeter-yamnet          Upstash Redis (free)
(Render private service,   — venue scores (no TTL),
 Docker, Free plan, NOT     rate limits, trust scores,
 kept artificially warm)    websocket pub/sub
      ▼
Neon Postgres (free) — places, users, check-ins, trust events
```

**Entirely $0/mo**, with one deliberate tradeoff explained below.

**Why api is pinged awake but yamnet isn't, even though both are free
plan:** Render's free tier gives the whole workspace a shared pool of 750
instance-hours/month (a month is ~730 hours). Keeping `vibemeter-api`
always-on via an external ping already uses nearly the entire pool by
itself. Also keeping `vibemeter-yamnet` always-on would need ~1460 combined
hours/month, blow the shared budget around mid-month, and get **both**
free services suspended until the next month — a full outage, which is
worse than the alternative: `AnalyseAudio` (`api/handlers/analyse.go`)
calls yamnet synchronously on the check-in path, so the first audio upload
after >15min of no traffic eats a one-time ~30-60s cold start on that one
endpoint. That's a narrower, cheaper risk than the general-reachability
"request timed out" bug that got build 1.0 (5) rejected by App Review
(`docs/APP_STORE_SUBMISSION.md` history) — which is specifically what
keeping `api` always-on avoids.

If that one-endpoint cold start becomes a real problem later, the fix is
moving `vibemeter-yamnet` alone to Render's cheapest paid plan (~$7/mo) —
paid plans don't draw from the free hour pool, so `api` and everything
else stays $0 either way.

**Why not Render's own Key Value (Redis) product:** its free tier is
in-memory only and gets wiped on every restart, and Render reserves the
right to restart it at any time. `cache.SetVenueScore` and the trust-score
cache write with **no expiration** — venue scores are meant to persist, not
just cache. Upstash's free tier (256MB, 500k commands/month) persists data
properly and costs nothing at this scale.

## Setup steps

### 1. Neon (Postgres)
1. Create a project at neon.com, region close to users (or close to
   Render's `frankfurt` region above, to minimize latency).
2. Copy the connection string it gives you (already includes
   `?sslmode=require`, which `lib/pq` understands as-is — no code change
   needed, see `api/db/db.go`).
3. Run the schema against it, in order:
   ```
   psql '<neon-connection-string>' -f infra/postgres/init.sql
   psql '<neon-connection-string>' -f infra/postgres/migrations/000_partitions.sql
   psql '<neon-connection-string>' -f infra/postgres/migrations/001_trust_events.sql
   psql '<neon-connection-string>' -f infra/postgres/migrations/002_google_ratings.sql
   psql '<neon-connection-string>' -f infra/postgres/migrations/003_reports_and_deletion.sql
   psql '<neon-connection-string>' -f infra/postgres/migrations/004_us_demo_venues.sql
   ```
   `init.sql` seeds venues via a `COPY ... FROM` that points at a path only
   present in local dev (`infra/postgres/places_seed.csv` via the compose
   volume mount) — if that COPY step errors on Neon, load
   `infra/seed_places.py` separately instead of fighting the seed block in
   `init.sql`.
4. Neon supports the `postgis` and `pgcrypto` extensions `init.sql`
   requires — nothing extra to enable, `CREATE EXTENSION IF NOT EXISTS`
   just works.

### 2. Upstash (Redis)
1. Create a free Redis database at upstash.com, same region as above if
   offered.
2. Copy the `rediss://` connection string (TLS) — `go-redis` reads it
   fine via `redis.ParseURL` in `api/cache/redis.go`.

### 3. Render
1. Push `render.yaml` (already in the repo root) to `main`.
2. In the Render dashboard: New → Blueprint → pick this GitHub repo. Render
   reads `render.yaml` and proposes both services (`vibemeter-api` web,
   `vibemeter-yamnet` private).
3. On the "Environment Variables" step, it'll prompt for every `sync: false`
   var in `render.yaml`:
   - `DATABASE_URL` → the Neon connection string
   - `REDIS_URL` → the Upstash connection string
   - `FIREBASE_PROJECT_ID`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_WEB_CLIENT_ID`,
     `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY` → same values as
     `infra/.env` locally (not committed, check that file or your password
     manager)
   - `YAMNET_URL` is wired automatically via `fromService` — don't set it
     manually.
4. Deploy. Render builds both Dockerfiles and gives `vibemeter-api` a public
   URL like `https://vibemeter-api.onrender.com` (confirm the exact
   hostname in the dashboard — Render may suffix it if the name's taken).
5. Check `https://<that-url>/health`.

Render auto-deploys on every push to `main` from here on — no GitHub Actions
deploy workflow needed. `.github/workflows/deploy.yml` (AWS/SSM-based) is
already disabled; safe to delete once this is confirmed working.
`.github/workflows/uptime-check.yml` is also disabled — **don't re-enable it
as the keep-alive mechanism**: this repo already proved GitHub's free-tier
cron only fires ~every 2h in practice, well short of the <15min interval
Render's free plan needs. It's fine to re-enable later purely as a
secondary "is it actually up" alert (at whatever interval GitHub gives it),
separate from the keep-alive job UptimeRobot does below.

### 4. UptimeRobot (keep-alive for `vibemeter-api`)
1. After step 3's deploy, note `vibemeter-api`'s public URL.
2. Create a free account at uptimerobot.com.
3. Add a new monitor: HTTP(s), URL = `https://<that-url>/health`, interval
   = 5 minutes (comfortably under Render's 15min sleep window).
4. That's it — no code or repo changes needed. `vibemeter-yamnet` is
   deliberately left unmonitored; see the architecture note above for why.

### 5. Mobile app
Update the hardcoded backend URL in `mobile/src/config.ts`:
```ts
return "https://13.63.7.88.nip.io";   // old AWS Elastic IP
```
→
```ts
return "https://vibemeter-api.onrender.com";   // or whatever Render assigned
```
Bump `mobile/app.json` `buildNumber` per the usual release loop, then build
and TestFlight-upload as before.

### 6. Confirm no AWS references remain
`infra/postgres/migrations/` is still the source of truth for schema
changes — same workflow as before (write migration → PR → merge → apply
manually against Neon with `psql`, same manual-apply caution that applied
to RDS, since there's still no automated migration runner).
