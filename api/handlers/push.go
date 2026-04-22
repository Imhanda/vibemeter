package handlers

import (
	"net/http"
	"strings"
	"vibemeter/db"
	"vibemeter/middleware"

	"github.com/gin-gonic/gin"
)

type registerTokenRequest struct {
	Token string `json:"token" binding:"required"`
}

// RegisterPushToken stores an Expo push token for the authenticated user.
// POST /v1/user/push-token
func RegisterPushToken(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)

	var req registerTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token required"})
		return
	}

	// Validate it looks like an Expo push token
	if !strings.HasPrefix(req.Token, "ExponentPushToken[") &&
		!strings.HasPrefix(req.Token, "ExpoPushToken[") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Expo push token format"})
		return
	}

	_, err := db.DB.Exec(
		`INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)
		 ON CONFLICT (user_id, token) DO NOTHING`,
		userID, req.Token,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "registered"})
}
