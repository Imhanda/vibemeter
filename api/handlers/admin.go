package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"vibemeter/config"
	"vibemeter/db"

	"github.com/gin-gonic/gin"
)

// ── Google Places Nearby Search response structs ──────────────────────────────

type placesAPIResponse struct {
	Results       []placesAPIResult `json:"results"`
	NextPageToken string            `json:"next_page_token"`
	Status        string            `json:"status"`
}

type placesAPIResult struct {
	PlaceID  string `json:"place_id"`
	Name     string `json:"name"`
	Geometry struct {
		Location struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		} `json:"location"`
	} `json:"geometry"`
	Types            []string `json:"types"`
	Vicinity         string   `json:"vicinity"`
	Rating           float64  `json:"rating"` // 0 if Google omits it (no ratings yet)
	UserRatingsTotal int      `json:"user_ratings_total"`
	Photos           []struct {
		PhotoReference string `json:"photo_reference"`
	} `json:"photos"`
}

// venueTypeFromGoogleTypes maps Google Places types to VibeMeter venue types.
func venueTypeFromGoogleTypes(types []string) string {
	for _, t := range types {
		switch t {
		case "night_club":
			return "club"
		case "bar":
			return "bar"
		case "restaurant":
			return "restaurant"
		}
	}
	// "pub" doesn't have a dedicated Google type — check name heuristics upstream
	return "bar"
}

// photoURL builds a Places photo URL from a photo reference.
func photoURL(ref, apiKey string) string {
	if ref == "" || apiKey == "" {
		return ""
	}
	return fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=%s&key=%s",
		url.QueryEscape(ref), apiKey,
	)
}

// fetchNearbyPage calls the Google Places Nearby Search API for one page of results.
func fetchNearbyPage(lat, lng float64, radius int, placeType, pageToken, apiKey string) (*placesAPIResponse, error) {
	base := "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
	params := url.Values{}
	params.Set("location", fmt.Sprintf("%f,%f", lat, lng))
	params.Set("radius", fmt.Sprintf("%d", radius))
	params.Set("key", apiKey)
	if placeType != "" {
		params.Set("type", placeType)
	}
	if pageToken != "" {
		params.Set("pagetoken", pageToken)
	}

	resp, err := http.Get(base + "?" + params.Encode())
	if err != nil {
		return nil, fmt.Errorf("places API request failed: %w", err)
	}
	defer resp.Body.Close()

	var result placesAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode places response: %w", err)
	}
	if result.Status != "OK" && result.Status != "ZERO_RESULTS" {
		return nil, fmt.Errorf("places API returned status: %s", result.Status)
	}
	return &result, nil
}

// upsertPlace inserts or updates a single place in the DB.
func upsertPlace(p placesAPIResult, vType, photo string) error {
	_, err := db.DB.Exec(`
		INSERT INTO places (id, name, lat, lng, location, type, address, photo_url,
		                     google_rating, google_rating_count, places_synced_at)
		VALUES ($1, $2, $3, $4,
		        ST_SetSRID(ST_MakePoint($4, $3), 4326),
		        $5, $6, $7, NULLIF($8, 0), $9, NOW())
		ON CONFLICT (id) DO UPDATE
		SET name                = EXCLUDED.name,
		    lat                 = EXCLUDED.lat,
		    lng                 = EXCLUDED.lng,
		    location            = EXCLUDED.location,
		    type                = EXCLUDED.type,
		    address             = EXCLUDED.address,
		    photo_url           = EXCLUDED.photo_url,
		    google_rating       = EXCLUDED.google_rating,
		    google_rating_count = EXCLUDED.google_rating_count,
		    places_synced_at    = NOW()`,
		p.PlaceID, p.Name,
		p.Geometry.Location.Lat, p.Geometry.Location.Lng,
		vType, p.Vicinity, photo, p.Rating, p.UserRatingsTotal,
	)
	return err
}

// SyncPlaces handles POST /v1/admin/places/sync
//
// Query params:
//
//	lat    float  — centre latitude  (default: 12.9716, Bengaluru)
//	lng    float  — centre longitude (default: 77.5946)
//	radius int    — search radius in metres (default: 1500, max: 50000)
//	type   string — Google place type: bar|night_club|restaurant (default: bar)
//	pages  int    — max result pages to fetch, 1 page ≈ 20 venues (default: 1, max: 3)
func SyncPlaces(c *gin.Context) {
	apiKey := config.C.GooglePlacesAPIKey
	if apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "GOOGLE_PLACES_API_KEY not configured"})
		return
	}

	lat := queryFloat(c, "lat", 12.9716)
	lng := queryFloat(c, "lng", 77.5946)
	radius := queryInt(c, "radius", 1500)
	if radius > 50000 {
		radius = 50000
	}
	placeType := c.DefaultQuery("type", "bar")
	maxPages := queryInt(c, "pages", 1)
	if maxPages > 3 {
		maxPages = 3
	}

	// Validate Google Places type
	validTypes := map[string]bool{"bar": true, "night_club": true, "restaurant": true, "cafe": true}
	if !validTypes[placeType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be bar|night_club|restaurant|cafe"})
		return
	}

	var (
		inserted, updated, failed int
		pageToken                 string
	)

	for page := 0; page < maxPages; page++ {
		resp, err := fetchNearbyPage(lat, lng, radius, placeType, pageToken, apiKey)
		if err != nil {
			log.Println("places sync error:", err)
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}

		for _, place := range resp.Results {
			vType := venueTypeFromGoogleTypes(place.Types)
			// Heuristic: if name contains pub/tavern keywords, override to pub
			nameLower := strings.ToLower(place.Name)
			if strings.Contains(nameLower, "pub") || strings.Contains(nameLower, "tavern") {
				vType = "pub"
			}

			photo := ""
			if len(place.Photos) > 0 {
				photo = photoURL(place.Photos[0].PhotoReference, apiKey)
			}

			// Check if it already exists to report inserted vs updated
			var existingCount int
			db.DB.QueryRow(`SELECT COUNT(*) FROM places WHERE id=$1`, place.PlaceID).Scan(&existingCount)

			if err := upsertPlace(place, vType, photo); err != nil {
				log.Printf("failed to upsert place %s (%s): %v\n", place.PlaceID, place.Name, err)
				failed++
				continue
			}
			if existingCount == 0 {
				inserted++
			} else {
				updated++
			}
		}

		pageToken = resp.NextPageToken
		if pageToken == "" {
			break
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "ok",
		"inserted": inserted,
		"updated":  updated,
		"failed":   failed,
		"total":    inserted + updated,
	})
}

// ── small helpers for query param parsing ─────────────────────────────────────

func queryFloat(c *gin.Context, key string, def float64) float64 {
	v := c.Query(key)
	if v == "" {
		return def
	}
	var f float64
	fmt.Sscanf(v, "%f", &f)
	return f
}

func queryInt(c *gin.Context, key string, def int) int {
	v := c.Query(key)
	if v == "" {
		return def
	}
	var i int
	fmt.Sscanf(v, "%d", &i)
	return i
}
