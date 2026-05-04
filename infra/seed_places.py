#!/usr/bin/env python3
"""
VibeMeter — Places Seed Generator
===================================
Fetches the top bars, pubs, and restobars for any city from the
Google Places API (New) and writes a seed CSV that Docker uses to
populate the Postgres database on first startup.

Usage
-----
    python3 seed_places.py --city "Mumbai" --api-key YOUR_KEY
    python3 seed_places.py --city "New York" --api-key YOUR_KEY --limit 200
    python3 seed_places.py --city "London" --api-key YOUR_KEY --output custom_seed.csv

The output CSV is written to postgres/places_seed.csv by default, which is
the file Docker mounts into Postgres at startup. After running this script,
do a fresh `docker compose down -v && docker compose up -d` to reload the DB
with the new venues.

Requirements
------------
    pip install requests

You need a Google Places API key with the following API enabled:
    - Places API (New)  — https://console.cloud.google.com/apis/library/places.googleapis.com

Get a key at: https://console.cloud.google.com/apis/credentials
"""

import argparse
import csv
import math
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' library not installed.")
    print("Run:  pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Place types we care about — these map to Google Places API types
VENUE_TYPES = ["bar", "pub", "night_club", "wine_bar", "cocktail_bar", "sports_bar"]

# Google Places API (New) endpoints
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby"

# Fields we want from each place (Places API New field mask)
FIELD_MASK = ",".join([
    "places.id",
    "places.displayName",
    "places.location",
    "places.primaryType",
    "places.formattedAddress",
    "places.photos",
    "places.rating",
    "places.userRatingCount",
])

# Radius in metres for each individual API call.
# 8 km gives good density without burning too many quota units.
# Max allowed by the API is 50,000 m.
SEARCH_RADIUS_M = 8000

# How many results to request per API call (max 20 for Nearby Search)
PAGE_SIZE = 20

# Seconds to wait between API calls to avoid rate limiting
REQUEST_DELAY = 0.3

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def geocode_city(city: str, api_key: str) -> tuple[float, float]:
    """Return (lat, lng) for a city name using the Geocoding API."""
    resp = requests.get(GEOCODE_URL, params={"address": city, "key": api_key}, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if data["status"] != "OK" or not data["results"]:
        print(f"ERROR: Could not geocode '{city}'. Google said: {data.get('status')}")
        sys.exit(1)
    loc = data["results"][0]["geometry"]["location"]
    return loc["lat"], loc["lng"]


def nearby_search(lat: float, lng: float, place_type: str, api_key: str) -> list[dict]:
    """
    Call the Places API (New) Nearby Search for a single type and location.
    Returns a list of raw place dicts.
    """
    payload = {
        "includedTypes": [place_type],
        "maxResultCount": PAGE_SIZE,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": SEARCH_RADIUS_M,
            }
        },
        "rankPreference": "POPULARITY",
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": FIELD_MASK,
    }
    resp = requests.post(NEARBY_SEARCH_URL, json=payload, headers=headers, timeout=15)

    if resp.status_code == 403:
        print("\nERROR: API key rejected (403 Forbidden).")
        print("Response:", resp.text)
        sys.exit(1)
    if resp.status_code == 429:
        print("\nWARN: Rate limited (429). Waiting 5 seconds...")
        time.sleep(5)
        return nearby_search(lat, lng, place_type, api_key)

    resp.raise_for_status()
    return resp.json().get("places", [])


def extract_photo_url(place: dict, api_key: str) -> str:
    """
    Build a photo URL from the first photo reference if available.
    Uses the Places API photo endpoint — returns an empty string if no photo.
    """
    photos = place.get("photos", [])
    if not photos:
        return ""
    name = photos[0].get("name", "")  # e.g. "places/ChIJ.../photos/AXCi..."
    if not name:
        return ""
    return (
        f"https://places.googleapis.com/v1/{name}/media"
        f"?maxHeightPx=400&maxWidthPx=400&key={api_key}"
    )


def parse_place(place: dict, api_key: str) -> dict | None:
    """Convert a raw API place dict into our CSV row format."""
    place_id = place.get("id", "").strip()
    name_obj = place.get("displayName", {})
    name = name_obj.get("text", "").strip() if isinstance(name_obj, dict) else ""
    loc = place.get("location", {})
    lat = loc.get("latitude")
    lng = loc.get("longitude")
    address = place.get("formattedAddress", "").strip()
    primary_type = place.get("primaryType", "bar").strip()

    if not place_id or not name or lat is None or lng is None:
        return None  # skip incomplete records

    # Normalise to the venue type values stored in the DB
    type_map = {
        "bar":              "bar",
        "pub":              "bar",
        "cocktail_bar":     "bar",
        "wine_bar":         "bar",
        "sports_bar":       "bar",
        "night_club":       "club",
        "karaoke":          "club",
        "live_music_venue": "club",
    }
    venue_type = type_map.get(primary_type, "bar")

    photo_url = extract_photo_url(place, api_key)

    return {
        "id": place_id,
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": venue_type,
        "address": address,
        "photo_url": photo_url,
    }


