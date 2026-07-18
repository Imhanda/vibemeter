package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"vibemeter/cache"
	"vibemeter/config"
	"vibemeter/db"
	"vibemeter/models"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/gin-gonic/gin"
)

type searchRequest struct {
	Query  string  `json:"query" binding:"required"`
	Lat    float64 `json:"lat"   binding:"required"`
	Lng    float64 `json:"lng"   binding:"required"`
	Radius float64 `json:"radius"`
}

// extracted filters from Claude
type searchFilters struct {
	Type     string   `json:"type"`      // bar|pub|club|restaurant|""
	MinScore float64  `json:"min_score"` // 0 = no filter
	Keywords []string `json:"keywords"`  // e.g. ["music","rooftop","quiet"]
}

// SearchPlaces handles POST /v1/places/search
// Accepts a natural-language query, uses Claude to extract filters,
// then runs a PostGIS nearby query and ranks results.
func SearchPlaces(c *gin.Context) {
	var req searchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query, lat and lng are required"})
		return
	}
	if req.Radius <= 0 || req.Radius > 3000 {
		req.Radius = 1500
	}

	filters := extractFilters(c.Request.Context(), req.Query)

	// Query DB
	var rows []models.NearbyResult
	if filters.Type != "" {
		const q = `
			SELECT id, name, COALESCE(type,'') AS type, lat, lng,
			       COALESCE(photo_url,'') AS photo_url, google_rating,
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
			ORDER BY distance_m LIMIT 100`
		db.DB.Select(&rows, q, req.Lat, req.Lng, req.Radius, filters.Type)
	} else {
		const q = `
			SELECT id, name, COALESCE(type,'') AS type, lat, lng,
			       COALESCE(photo_url,'') AS photo_url, google_rating,
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
			ORDER BY distance_m LIMIT 100`
		db.DB.Select(&rows, q, req.Lat, req.Lng, req.Radius)
	}

	// Enrich with Redis scores and apply min_score filter
	type scoredResult struct {
		resp      nearbyPlaceResponse
		vibeScore float64
		relevance float64 // keyword match boost
	}

	var results []scoredResult
	for _, row := range rows {
		resp := nearbyPlaceResponse{
			PlaceID:   row.ID,
			Name:      row.Name,
			Type:      row.Type,
			DistanceM: row.DistanceM,
			PhotoURL:  row.PhotoURL,
		}

		vibeScore := 0.0
		if vs, err := cache.GetVenueScoreOrFallback(c.Request.Context(), row.ID, row.GoogleRating); err == nil && vs != nil {
			if vs.Score < filters.MinScore {
				continue
			}
			vibeScore = vs.Score
			resp.VibeScore = &vs.Score
			resp.Confidence = &vs.Confidence
			resp.CheckInCount = vs.CheckInCount
			resp.ScoreSource = vs.Source
			resp.LastUpdated = vs.LastUpdated.Format("2006-01-02T15:04:05Z")
		} else if filters.MinScore > 0 {
			continue
		}

		// Keyword relevance boost — simple name/type contains check
		relevance := 1.0
		nameLower := strings.ToLower(row.Name + " " + row.Type)
		for _, kw := range filters.Keywords {
			if strings.Contains(nameLower, strings.ToLower(kw)) {
				relevance += 0.3
			}
		}

		results = append(results, scoredResult{resp, vibeScore, relevance})
	}

	// Sort: venues with scores ranked by (vibe_score * relevance), unscored by relevance then distance
	for i := 1; i < len(results); i++ {
		for j := i; j > 0; j-- {
			a, b := results[j-1], results[j]
			scoreA := a.vibeScore * a.relevance
			scoreB := b.vibeScore * b.relevance
			if scoreB > scoreA {
				results[j-1], results[j] = results[j], results[j-1]
			} else {
				break
			}
		}
	}

	out := make([]nearbyPlaceResponse, 0, len(results))
	for _, r := range results {
		out = append(out, r.resp)
	}
	c.JSON(http.StatusOK, out)
}

// extractFilters calls Claude to parse the natural-language query into structured filters.
// Falls back to empty filters (no-op) on any error so the search still returns results.
func extractFilters(ctx context.Context, query string) searchFilters {
	if config.C.AnthropicAPIKey == "" {
		return searchFilters{}
	}

	prompt := fmt.Sprintf(`Extract search filters from this nightlife venue query.
Query: "%s"

Reply with ONLY a JSON object, no markdown, no explanation:
{
  "type": "<bar|pub|club|restaurant or empty string if unspecified>",
  "min_score": <0-100, 0 if not specified>,
  "keywords": ["<relevant words from the query that could match venue names or types>"]
}`, query)

	client := anthropic.NewClient()
	msg, err := client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 80,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	})
	if err != nil || len(msg.Content) == 0 {
		return searchFilters{}
	}

	raw := strings.TrimSpace(msg.Content[0].Text)
	// Strip markdown fences if Claude adds them despite instructions
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")

	var filters searchFilters
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &filters); err != nil {
		return searchFilters{}
	}
	return filters
}
