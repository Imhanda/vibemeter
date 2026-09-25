package handlers

import (
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
	ScoreSource  string   `json:"score_source,omitempty"`
	CheckInCount int      `json:"check_in_count"`
	LastUpdated  string   `json:"last_updated,omitempty"`
	PhotoURL     string   `json:"photo_url,omitempty"`
	ActiveTags   []string `json:"active_tags"`
	// IsMatch is only ever set by SearchPlaces (a direct name match on the
	// query) — always omitted/false from GetNearbyPlaces, which has no
	// concept of a "match". Lets the client section search results into
	// "the match" vs. the rest of the nearby list, instead of blending
	// both into one undifferentiated list.
	IsMatch bool `json:"is_match,omitempty"`
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
	// window=last_night returns each venue's peak score from the previous
	// evening instead of its live score — powers the daytime "Last night" tab
	// when nothing is going on right now.
	lastNight := c.Query("window") == "last_night"
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
		       COALESCE(p.photo_url,'') AS photo_url, p.google_rating,
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
	// This runs in the background, NOT on this request's critical path: Overpass
	// (any public mirror) is a third-party dependency with response times
	// ranging from ~2s to 20s+ or outright blocked, and the mobile client has
	// its own hard 15s request timeout — waiting on it here means the nearby
	// list either hangs past that timeout or comes back emptier than reality
	// just because Overpass was briefly slow. A cold area may show "nothing
	// nearby" once; a pull-to-refresh (or the next request) picks up whatever
	// the background seed found.
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
		go seedFromOverpassOnce(lat, lng, radius)
	}

	// Peak scores from last night, keyed by place_id — only queried for the
	// "Last night" tab.
	var lastNightPeak map[string]float64
	if lastNight {
		lastNightPeak = map[string]float64{}
		type pkRow struct {
			PlaceID string  `db:"place_id"`
			Peak    float64 `db:"peak"`
		}
		var pk []pkRow
		_ = db.DB.Select(&pk, `
			SELECT place_id, MAX(hourly_avg) AS peak
			FROM (
				SELECT place_id,
				       date_trunc('hour', created_at) AS h,
				       AVG(raw_score)                 AS hourly_avg
				FROM vibe_contributions
				WHERE NOT flagged
				  AND created_at >= date_trunc('day', NOW()) - INTERVAL '6 hours'
				  AND created_at <  date_trunc('day', NOW()) + INTERVAL '6 hours'
				GROUP BY place_id, h
			) t
			GROUP BY place_id`)
		for _, r := range pk {
			lastNightPeak[r.PlaceID] = r.Peak
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

		if lastNight {
			if peak, ok := lastNightPeak[row.ID]; ok {
				p := peak
				resp.VibeScore = &p
				resp.ScoreSource = "last_night"
			}
			result = append(result, resp)
			continue
		}

		if vs, err := cache.GetVenueScoreOrFallback(c.Request.Context(), row.ID, row.GoogleRating); err == nil && vs != nil {
			score := vs.Score
			conf := vs.Confidence
			if score >= minScore {
				resp.VibeScore = &score
				resp.Confidence = &conf
				resp.CheckInCount = vs.CheckInCount
				resp.ScoreSource = vs.Source
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