# ---------------------------------------------------------------------------
# Search grid — cover a radius of `coverage_km` km from the city centre
# ---------------------------------------------------------------------------

def build_search_grid(
    centre_lat: float,
    centre_lng: float,
    coverage_km: float = 20.0,
) -> list[tuple[float, float]]:
    """
    Return a grid of (lat, lng) points that together cover a circle of
    `coverage_km` km radius around the city centre.

    Grid spacing = SEARCH_RADIUS_M × 1.5 so adjacent circles overlap ~33%,
    avoiding gaps between search areas.

    1 degree latitude  ≈ 111 km everywhere.
    1 degree longitude ≈ 111 km × cos(lat) — corrected so the grid stays
    square on the ground.
    """
    spacing_m = SEARCH_RADIUS_M * 1.5
    spacing_lat = spacing_m / 111_000
    spacing_lng = spacing_m / (111_000 * math.cos(math.radians(centre_lat)))

    steps = math.ceil((coverage_km * 1000) / spacing_m)

    points: list[tuple[float, float]] = []
    for di in range(-steps, steps + 1):
        for dj in range(-steps, steps + 1):
            # Only keep points whose centre is within coverage_km of city centre
            # (trims the square grid into a circle, reducing unnecessary calls)
            dist_km = math.sqrt((di * spacing_m) ** 2 + (dj * spacing_m) ** 2) / 1000
            if dist_km <= coverage_km:
                points.append((
                    centre_lat + di * spacing_lat,
                    centre_lng + dj * spacing_lng,
                ))

    return points


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch top venue seeds for VibeMeter from Google Places API."
    )
    parser.add_argument(
        "--city",
        required=True,
        help='City name, e.g. "Mumbai", "London", "New York"',
    )
    parser.add_argument(
        "--api-key",
        required=True,
        help="Google Places API key (needs Places API New + Geocoding API enabled)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Maximum number of venues to write (default: 500)",
    )
    parser.add_argument(
        "--radius",
        type=float,
        default=20.0,
        help="Coverage radius in km from city centre (default: 20)",
    )
    parser.add_argument(
        "--output",
        default=str(Path(__file__).parent / "postgres" / "places_seed.csv"),
        help="Output CSV path (default: postgres/places_seed.csv)",
    )
    args = parser.parse_args()

    print(f"\nVibeMeter Seed Generator")
    print(f"  City     : {args.city}")
    print(f"  Radius   : {args.radius} km")
    print(f"  Limit    : {args.limit}")
    print(f"  Output   : {args.output}")
    print(f"  Types    : {', '.join(VENUE_TYPES)}")
    print()

    # Step 1 — geocode the city
    print(f"[1/4] Geocoding '{args.city}'...")
    centre_lat, centre_lng = geocode_city(args.city, args.api_key)
    print(f"      Centre: {centre_lat:.4f}, {centre_lng:.4f}")

    # Step 2 — build search grid
    grid = build_search_grid(centre_lat, centre_lng, coverage_km=args.radius)
    total_calls = len(grid) * len(VENUE_TYPES)
    print(f"[2/4] Search grid: {len(grid)} points × {len(VENUE_TYPES)} types = "
          f"{total_calls} API calls (~{total_calls * REQUEST_DELAY:.0f}s)")

    # Step 3 — fetch places
    print(f"[3/4] Fetching places...")
    seen_ids: set[str] = set()
    rows: list[dict] = []

    call_count = 0
    for lat, lng in grid:
        for ptype in VENUE_TYPES:
            if len(rows) >= args.limit:
                break
            call_count += 1
            try:
                raw_places = nearby_search(lat, lng, ptype, args.api_key)
            except requests.RequestException as e:
                print(f"      WARN: API call failed ({e}), skipping this point")
                continue

            new_this_call = 0
            for raw in raw_places:
                if len(rows) >= args.limit:
                    break
                row = parse_place(raw, args.api_key)
                if row and row["id"] not in seen_ids:
                    seen_ids.add(row["id"])
                    rows.append(row)
                    new_this_call += 1

            print(f"      [{call_count:3d}/{total_calls}] type={ptype:16s} "
                  f"lat={lat:.3f} lng={lng:.3f} → +{new_this_call} "
                  f"(total: {len(rows)})")
            time.sleep(REQUEST_DELAY)

        if len(rows) >= args.limit:
            break

    print(f"\n      Collected {len(rows)} unique venues")

    # Step 4 — write CSV
    print(f"[4/4] Writing CSV to {args.output}...")
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["id", "name", "lat", "lng", "type", "address", "photo_url"]
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nDone! {len(rows)} venues written to {args.output}")
    print()
    print("Next steps:")
    print("  1. cd infra/")
    print("  2. docker compose down -v      # wipe existing DB data")
    print("  3. docker compose up -d        # fresh start with new seed")
    print()


if __name__ == "__main__":
    main()
