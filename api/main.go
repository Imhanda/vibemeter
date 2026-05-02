package main

import (
	"log"
	"vibemeter/cache"
	"vibemeter/config"
	"vibemeter/db"
	"vibemeter/handlers"
	"vibemeter/middleware"

	"github.com/gin-gonic/gin"
)

func main() {
	config.Load()
	db.InitDB()
	cache.InitRedis()

	r := gin.Default()

	// Health
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Auth (public)
	r.POST("/v1/auth/google", handlers.ExchangeGoogleCode)

	// Authenticated routes
	v1 := r.Group("/v1", middleware.AuthMiddleware())
	{
		// Vibe — /vibe/analyse must be before /vibe/:place_id
		v1.POST("/vibe", handlers.SubmitVibe)
		v1.POST("/vibe/analyse", handlers.AnalyseAudio)
		v1.GET("/vibe/:place_id", handlers.GetVenueVibe)
		v1.GET("/vibe/:place_id/summary", handlers.GetVibeSummary)

		// Places
		v1.GET("/places/nearby", handlers.GetNearbyPlaces)
		v1.POST("/places/search", handlers.SearchPlaces)

		// User
		v1.GET("/user/profile", handlers.GetUserProfile)
		v1.GET("/user/follow/:place_id", handlers.GetFollowStatus)
		v1.POST("/user/follow/:place_id", handlers.FollowVenue)
		v1.DELETE("/user/follow/:place_id", handlers.UnfollowVenue)
		v1.POST("/user/push-token", handlers.RegisterPushToken)
	}

	// WebSocket — auth handled inside handler via query param token
	r.GET("/v1/ws", middleware.WSAuthMiddleware(), handlers.WSHandler)

	// Admin — one-time or manual pull from Google Places API
	admin := r.Group("/v1/admin", middleware.AuthMiddleware())
	{
		admin.POST("/places/sync", handlers.SyncPlaces)
	}

	log.Printf("VibeMeter API starting on :%s\n", config.C.Port)
	if err := r.Run(":" + config.C.Port); err != nil {
		log.Fatal(err)
	}
}
