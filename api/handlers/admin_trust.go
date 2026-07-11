package handlers

import (
	"net/http"
	"vibemeter/cache"
	"vibemeter/db"
	"vibemeter/trust"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

type trustEventResponse struct {
	ID             string   `db:"id"              json:"id"`
	UserID         string   `db:"user_id"         json:"user_id"`
	ContributionID *string  `db:"contribution_id" json:"contribution_id,omitempty"`
	PlaceID        *string  `db:"place_id"        json:"place_id,omitempty"`
	RuleHits       []string `db:"rule_hits"       json:"rule_hits"`
	Verdict        string   `db:"verdict"         json:"verdict"`
	Delta          float64  `db:"delta"           json:"delta"`
	OldScore       float64  `db:"old_score"       json:"old_score"`
	NewScore       float64  `db:"new_score"       json:"new_score"`
	Enforced       bool     `db:"enforced"        json:"enforced"`
	CreatedAt      string   `db:"created_at"       json:"created_at"`
}

// GetTrustEvents handles GET /v1/admin/trust/events?user_id=&verdict=&limit=
func GetTrustEvents(c *gin.Context) {
	userID := c.Query("user_id")
	verdict := c.Query("verdict")
	limit := queryInt(c, "limit", 50)
	if limit > 200 {
		limit = 200
	}

	type row struct {
		ID             string         `db:"id"`
		UserID         string         `db:"user_id"`
		ContributionID *string        `db:"contribution_id"`
		PlaceID        *string        `db:"place_id"`
		RuleHits       pq.StringArray `db:"rule_hits"`
		Verdict        string         `db:"verdict"`
		Delta          float64        `db:"delta"`
		OldScore       float64        `db:"old_score"`
		NewScore       float64        `db:"new_score"`
		Enforced       bool           `db:"enforced"`
		CreatedAt      string         `db:"created_at"`
	}

	var rows []row
	err := db.DB.Select(&rows, `
		SELECT id, user_id, contribution_id::text, place_id, rule_hits, verdict,
		       delta, old_score, new_score, enforced, created_at::text
		FROM trust_events
		WHERE ($1 = '' OR user_id = $1)
		  AND ($2 = '' OR verdict = $2)
		ORDER BY created_at DESC
		LIMIT $3`,
		userID, verdict, limit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load trust events"})
		return
	}

	out := make([]trustEventResponse, 0, len(rows))
	for _, r := range rows {
		out = append(out, trustEventResponse{
			ID: r.ID, UserID: r.UserID, ContributionID: r.ContributionID, PlaceID: r.PlaceID,
			RuleHits: []string(r.RuleHits), Verdict: r.Verdict, Delta: r.Delta,
			OldScore: r.OldScore, NewScore: r.NewScore, Enforced: r.Enforced, CreatedAt: r.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, out)
}

type overrideTrustRequest struct {
	NewScore float64 `json:"new_score" binding:"required"`
}

// OverrideTrustScore handles POST /v1/admin/trust/users/:user_id/override
func OverrideTrustScore(c *gin.Context) {
	userID := c.Param("user_id")

	var req overrideTrustRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.NewScore < 0.1 || req.NewScore > 1.0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new_score must be between 0.1 and 1.0"})
		return
	}

	ctx := c.Request.Context()

	oldScore, err := trust.FetchTrustScore(ctx, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if _, err := db.DB.ExecContext(ctx,
		`UPDATE users SET trust_score = $1 WHERE id = $2`, req.NewScore, userID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update trust score"})
		return
	}
	if err := cache.SetTrustScore(ctx, userID, req.NewScore); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update trust cache"})
		return
	}

	_ = trust.InsertTrustEvent(ctx, trust.Event{
		UserID:   userID,
		RuleHits: []trust.RuleHit{"manual"},
		Verdict:  trust.VerdictManualOverride,
		Delta:    req.NewScore - oldScore,
		OldScore: oldScore,
		NewScore: req.NewScore,
		Enforced: true,
	})

	c.JSON(http.StatusOK, gin.H{"status": "ok", "old_score": oldScore, "new_score": req.NewScore})
}
