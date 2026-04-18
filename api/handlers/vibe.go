package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
	"vibemeter/cache"
	"vibemeter/config"
	"vibemeter/db"
	"vibemeter/middleware"
	"vibemeter/models"
	"vibemeter/scoring"

	"github.com/gin-gonic/gin"
)

type submitVibeResponse struct {
	Status      string  `json:"status"`
	VibeScore   float64 `json:"venue_score"`
	Confidence  float64 `json:"confidence"`
	BadgeEarned *string `json:"badge_earned"`
}

type venueDetailResponse struct {
	PlaceID         string                    `json:"place_id"`
	Name            string                    `json:"name"`
	VibeScore       *float64                  `json:"vibe_score"`
	Confidence      *float64                  `json:"confidence"`
	CheckInCount    int                       `json:"check_in_count"`
	SignalBreakdown *models.SignalBreakdown    `json:"signal_breakdown,omitempty"`
	History         []models.VibeHistoryEntry `json:"history"`
}

// SubmitVibe handles POST /v1/vibe
func SubmitVibe(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)

	var req models.SubmitVibeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate: need audio signals OR manual rating
	if req.CrowdEnergy == nil && req.MusicEnergy == nil && req.AmbientDB == nil && req.ManualRating == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide audio signals or manual_rating"})
		return
	}
	if req.ManualRating != nil && (*req.ManualRating < 1 || *req.ManualRating > 5) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "manual_rating must be 1–5"})
		return
	}

	ctx := c.Request.Context()

	// --- Rate limit check ---
	count, err := cache.GetRateLimit(ctx, userID, req.PlaceID)
	if err == nil && count >= int64(config.C.RateLimitMax) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded — try again later"})
		return
	}

	// --- Fetch venue for geo-fence ---
	var place models.Place
	if err := db.DB.Get(&place, `SELECT id, name, lat, lng FROM places WHERE id = $1`, req.PlaceID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "venue not found"})
		return
	}

	// --- Geo-fence check ---
	distM := scoring.Haversine(req.ClientLat, req.ClientLng, place.Lat, place.Lng)
	if distM > config.C.GeoFenceRadiusM {
		c.JSON(http.StatusForbidden, gin.H{"error": "you must be at the venue to check in"})
		return
	}

	// --- Compute raw score ---
	rawScore := scoring.ComputeRawScore(&req)

	// --- Trust weight from Redis ---
	trustWeight, err := cache.GetTrustScore(ctx, userID)
	if err != nil {
		trustWeight = 0.7
	}

	// --- Fetch recent contributions to detect outlier ---
	var recent []models.VibeContribution
	windowStart := time.Now().Add(-time.Duration(config.C.ScoreWindowMinutes) * time.Minute)
	_ = db.DB.Select(&recent, `
		SELECT id, place_id, user_id, crowd_energy, music_energy, ambient_db,
		       raw_score, is_manual, trust_weight, flagged, created_at
		FROM vibe_contributions
		WHERE place_id = $1 AND created_at > $2 AND flagged = false
		ORDER BY created_at DESC`,
		req.PlaceID, windowStart)

	isOutlier := scoring.IsOutlier(rawScore, recent)
	isManual := req.ManualRating != nil && req.CrowdEnergy == nil

	// --- Upsert user before inserting contribution (FK constraint) ---
	_, _ = db.DB.Exec(`
		INSERT INTO users (id, check_in_count, last_checkin, trust_score)
		VALUES ($1, 1, NOW(), 0.7)
		ON CONFLICT (id) DO UPDATE
		SET check_in_count = users.check_in_count + 1,
		    last_checkin   = NOW()`,
		userID)

	crowd, music, ambient := 0.0, 0.0, 0.0
	if req.CrowdEnergy != nil {
		crowd = *req.CrowdEnergy
	}
	if req.MusicEnergy != nil {
		music = *req.MusicEnergy
	}
	if req.AmbientDB != nil {
		ambient = *req.AmbientDB
	}

	// --- Insert contribution ---
	var contribID string
	err = db.DB.QueryRowx(`
		INSERT INTO vibe_contributions
		    (place_id, user_id, crowd_energy, music_energy, ambient_db,
		     raw_score, is_manual, trust_weight, flagged)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id`,
		req.PlaceID, userID, crowd, music, ambient,
		rawScore, isManual, trustWeight, isOutlier,
	).Scan(&contribID)
	if err != nil {
		log.Println("insert contribution error:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save check-in"})
		return
	}

	// Increment rate limit counter
	if _, err := cache.IncrRateLimit(ctx, userID, req.PlaceID); err != nil {
		log.Println("rate limit incr error:", err)
	}

	// --- Re-fetch all window contributions (including the new one) for aggregation ---
	var allRecent []models.VibeContribution
	_ = db.DB.Select(&allRecent, `
		SELECT id, place_id, user_id, crowd_energy, music_energy, ambient_db,
		       raw_score, is_manual, trust_weight, flagged, created_at
		FROM vibe_contributions
		WHERE place_id = $1 AND created_at > $2
		ORDER BY created_at DESC`,
		req.PlaceID, windowStart)

	venueScore, confidence := scoring.AggregateWithDecay(allRecent, time.Now())

	// --- Update Redis ---
	// crowd, music, ambient already populated from the scoring block above
	vs := cache.VenueScore{
		Score:        venueScore,
		Confidence:   confidence,
		CheckInCount: len(allRecent),
		LastUpdated:  time.Now(),
		CrowdEnergy:  crowd,
		MusicEnergy:  music,
		AmbientDB:    ambient,
	}
	if err := cache.SetVenueScore(ctx, req.PlaceID, vs); err != nil {
		log.Println("redis set error:", err)
	}

	// --- WebSocket broadcast ---
	wsPayload, _ := json.Marshal(map[string]interface{}{
		"type":           "score_update",
		"place_id":       req.PlaceID,
		"vibe_score":     venueScore,
		"confidence":     confidence,
		"check_in_count": len(allRecent),
		"ts":             time.Now().UTC().Format(time.RFC3339),
	})
	if err := cache.PublishScoreUpdate(ctx, req.PlaceID, wsPayload); err != nil {
		log.Println("ws publish error:", err)
	}

	// --- Badge check: first check-in at this venue ---
	var badgeEarned *string
	var existingCount int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM vibe_contributions WHERE user_id=$1 AND place_id=$2`, userID, req.PlaceID).Scan(&existingCount)
	if existingCount == 1 {
		badgeName := "first_vibecheck"
		_, err := db.DB.Exec(`
			INSERT INTO badges (user_id, badge_type, place_id)
			VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING`,
			userID, badgeName, req.PlaceID)
		if err == nil {
			badgeEarned = &badgeName
		}
	}

	c.JSON(http.StatusOK, submitVibeResponse{
		Status:      "accepted",
		VibeScore:   venueScore,
		Confidence:  confidence,
		BadgeEarned: badgeEarned,
	})
}

// GetVenueVibe handles GET /v1/vibe/:place_id
func GetVenueVibe(c *gin.Context) {
	placeID := c.Param("place_id")

	var place models.Place
	if err := db.DB.Get(&place, `
		SELECT id, name, lat, lng, COALESCE(type,'') AS type,
		       COALESCE(address,'') AS address,
		       COALESCE(photo_url,'') AS photo_url, created_at
		FROM places WHERE id = $1`, placeID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "venue not found"})
		return
	}

	ctx := c.Request.Context()

	// Current score from Redis
	vs, _ := cache.GetVenueScore(ctx, placeID)

	resp := venueDetailResponse{
		PlaceID: place.ID,
		Name:    place.Name,
		History: []models.VibeHistoryEntry{},
	}

	if vs != nil {
		score := vs.Score
		conf := vs.Confidence
		resp.VibeScore = &score
		resp.Confidence = &conf
		resp.CheckInCount = vs.CheckInCount
	}

	// Hourly history — last 24 hours
	type histRow struct {
		Hour  time.Time `db:"hour"`
		Score float64   `db:"score"`
		Count int       `db:"count"`
	}
	var histRows []histRow
	_ = db.DB.Select(&histRows, `
		SELECT date_trunc('hour', created_at) AS hour,
		       AVG(raw_score)                 AS score,
		       COUNT(*)                        AS count
		FROM vibe_contributions
		WHERE place_id = $1
		  AND created_at > NOW() - INTERVAL '24 hours'
		GROUP BY hour
		ORDER BY hour DESC`, placeID)

	for _, h := range histRows {
		resp.History = append(resp.History, models.VibeHistoryEntry{
			Hour:  h.Hour.Format("15:04"),
			Score: h.Score,
			Count: h.Count,
		})
	}

	// Signal breakdown from the most recent unflagged contribution
	var latest models.VibeContribution
	if err := db.DB.Get(&latest, `
		SELECT crowd_energy, music_energy, ambient_db
		FROM vibe_contributions
		WHERE place_id = $1 AND flagged = false
		ORDER BY created_at DESC LIMIT 1`, placeID); err == nil {
		resp.SignalBreakdown = &models.SignalBreakdown{
			CrowdEnergy: latest.CrowdEnergy,
			MusicEnergy: latest.MusicEnergy,
			AmbientDB:   latest.AmbientDB,
		}
	}

	c.JSON(http.StatusOK, resp)
}
