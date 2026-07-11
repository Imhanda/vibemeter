package middleware

import (
	"net/http"
	"vibemeter/config"

	"github.com/gin-gonic/gin"
)

// AdminOnly restricts a route group to user IDs listed in the ADMIN_USER_IDS
// env var. Must run after AuthMiddleware/WSAuthMiddleware so UserIDKey is set.
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString(UserIDKey)
		if !config.C.AdminUserIDs[userID] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin access required"})
			return
		}
		c.Next()
	}
}
