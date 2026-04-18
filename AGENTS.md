# VibeMeter — Agentic & LLM Automation

This document covers the LLM-powered and agentic automation layers planned for VibeMeter.
Each initiative is listed with its motivation, architecture, and implementation status.

---

## Overview

VibeMeter collects real-time acoustic signals from venues and aggregates them into numeric scores.
LLM automation turns those numbers into language, reasoning, and action — increasing investigative
velocity and reducing the need for manual data review.

---

## Initiative 1 — Venue Vibe Summarisation ✅ In progress

**Goal:** Replace raw signal bars with a natural-language vibe description users actually understand.

**Example output:**
> *"Packed and loud — music is pumping and the crowd is buzzing. Good time to head in."*
> *"Winding down. Crowd has thinned and music energy is low."*
> *"Quiet with background hum — probably too early or a slow night."*

**Architecture:**
```
GET /v1/vibe/:place_id/summary
  ↓
Go handler reads latest signals + check-in count + time of day from Redis/Postgres
  ↓
Calls Claude API (claude-sonnet-4-6) with structured prompt
  ↓
Returns { summary: "...", tone: "lively|moderate|quiet" }
  ↓
VenueDetailScreen displays summary below the score hero
```

**Prompt inputs:** `crowd_energy`, `music_energy`, `ambient_db`, `venue_score`, `confidence`,
`check_in_count`, `venue_type` (bar/club/restaurant), `hour_of_day`

**Model:** `claude-sonnet-4-6` — fast, low-latency, ideal for short generative tasks

**Status:** Backend endpoint + mobile UI — implementation started

---

## Initiative 2 — Agentic Spam & Fraud Investigation

**Goal:** Automatically detect and reason over suspicious check-in patterns without manual DB review.

**Trigger:** Runs every 15 minutes via cron, or on-demand via `POST /v1/admin/investigate`

**What the agent does:**
1. Pulls flagged contributions from Postgres (`flagged = true`)
2. Groups by user, venue, and time window
3. Reasons over patterns:
   - Same user checking in repeatedly at the same venue within minutes
   - Score outliers (>40 pts from rolling average) from the same source
   - New accounts (trust_score < 0.5) submitting consistently extreme scores
4. Produces a written investigation summary per case
5. Either auto-resolves (marks as reviewed) or escalates with explanation to an ops Slack channel

**Architecture:**
```
Cron / admin trigger
  ↓
Go agent runner fetches flagged rows + user history from Postgres
  ↓
Calls Claude API with full context (contributions, user profile, timeline)
  ↓
Claude returns: { verdict: "spam|legitimate|review", confidence: 0-1, reasoning: "..." }
  ↓
Auto-resolve if confidence > 0.9, else write to ops_alerts table + notify Slack
```

**Model:** `claude-sonnet-4-6` with tool use — agent can call internal Go API endpoints as tools

**Status:** Planned — Phase 1 (post-MVP)

---

## Initiative 3 — Natural Language Venue Discovery

**Goal:** Let users search in plain English instead of using filter chips.

**Example queries:**
- *"lively rooftop bar, not too crowded, good music"*
- *"quiet restaurant for a date night"*
- *"where's the most hyped club right now?"*

**Architecture:**
```
User types query in search bar
  ↓
POST /v1/places/search { query: "lively rooftop..." }
  ↓
Claude extracts structured filters: { type: "bar", min_score: 65, max_crowd: 0.8 }
  ↓
Go handler queries Postgres + Redis with those filters
  ↓
Claude ranks + narrates results: "Here are the top 3 spots matching your vibe..."
  ↓
Returns ranked venue list with explanation
```

**Model:** `claude-haiku-4-5` for filter extraction (fast/cheap), `claude-sonnet-4-6` for narration

**Status:** Planned — Phase 1

---

## Initiative 4 — Ops Monitoring Agent

**Goal:** Replace manual log-watching with an agent that monitors the stack and explains anomalies.

**Monitors:**
- API p95 latency (Gin request logs)
- Redis hit rate for venue score cache
- YAMNet sidecar error rate (`/analyse` 4xx/5xx)
- Postgres slow queries
- Check-in submission rate (sudden drops = possible outage)

**Architecture:**
```
Agent runs every 5 minutes
  ↓
Pulls metrics from logs + Redis INFO + Postgres pg_stat_statements
  ↓
Claude reasons: "Redis hit rate dropped from 94% to 61% — likely caused by the
  3h TTL expiring after a gap in check-ins between 2–5am"
  ↓
Posts digest to Slack / WhatsApp with severity: info | warning | critical
```

**Model:** `claude-sonnet-4-6`

**Status:** Planned — Phase 2

---

## LLM Stack

| Component | Choice | Reason |
|---|---|---|
| Primary model | `claude-sonnet-4-6` | Best balance of speed, quality, and cost for real-time features |
| Fast/cheap tasks | `claude-haiku-4-5` | Filter extraction, classification, short structured outputs |
| Agent framework | Anthropic Agent SDK | Native tool-use, integrates cleanly with Go API endpoints as tools |
| API key config | `ANTHROPIC_API_KEY` env var | Never committed to source |

---

## Adding a New Agentic Feature

1. Add the Claude API call in a new Go handler (`api/handlers/`)
2. Register the route in `api/main.go`
3. Document it in this file with status, architecture, and prompt inputs
4. Add the `ANTHROPIC_API_KEY` env var entry to the README environment table
