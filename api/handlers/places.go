package handlers

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"vibemeter/cache"
	"vibemeter/db"
	"vibemeter/models"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

type nearbyPlaceResponse struct {
	PlaceID      string   `json:"place_id"`
	Name         string   `json:"name"`
	Type         string   `json:"type"`
	DistanceM    float64  `json:"distance_m"`
	VibeScore    *float64 `json:"vibe_score"`
	Confidence   *float64 `json:"confidence"`
	CheckInCount int      `json:"check_in_count"`
	LastUpdated  string   `json:"last_updated,omitempty"`
	PhotoURL     string   `json:"photo_url,omitempty"`
	ActiveTags   []string `json:"active_tags"`
}

// GetNearbyPlaces handles GET /v1/places/nearby
func GetNearbyPlaces(c *gin.Context) {
	lat, err := strconv.ParseFloat(c.Query("lat"), 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lat required"})
		return
	}
	lng, err := strconv.ParseFloat(c.Query("lng"), 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lng required"})
		return
	}

	radius := 500.0
	if r := c.Query("radius"); r != "" {
		if v, err2 := strconv.ParseFloat(r, 64); err2 == nil && v > 0 {
			if v > 50000 {
				v = 50000
			}
			radius = v
		}
	}
	limit := 100
	if l := c.Query("limit"); l != "" {
		if v, err2 := strconv.Atoi(l); err2 == nil && v > 0 {
			if v > 200 {
				v = 200
			}
			limit = v
		}
	}
	venueType := c.Query("type")
	minScore := 0.0
	if ms := c.Query("min_score"); ms != "" {
		if v, err2 := strconv.ParseFloat(ms, 64); err2 == nil {
			minScore = v
		}
	}

	// Parse comma-separated tags filter: ?tags=dj,live_band
	var tagFilter pq.StringArray
	if raw := c.Query("tags"); raw != "" {
		for _, t := range strings.Split(raw, ",") {
			if t = strings.TrimSpace(t); t != "" {
				tagFilter = append(tagFilter, t)
			}
		}
	}
	if tagFilter == nil {
		tagFilter = pq.StringArray{}
	}

	const q = `
		SELECT p.id, p.name, COALESCE(p.type,'') AS type, p.lat, p.lng,
		       COALESCE(p.photo_url,'') AS photo_url,
		       ST_Distance(
		           p.location::geography,
		           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
		       ) AS distance_m,
		       COALESCE(
		         ARRAY(
		           SELECT DISTINCT t
		           FROM vibe_contributions vc2, unnest(vc2.tags) AS t
		           WHERE vc2.place_id = p.id
		             AND vc2.created_at > NOW() - INTERVAL '3 hours'
		             AND NOT vc2.flagged
		         ),
		         '{}'::text[]
		       ) AS active_tags
		FROM places p
		WHERE ST_DWithin(
		          p.location::geography,
		          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
		          $3
		      )
		  AND ($4 = '' OR p.type = $4)
		  AND (cardinality($5::text[]) = 0 OR EXISTS (
		        SELECT 1 FROM vibe_contributions vc
		        WHERE vc.place_id = p.id
		          AND vc.tags && $5::text[]
		          AND vc.created_at > NOW() - INTERVAL '7 days'
		          AND NOT vc.flagged
		      ))
		ORDER BY distance_m
		LIMIT $6`

	var rows []models.NearbyResult
	if err := db.DB.Select(&rows, q, lat, lng, radius, venueType, tagFilter, limit); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	// Re-seed from OpenStreetMap when the area looks thin or data is stale.
	// Check unfiltered totals so type/tag filters don't cause repeated Overpass calls.
	var totalInArea int
	_ = db.DB.Get(&totalInArea,
		`SELECT COUNT(*) FROM places
		 WHERE ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)`,
		lat, lng, radius)
	var lastSync time.Time
	_ = db.DB.Get(&lastSync,
		`SELECT COALESCE(MAX(places_synced_at), '2000-01-01') FROM places
		 WHERE ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)`,
		lat, lng, radius)
	if totalInArea < 20 || time.Since(lastSync) > 24*time.Hour {
		seedFromOverpass(lat, lng, radius)
		if err := db.DB.Select(&rows, q, lat, lng, radius, venueType, tagFilter, limit); err != nil {
			log.Printf("places: re-query after overpass seed: %v", err)
		}
	}

	result := make([]nearbyPlaceResponse, 0, len(rows))
	for _, row := range rows {
		activeTags := []string(row.ActiveTags)
		if activeTags == nil {
			activeTags = []string{}
		}
		resp := nearbyPlaceResponse{
			PlaceID:    row.ID,
			Name:       row.Name,
			Type:       row.Type,
			DistanceM:  row.DistanceM,
			PhotoURL:   row.PhotoURL,
			ActiveTags: activeTags,
		}

		if vs, err := cache.GetVenueScore(c.Request.Context(), row.ID); err == nil && vs != nil {
			score := vs.Score
			conf := vs.Confidence
			if score >= minScore {
				resp.VibeScore = &score
				resp.Confidence = &conf
				resp.CheckInCount = vs.CheckInCount
				resp.LastUpdated = vs.LastUpdated.Format("2006-01-02T15:04:05Z")
			} else if minScore > 0 {
				continue // skip venues below min_score
			}
		} else if minScore > 0 {
			continue // no score data, skip if filter active
		}

		result = append(result, resp)
	}

	c.JSON(http.StatusOK, result)
}
