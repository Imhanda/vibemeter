package handlers

import (
	"math"
	"net/http"
	"strconv"
	"vibemeter/cache"
	"vibemeter/config"
	"vibemeter/db"
	"vibemeter/middleware"
	"vibemeter/models"
	"vibemeter/scoring"

	"github.com/gin-gonic/gin"
)

// PrecheckVibe handles GET /v1/vibe/:place_id/precheck?lat=&lng=
//
// Lets the check-in screen show the rate-limit / geo-fence gate *before* the
// user records or rates anything, instead of surfacing a 429/403 after submit.
func PrecheckVibe(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)
	placeID := c.Param("place_id")

	var place models.Place
	if err := db.DB.Get(&place, `SELECT id, lat, lng FROM places WHERE id = $1`, placeID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "venue not found"})
		return
	}

	ctx := c.Request.Context()
	resp := gin.H{"can_check_in": true}

	// Rate limit: RATE_LIMIT_MAX check-ins per venue per rolling hour.
	if count, err := cache.GetRateLimit(ctx, userID, placeID); err == nil && count >= int64(config.C.RateLimitMax) {
		retry := 0
		if ttl, err := cache.RateLimitTTL(ctx, userID, placeID); err == nil && ttl > 0 {
			retry = int(ttl.Seconds())
		}
		resp["can_check_in"] = false
		resp["reason"] = "rate_limit"
		resp["limit"] = config.C.RateLimitMax
		resp["retry_after_seconds"] = retry
		c.JSON(http.StatusOK, resp)
		return
	}

	// Geo-fence — only enforced when auth is on and the fence isn't disabled,
	// mirroring SubmitVibe.
	if !config.C.SkipAuth && !config.C.SkipGeoFence {
		lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
		lng, errLng := strconv.ParseFloat(c.Query("lng"), 64)
		if errLat == nil && errLng == nil {
			distM := scoring.Haversine(lat, lng, place.Lat, place.Lng)
			resp["distance_m"] = math.Round(distM)
			resp["radius_m"] = config.C.GeoFenceRadiusM
			if distM > config.C.GeoFenceRadiusM {
				resp["can_check_in"] = false
				resp["reason"] = "too_far"
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}
