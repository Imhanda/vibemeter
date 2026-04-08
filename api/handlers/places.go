package handlers

import (
	"net/http"
	"strconv"
	"vibemeter/cache"
	"vibemeter/db"
	"vibemeter/models"

	"github.com/gin-gonic/gin"
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
			if v > 2000 {
				v = 2000
			}
			radius = v
		}
	}
	limit := 50
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

	var rows []models.NearbyResult
	if venueType != "" {
		const q = `
			SELECT id, name, COALESCE(type,'') AS type, lat, lng,
			       COALESCE(photo_url,'') AS photo_url,
			       ST_Distance(
			           location::geography,
			           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
			       ) AS distance_m
			FROM places
			WHERE ST_DWithin(
			          location::geography,
			          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
			          $3
			      )
			  AND type = $4
			ORDER BY distance_m
			LIMIT $5`
		if err := db.DB.Select(&rows, q, lat, lng, radius, venueType, limit); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
	} else {
		const q = `
			SELECT id, name, COALESCE(type,'') AS type, lat, lng,
			       COALESCE(photo_url,'') AS photo_url,
			       ST_Distance(
			           location::geography,
			           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
			       ) AS distance_m
			FROM places
			WHERE ST_DWithin(
			          location::geography,
			          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
			          $3
			      )
			ORDER BY distance_m
			LIMIT $4`
		if err := db.DB.Select(&rows, q, lat, lng, radius, limit); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
	}

	result := make([]nearbyPlaceResponse, 0, len(rows))
	for _, row := range rows {
		resp := nearbyPlaceResponse{
			PlaceID:   row.ID,
			Name:      row.Name,
			Type:      row.Type,
			DistanceM: row.DistanceM,
			PhotoURL:  row.PhotoURL,
		}

		if vs, err := cache.GetVenueScore(c.Request.Context(), row.ID); err == nil && vs != nil {
			score := vs.VibeScore
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
