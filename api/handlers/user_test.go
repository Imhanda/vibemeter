package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"vibemeter/handlers"

	"github.com/gin-gonic/gin"
)

func newUserRouter() *gin.Engine {
	r := gin.New()
	r.Use(injectUser("test-user"))
	r.GET("/v1/user/profile", handlers.GetUserProfile)
	r.POST("/v1/user/follow/:place_id", handlers.FollowVenue)
	return r
}

func postFollow(t *testing.T, r *gin.Engine, placeID string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1/user/follow/"+placeID, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ── FollowVenue — threshold validation returns before DB ─────────────────────

func TestFollowVenue_ThresholdBelowZero_Returns400(t *testing.T) {
	r := newUserRouter()
	// Threshold -1 should be rejected before any DB lookup
	w := postFollow(t, r, "1", map[string]any{"threshold": -1})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for negative threshold, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["error"] != "threshold must be 0–100" {
		t.Errorf("unexpected error: %s", body["error"])
	}
}

func TestFollowVenue_ThresholdAbove100_Returns400(t *testing.T) {
	r := newUserRouter()
	w := postFollow(t, r, "1", map[string]any{"threshold": 101})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for threshold > 100, got %d: %s", w.Code, w.Body.String())
	}
}

