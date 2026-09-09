# VibeMeter — App Store submission checklist

Status of every item from the readiness handoff. **Code** items are done on the
`appstore-readiness` branch. **Console / infra** items can only be done by a human
in App Store Connect, the Apple Developer portal, Firebase, or on the server —
they are spelled out here.

---

## 1. Permissions — DONE (code)

| Item | Where |
|---|---|
| Mic usage string (honest, server-side wording) | `mobile/app.json` → `ios.infoPlist.NSMicrophoneUsageDescription` |
| `NSLocationWhenInUseUsageDescription` added | `mobile/app.json` + `expo-location` plugin block |
| Android `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | `mobile/app.json` → `android.permissions` |
| No `NSLocationAlwaysAndWhenInUse` | confirmed absent |
| Blanket `NSAllowsArbitraryLoads` removed | see §8 — API must now serve valid TLS |
| Pre-permission primer (pre-prompt + denied states, "rate manually", Open Settings) | `mobile/src/components/PermissionPrimer.tsx`, wired in `CheckInScreen` |
| Denied → opens in RATE mode, mic path hidden | `CheckInScreen` `micPerm` gate |

**Console:** nothing. The strings ship in the binary.

---

## 2. Audio pipeline — DECISION MADE: Option B (server-side)

Code + docs now consistently describe server-side analysis. Remaining work is a
**declaration in App Store Connect**, not code:

- App Privacy → **Audio Data**: *Collected → Yes*, used for *App Functionality*,
  **Not** linked to the user's identity, **Not** used for tracking.
- Also declare: **Precise Location** (App Functionality, linked), **Coarse
  Location** (App Functionality), **User ID** (App Functionality, linked),
  **Name** + **Email Address** (App Functionality, linked), **Product
  Interaction / Usage Data** (App Functionality).
- Privacy policy URL: `https://imhanda.github.io/vibemeter/privacy.html`
  (already Option-B wording; updated this branch).

The designer still needs to reconcile any in-app screens in `Vibemeter.dc.html`
that say "audio never leaves the device" — the shipped copy (primer, privacy
line) now says it is sent to the server and discarded.

---

## 3. Account deletion + Sign in with Apple — DONE (code) + console

**Code**
- `DELETE /v1/me` — anonymises `vibe_contributions` + `trust_events`
  (`user_id → NULL`), hard-deletes `users`, `badges`,
  `notification_subscriptions`, `push_tokens`; purges Redis. Client then calls
  Firebase `deleteUser()`. Entry point: Profile → Account & Data → Delete
  Account (with confirm + `requires-recent-login` handling).
- Sign in with Apple: `LoginScreen` (expo-apple-authentication + Firebase
  `OAuthProvider('apple.com')` with hashed nonce), shown alongside Google on iOS.
  `usesAppleSignIn: true` in `app.json`.

**Console / config**
- Apple Developer portal → App ID `com.vibemeter.app` → enable **Sign In with
  Apple** capability. Regenerate provisioning profile.
- Firebase console → Authentication → Sign-in method → enable **Apple**; set the
  Services ID / Team ID / key if using web/Android flows.
- App Store Connect → App Review notes: mention the in-app delete path
  (Profile tab → Account & Data → Delete Account).
- Retention wording kept at "30 days" (backups) — matches privacy policy §5.

---

## 4. UGC report flow — DONE (code) + ops

**Code**
- `POST /v1/venues/:id/reports` (`wrong|closed|spam|unsafe` + detail), per-user
  daily cap `REPORT_RATE_MAX` (default 10), returns `review_sla_hours: 24`.
- Admin moderation queue: `GET /v1/admin/reports`,
  `POST /v1/admin/reports/:id/resolve` (guarded by `ADMIN_USER_IDS`).
- App: `ReportSheet` from the VenueDetail `⋯` header menu and an inline link.
- Community Guidelines page: `docs/community-guidelines.html`, linked from
  Profile → Account & Data.

