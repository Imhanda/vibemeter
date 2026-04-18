package handlers

import (
	"context"
	"fmt"
	"net/http"
	"time"
	"vibemeter/cache"
	"vibemeter/config"
	"vibemeter/db"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/gin-gonic/gin"
)

type VibeSummaryResponse struct {
	Summary string `json:"summary"`
	Tone    string `json:"tone"` // "lively" | "moderate" | "quiet"
}

// GetVibeSummary calls Claude to generate a natural-language vibe description
// for a venue based on its latest signals and score.
//
// GET /v1/vibe/:place_id/summary
func GetVibeSummary(c *gin.Context) {
	placeID := c.Param("place_id")

	if config.C.AnthropicAPIKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "summarisation not configured"})
		return
	}

	// Fetch cached venue score
	vs, err := cache.GetVenueScore(c.Request.Context(), placeID)
	if err != nil || vs == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no vibe data available for this venue yet"})
		return
	}

	// Fetch venue name and type from DB
	var name, venueType string
	err = db.DB.QueryRow(
		`SELECT name, COALESCE(type, 'venue') FROM places WHERE id = $1`, placeID,
	).Scan(&name, &venueType)
	if err != nil {
		name = "this venue"
		venueType = "venue"
	}

	hour := time.Now().Hour()
	timeOfDay := hourToTimeOfDay(hour)

	prompt := buildSummaryPrompt(name, venueType, timeOfDay, vs)

	client := anthropic.NewClient() // reads ANTHROPIC_API_KEY from env
	msg, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 120,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "summarisation failed"})
		return
	}

	summary := ""
	if len(msg.Content) > 0 {
		summary = msg.Content[0].Text
	}

	tone := scoreToTone(vs.Score)

	c.JSON(http.StatusOK, VibeSummaryResponse{
		Summary: summary,
		Tone:    tone,
	})
}

func buildSummaryPrompt(name, venueType, timeOfDay string, vs *cache.VenueScore) string {
	return fmt.Sprintf(`You are a nightlife scout writing short vibe updates for an app called VibeMeter.

Venue: %s (%s)
Time: %s
Vibe score: %.0f / 100
Confidence: %.0f%% (%d recent check-ins)
Music energy: %.0f%%
Crowd energy: %.0f%%
Ambient loudness: %.0f%%

Write a single punchy sentence (max 20 words) describing the current vibe.
Be direct and vivid — no filler phrases like "It seems" or "Based on data".
End with a subtle recommendation (go now / wait / skip it).
Reply with only the sentence, nothing else.`,
		name, venueType, timeOfDay,
		vs.Score,
		vs.Confidence*100, vs.CheckInCount,
		vs.MusicEnergy*100,
		vs.CrowdEnergy*100,
		vs.AmbientDB*100,
	)
}

func hourToTimeOfDay(h int) string {
	switch {
	case h >= 22 || h < 2:
		return "late night (peak hours)"
	case h >= 18:
		return "evening"
	case h >= 14:
		return "afternoon"
	default:
		return "daytime"
	}
}

func scoreToTone(score float64) string {
	switch {
	case score >= 65:
		return "lively"
	case score >= 35:
		return "moderate"
	default:
		return "quiet"
	}
}
