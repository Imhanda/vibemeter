package handlers

import (
	"net/http"
	"strconv"
	"vibemeter/cache"
	"vibemeter/config"
	"vibemeter/db"
	"vibemeter/middleware"
	"vibemeter/models"

	"github.com/gin-gonic/gin"
)

var validReportReasons = map[string]bool{
	"wrong":  true, // score doesn't match reality
	"closed": true, // venue is permanently closed
	"spam":   true, // fake / manipulated check-ins
	"unsafe": true, // safety concern
}

type createReportRequest struct {
	Reason string  `json:"reason" binding:"required"`
	VibeID *string `json:"vibe_id"`
	Detail string  `json:"detail"`
}

// CreateVenueReport handles POST /v1/venues/:id/reports
func CreateVenueReport(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)
	placeID := c.Param("id")

	var req createReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reason is required"})
		return
	}
	if !validReportReasons[req.Reason] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reason must be one of: wrong, closed, spam, unsafe"})
		return
	}
	if len(req.Detail) > 500 {
		req.Detail = req.Detail[:500]
	}

	var exists bool
	if err := db.DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM places WHERE id=$1)`, placeID).Scan(&exists); err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "venue not found"})
		return
	}

	ctx := c.Request.Context()
	if n, err := cache.GetReportLimit(ctx, userID); err == nil && n >= int64(config.C.ReportRateMax) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "daily report limit reached — try again tomorrow"})
		return
	}

	// Ensure the user row exists so the FK holds for brand-new accounts.
	_, _ = db.DB.Exec(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, userID)

	var id string
	err := db.DB.QueryRow(`
		INSERT INTO venue_reports (place_id, reporter_id, vibe_id, reason, detail)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''))
		RETURNING id`,
		placeID, userID, req.VibeID, req.Reason, req.Detail,
	).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save report"})
		return
	}
	_, _ = cache.IncrReportLimit(ctx, userID)

	c.JSON(http.StatusCreated, gin.H{
		"status":           "received",
		"report_id":        id,
		"review_sla_hours": 24,
	})
}

// ListReports handles GET /v1/admin/reports?status=open&limit=50
func ListReports(c *gin.Context) {
	status := c.DefaultQuery("status", "open")
	limit := 50
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}

	const cols = `SELECT id, place_id, reporter_id, vibe_id, reason,
	                     COALESCE(detail,'')      AS detail,
	                     status, created_at, resolved_at,
	                     COALESCE(resolved_by,'') AS resolved_by
	              FROM venue_reports`

	var reports []models.VenueReport
	var err error
	if status == "all" {
		err = db.DB.Select(&reports, cols+` ORDER BY created_at DESC LIMIT $1`, limit)
	} else {
		err = db.DB.Select(&reports, cols+` WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, status, limit)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if reports == nil {
		reports = []models.VenueReport{}
	}
	c.JSON(http.StatusOK, reports)
}

// ResolveReport handles POST /v1/admin/reports/:id/resolve
// Body: { "status": "reviewing" | "actioned" | "dismissed" }
func ResolveReport(c *gin.Context) {
	adminID := c.GetString(middleware.UserIDKey)
	id := c.Param("id")

	var body struct {
		Status string `json:"status"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Status != "reviewing" && body.Status != "actioned" && body.Status != "dismissed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be reviewing, actioned or dismissed"})
		return
	}

	res, err := db.DB.Exec(`
		UPDATE venue_reports
		SET status      = $1,
		    resolved_at = CASE WHEN $1 IN ('actioned','dismissed') THEN NOW() ELSE resolved_at END,
		    resolved_by = $2
		WHERE id = $3`,
		body.Status, adminID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": body.Status})
}
