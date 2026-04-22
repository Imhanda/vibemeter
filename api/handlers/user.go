package handlers

import (
	"net/http"
	"vibemeter/cache"
	"vibemeter/db"
	"vibemeter/middleware"
	"vibemeter/models"

	"github.com/gin-gonic/gin"
)

// GetUserProfile handles GET /v1/user/profile
func GetUserProfile(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)

	var user models.User
	if err := db.DB.Get(&user, `
		SELECT id, COALESCE(display_name,'') AS display_name,
		       COALESCE(photo_url,'') AS photo_url,
		       trust_score, check_in_count, streak_days,
		       last_checkin, created_at
		FROM users WHERE id = $1`, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var badges []models.Badge
	if err := db.DB.Select(&badges, `
		SELECT id, user_id, badge_type, place_id, earned_at
		FROM badges WHERE user_id = $1
		ORDER BY earned_at DESC`, userID); err != nil {
		badges = []models.Badge{}
	}

	badgeTypes := make([]string, len(badges))
	for i, b := range badges {
		badgeTypes[i] = b.BadgeType
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":      user.ID,
		"display_name": user.DisplayName,
		"photo_url":    user.PhotoURL,
		"check_ins":    user.CheckInCount,
		"streak_days":  user.StreakDays,
		"badges":       badgeTypes,
	})
}

// FollowVenue handles POST /v1/user/follow/:place_id
func FollowVenue(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)
	placeID := c.Param("place_id")

	var body struct {
		Threshold int `json:"threshold"`
	}
	body.Threshold = 70 // default
	_ = c.ShouldBindJSON(&body)

	if body.Threshold < 0 || body.Threshold > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "threshold must be 0–100"})
		return
	}

	// Ensure the venue exists
	var exists bool
	if err := db.DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM places WHERE id=$1)`, placeID).Scan(&exists); err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "venue not found"})
		return
	}

	// Ensure user exists (upsert)
	_, _ = db.DB.Exec(`
		INSERT INTO users (id) VALUES ($1)
		ON CONFLICT (id) DO NOTHING`, userID)

	_, err := db.DB.Exec(`
		INSERT INTO notification_subscriptions (user_id, place_id, threshold)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, place_id)
		DO UPDATE SET threshold = EXCLUDED.threshold`,
		userID, placeID, body.Threshold)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save subscription"})
		return
	}

	// Mirror into Redis for fast lookup during push notification dispatch
	_ = cache.AddVenueSubscriber(c.Request.Context(), placeID, userID, body.Threshold)

	c.JSON(http.StatusOK, gin.H{"status": "following", "threshold": body.Threshold})
}

// UnfollowVenue handles DELETE /v1/user/follow/:place_id
func UnfollowVenue(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)
	placeID := c.Param("place_id")

	_, _ = db.DB.Exec(
		`DELETE FROM notification_subscriptions WHERE user_id=$1 AND place_id=$2`,
		userID, placeID)

	_ = cache.RemoveVenueSubscriber(c.Request.Context(), placeID, userID)

	c.JSON(http.StatusOK, gin.H{"status": "unfollowed"})
}

// GetFollowStatus handles GET /v1/user/follow/:place_id
func GetFollowStatus(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)
	placeID := c.Param("place_id")

	// Check Redis first
	following, err := cache.IsVenueSubscriber(c.Request.Context(), placeID, userID)
	if err != nil {
		// Fall back to DB
		var threshold int
		err2 := db.DB.QueryRow(
			`SELECT threshold FROM notification_subscriptions WHERE user_id=$1 AND place_id=$2`,
			userID, placeID).Scan(&threshold)
		if err2 != nil {
			c.JSON(http.StatusOK, gin.H{"following": false})
			return
		}
		c.JSON(http.StatusOK, gin.H{"following": true, "threshold": threshold})
		return
	}

	if !following {
		c.JSON(http.StatusOK, gin.H{"following": false})
		return
	}

	// Get threshold from DB for accuracy
	var threshold int
	_ = db.DB.QueryRow(
		`SELECT threshold FROM notification_subscriptions WHERE user_id=$1 AND place_id=$2`,
		userID, placeID).Scan(&threshold)

	c.JSON(http.StatusOK, gin.H{"following": true, "threshold": threshold})
}
