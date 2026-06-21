package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"
	"vibemeter/db"
)

type osmElement struct {
	Type string            `json:"type"`
	ID   int64             `json:"id"`
	Lat  float64           `json:"lat"`
	Lon  float64           `json:"lon"`
	Tags map[string]string `json:"tags"`
}

type overpassResp struct {
	Elements []osmElement `json:"elements"`
}

var overpassClient = &http.Client{Timeout: 15 * time.Second}

// seedFromOverpass queries OpenStreetMap for nightlife/dining venues near a
// location and upserts them into the places table. Called synchronously when
// the DB has fewer than 5 venues in the requested area.
func seedFromOverpass(lat, lng, radius float64) {
	query := fmt.Sprintf(
		`[out:json][timeout:10];node[amenity~"^(bar|pub|nightclub|restaurant|cafe)$"](around:%.0f,%.6f,%.6f);out;`,
		radius, lat, lng,
	)
	resp, err := overpassClient.Get("https://overpass-api.de/api/interpreter?data=" + url.QueryEscape(query))
	if err != nil {
		log.Printf("overpass: fetch error: %v", err)
		return
	}
	defer resp.Body.Close()

	var result overpassResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("overpass: decode error: %v", err)
		return
	}

	inserted := 0
	for _, el := range result.Elements {
		name := el.Tags["name"]
		if name == "" {
			continue
		}
		placeID := fmt.Sprintf("osm_%s_%d", el.Type, el.ID)
		_, err := db.DB.Exec(`
			INSERT INTO places (id, name, lat, lng, type, address, photo_url, location, places_synced_at)
			VALUES ($1, $2, $3, $4, $5, $6, '', ST_SetSRID(ST_MakePoint($4, $3), 4326), NOW())
			ON CONFLICT (id) DO UPDATE SET places_synced_at = NOW()
		`, placeID, name, el.Lat, el.Lon, osmTypeToVenue(el.Tags["amenity"]), el.Tags["addr:street"])
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
	case "restaurant", "cafe":
		return "restaurant"
	default:
		return "bar"
	}
}