**Ops**
- Commit to the 24-hour review in App Review notes and actually watch
  `GET /v1/admin/reports?status=open`. Set `ADMIN_USER_IDS` on the server to
  your Firebase UID.

---

## 5. Guideline 4.2 (reviewer in Cupertino) — DONE (code) + DB step

**Code**
- `migrations/004_us_demo_venues.sql` + mirrored `init.sql` block: 22 real South
  Bay venues (Cupertino / Sunnyvale / Santa Clara / San Jose / Mountain View /
  Palo Alto) with `google_rating` populated, so `nearby` from Cupertino returns
  a scored list with **zero** check-ins.
- Daytime state in `VenueListScreen`: "Now" / "Last night" tabs
  (`?window=last_night` → previous-evening peak per venue), a "nothing's going
  yet" banner when no nearby venue has a live vibe, plus offline cache of the
  last list with a stale banner.

**DB step (manual, one-off on RDS)** — migrations are not auto-applied:
```
psql "$DATABASE_URL" -f infra/postgres/migrations/003_reports_and_deletion.sql
psql "$DATABASE_URL" -f infra/postgres/migrations/004_us_demo_venues.sql
```
Then in App Review notes: "Open the app anywhere in the San Francisco Bay Area
(or the reviewer's location) — venues load with community + baseline scores.
During the day, tap 'Last night' to see peak scores."

---

## 6. Robustness — DONE (code)

- `GET /v1/vibe/:place_id/precheck` → `CheckInScreen` shows the rate-limit /
  geo-fence gate **before** recording or rating, not as a post-submit alert.
- Rate-limit copy now states the real rule (2 check-ins per venue per hour).
- Confidence bands: `<0.3 / 0.3–0.7 / >0.7` → Early data / Growing / Confident
  (`ConfidenceBadge` on VenueDetail).
- `Alert` failure paths in CheckIn replaced with inline error text.
- Offline: `VenueListScreen` caches the last list in AsyncStorage and shows a
  stale indicator instead of an empty screen.

---

## 7. Accessibility — DONE (code)

- Rating faces: `accessibilityRole="button"`, `accessibilityLabel`
  (Dead / Slow / Buzzing / Going off / Raging), `accessibilityState={{selected}}`.
- `theme.ts`: `textMuted` lightened to `#7A7398` (≥4.5:1 on the dark surfaces);
  new `textFaint` for decorative-only text.
- `useReduceMotion()` guards the mic halo loop, the score count-up and the emoji
  bounce; the score always shows its numeric value + RAGING/BUZZING/CHILL label.

---

## 8. Infra / build (was not in the handoff — still required)

- **Real TLS for the API.** `NSAllowsArbitraryLoads` was removed. `API_BASE_URL`
  is `https://13.63.7.88.nip.io` — that host must present a valid, CA-signed
  certificate (Caddy / Let's Encrypt on the nip.io hostname is enough). Verify
  with `curl -v https://13.63.7.88.nip.io/health` showing no cert warnings.
- **`SKIP_AUTH=false`** is now set in `mobile/src/config.ts`. Also make sure the
  server is **not** started with `SKIP_AUTH=true` in production.
- **Distribution signing**: create the App Store Connect app record for
  `com.vibemeter.app`, an App Store distribution provisioning profile, and
  archive via Xcode / EAS (the UAT build used a personal-team development
  profile).
- `expo prebuild` regenerates `mobile/ios` (gitignored). The plugins added to
  `app.json` (`expo-location`, `expo-apple-authentication`) will re-apply; the
  Xcode-26 fixes from UAT (`ENABLE_USER_SCRIPT_SANDBOXING=NO`, pod deployment
  target 15.1) should move into `expo-build-properties` so they survive a clean
  prebuild.

---

## Quick verification before archiving

```
# backend
cd api && go build ./... && go vet ./... && go test ./...

# mobile types
cd mobile && npx tsc --noEmit

# API is HTTPS with a valid cert
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://13.63.7.88.nip.io/health
```
