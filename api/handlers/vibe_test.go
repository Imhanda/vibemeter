package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"vibemeter/handlers"
	"vibemeter/middleware"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// injectUser is a test middleware that sets the userID without hitting Firebase.
func injectUser(userID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(middleware.UserIDKey, userID)
		c.Next()
	}
}

func newVibeRouter() *gin.Engine {
	r := gin.New()
	r.Use(injectUser("test-user"))
	r.POST("/v1/vibe", handlers.SubmitVibe)
	r.GET("/v1/vibe/:place_id", handlers.GetVenueVibe)
	return r
}

func postVibe(t *testing.T, r *gin.Engine, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1/vibe", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ── Input validation — these paths return before any DB/Redis call ─────────────

func TestSubmitVibe_MissingPlaceID_Returns400(t *testing.T) {
	r := newVibeRouter()
	w := postVibe(t, r, map[string]any{
		"crowd_energy": 0.8,
		"music_energy": 0.7,
		"ambient_db":   0.6,
		"client_lat":   12.9716,
		"client_lng":   77.6400,
		// place_id intentionally omitted
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSubmitVibe_NoSignalsAndNoManualRating_Returns400(t *testing.T) {
	r := newVibeRouter()
	w := postVibe(t, r, map[string]any{
		"place_id":   "1",
		"client_lat": 12.9716,
		"client_lng": 77.6400,
		// no crowd_energy, music_energy, ambient_db, manual_rating
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["error"] != "provide audio signals or manual_rating" {
		t.Errorf("unexpected error message: %s", body["error"])
	}
}

func TestSubmitVibe_ManualRatingTooLow_Returns400(t *testing.T) {
	r := newVibeRouter()
	w := postVibe(t, r, map[string]any{
		"place_id":      "1",
		"manual_rating": 0, // invalid: must be 1–5
		"client_lat":    12.9716,
		"client_lng":    77.6400,
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["error"] != "manual_rating must be 1–5" {
		t.Errorf("unexpected error message: %s", body["error"])
	}
}

func TestSubmitVibe_ManualRatingTooHigh_Returns400(t *testing.T) {
	r := newVibeRouter()
	w := postVibe(t, r, map[string]any{
		"place_id":      "1",
		"manual_rating": 6, // invalid: must be 1–5
		"client_lat":    12.9716,
		"client_lng":    77.6400,
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSubmitVibe_InvalidJSON_Returns400(t *testing.T) {
	r := newVibeRouter()
	req := httptest.NewRequest(http.MethodPost, "/v1/vibe", bytes.NewBufferString("{invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

