package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
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

var overpassClient = &http.Client{Timeout: 20 * time.Second}

// Overpass query time/size grows with the *area*, not the radius, so the
// nearby endpoint's user-facing radius (up to 50km) is unusable here — around
// a dense downtown that's tens of thousands of amenity nodes, which blows
// past the server's own [timeout:15] and comes back with zero usable
// elements (silently, since the outer request still succeeds with an empty
// places table). Cap the seed fetch to a small radius: enough to bootstrap
// an unseeded area without timing out anywhere, including a dense city core.
const overpassSeedRadiusCapM = 2000.0

// seedFromOverpass queries OpenStreetMap for nightlife/dining venues near a
// location and upserts them into the places table.
func seedFromOverpass(lat, lng, radius float64) {
	if radius > overpassSeedRadiusCapM {
		radius = overpassSeedRadiusCapM
	}
	// nwr = node/way/relation so building-footprint venues (ways) are included.
	// out center returns a center point for ways/relations instead of no coords.
	query := fmt.Sprintf(
		`[out:json][timeout:15];nwr[amenity~"^(bar|pub|nightclub|restaurant|cafe|fast_food|food_court|biergarten)$"](around:%.0f,%.6f,%.6f);out center;`,
		radius, lat, lng,
	)
	resp, err := overpassClient.Get("https://overpass-api.de/api/interpreter?data=" + url.QueryEscape(query))
	if err != nil {
		log.Printf("overpass: fetch error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		log.Printf("overpass: non-200 status %d near (%.4f, %.4f): %s", resp.StatusCode, lat, lng, body)
		return
	}

	var result overpassResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("overpass: decode error: %v", err)
		return
	}
	// A city core can return tens of thousands of nodes; cap how many we walk
	// so a single request can't turn into thousands of sequential inserts.
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
