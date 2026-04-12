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

	// Authenticated routes
	v1 := r.Group("/v1", middleware.AuthMiddleware())
	{
		// Vibe
		v1.POST("/vibe", handlers.SubmitVibe)
		v1.GET("/vibe/:place_id", handlers.GetVenueVibe)

		// Places
		v1.GET("/places/nearby", handlers.GetNearbyPlaces)

		// User
		v1.GET("/user/profile", handlers.GetUserProfile)
		v1.POST("/user/follow/:place_id", handlers.FollowVenue)

		// WebSocket
		v1.GET("/ws", handlers.WSHandler)
	}

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
