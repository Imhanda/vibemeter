package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"
	"vibemeter/db"
)

type osmCenter struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type osmElement struct {
	Type   string            `json:"type"`
	ID     int64             `json:"id"`
	Lat    float64           `json:"lat"`
	Lon    float64           `json:"lon"`
	Center osmCenter         `json:"center"`
	Tags   map[string]string `json:"tags"`
}

type overpassResp struct {
	Elements []osmElement `json:"elements"`
}

// Public Overpass instances are unreliable in ways that have nothing to do
// with query size: overpass-api.de outright blocks some source networks with
// a blanket non-200 on every request (including its own /api/status check),
// and even a mirror that's up can take anywhere from ~2s to 20s+ for the same
// query depending on its current load. seedFromOverpass now only ever runs in
// a background goroutine (see seedFromOverpassOnce / places.go), so it's safe
// to spend real time working through a short list of mirrors rather than
// giving up on the first bad response.
var overpassMirrors = []string{
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
	"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
}

var overpassClient = &http.Client{Timeout: 10 * time.Second}

// Overpass query time/size grows with the *area*, not the radius, so the
// nearby endpoint's user-facing radius (up to 50km) is unusable here — around
// a dense downtown that's tens of thousands of amenity nodes, which blows
// past a mirror's own server-side timeout and comes back with zero usable
// elements. Cap the seed fetch to a small radius: enough to bootstrap an
// unseeded area without timing out anywhere, including a dense city core.
const overpassSeedRadiusCapM = 2000.0

// Only one seed attempt per area at a time — GetNearbyPlaces fires this on
// every request while an area stays thin, and without this, a burst of
// requests for the same cold spot (e.g. several people opening the app in
// the same new city around the same time) would each kick off their own
// redundant, slow round trip through every mirror.
var overpassInFlight sync.Map // key: rounded "lat,lng" -> struct{}

// seedFromOverpassOnce is the entry point GetNearbyPlaces calls (via `go`).
// It skips the call entirely if this area is already being seeded.
func seedFromOverpassOnce(lat, lng, radius float64) {
	key := fmt.Sprintf("%.2f,%.2f", lat, lng) // ~1km grid cell
	if _, alreadyRunning := overpassInFlight.LoadOrStore(key, struct{}{}); alreadyRunning {
		return
	}
	defer overpassInFlight.Delete(key)
	seedFromOverpass(lat, lng, radius)
}

// seedFromOverpass queries OpenStreetMap for nightlife/dining venues near a
// location and upserts them into the places table. Tries each mirror in
// overpassMirrors in turn, stopping at the first one that returns a decodable
// 200. Must only be called from a background goroutine — see
// seedFromOverpassOnce.
func seedFromOverpass(lat, lng, radius float64) {
	if radius > overpassSeedRadiusCapM {
		radius = overpassSeedRadiusCapM
	}
	// nwr = node/way/relation so building-footprint venues (ways) are included.
	// out center returns a center point for ways/relations instead of no coords.
	query := fmt.Sprintf(
		`[out:json][timeout:20];nwr[amenity~"^(bar|pub|nightclub|restaurant|cafe|fast_food|food_court|biergarten)$"](around:%.0f,%.6f,%.6f);out center;`,
		radius, lat, lng,
	)
	encoded := url.QueryEscape(query)

	var result overpassResp
	fetched := false
	for _, base := range overpassMirrors {
		req, err := http.NewRequest(http.MethodGet, base+"?data="+encoded, nil)
		if err != nil {
			log.Printf("overpass: %s request build error: %v", base, err)
			continue
		}
		// Confirmed by hand: Go's default "Go-http-client/1.1" User-Agent gets
		// this rejected outright by more than one public mirror (an outright
		// 406 from overpass-api.de, an explicit 429 "include a meaningful
		// User-Agent" from kumi.systems) — this single header was the actual
		// fix, more than the radius cap or the mirror list.
		req.Header.Set("User-Agent", "VibeMeterApp/1.0 (+https://imhanda.github.io/vibemeter)")
		resp, err := overpassClient.Do(req)
		if err != nil {
			log.Printf("overpass: %s fetch error: %v", base, err)
			continue
		}
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			resp.Body.Close()
			log.Printf("overpass: %s non-200 status %d near (%.4f, %.4f): %s", base, resp.StatusCode, lat, lng, body)
			continue
		}
		err = json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()
		if err != nil {
			log.Printf("overpass: %s decode error: %v", base, err)
			continue
		}
		fetched = true
		break
	}
	if !fetched {
		log.Printf("overpass: all mirrors failed near (%.4f, %.4f) r=%.0fm", lat, lng, radius)
		return
	}

	// A city core can return thousands of nodes; cap how many we walk so a
	// single seed can't turn into an unbounded number of sequential inserts.
	const maxElements = 500
	elements := result.Elements
	if len(elements) > maxElements {
		elements = elements[:maxElements]
	}

	inserted := 0
	for _, el := range elements {
		name := el.Tags["name"]
		if name == "" {
			continue
		}
		// nodes have lat/lon at top level; ways/relations use center coords
		elLat, elLon := el.Lat, el.Lon
		if elLat == 0 && elLon == 0 {
			elLat, elLon = el.Center.Lat, el.Center.Lon
		}
		if elLat == 0 && elLon == 0 {
			continue
		}
		placeID := fmt.Sprintf("osm_%s_%d", el.Type, el.ID)
		_, err := db.DB.Exec(`
			INSERT INTO places (id, name, lat, lng, type, address, photo_url, location, places_synced_at)
			VALUES ($1, $2, $3, $4, $5, $6, '', ST_SetSRID(ST_MakePoint($4, $3), 4326), NOW())
			ON CONFLICT (id) DO UPDATE SET places_synced_at = NOW()
		`, placeID, name, elLat, elLon, osmTypeToVenue(el.Tags["amenity"]), el.Tags["addr:street"])
		if err != nil {
			log.Printf("overpass: upsert %s: %v", placeID, err)
			continue
		}
		inserted++
	}
	log.Printf("overpass: seeded %d venues near (%.4f, %.4f) r=%.0fm", inserted, lat, lng, radius)
}

func osmTypeToVenue(amenity string) string {
	switch amenity {
	case "nightclub":
		return "club"
	case "restaurant", "cafe", "fast_food", "food_court":
		return "restaurant"
	case "bar", "pub", "biergarten":
		return "bar"
	default:
		return "bar"
	}
}
