package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"vibemeter/handlers"

	"github.com/gin-gonic/gin"
)

func newPlacesRouter() *gin.Engine {
	r := gin.New()
	r.Use(injectUser("test-user"))
	r.GET("/v1/places/nearby", handlers.GetNearbyPlaces)
	return r
}

func getNearby(t *testing.T, r *gin.Engine, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/places/nearby"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ── Parameter validation — these return before any DB call ────────────────────

func TestGetNearbyPlaces_MissingLat_Returns400(t *testing.T) {
	r := newPlacesRouter()
	w := getNearby(t, r, "?lng=77.6400")
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing lat, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["error"] != "lat required" {
		t.Errorf("unexpected error: %s", body["error"])
	}
}

func TestGetNearbyPlaces_MissingLng_Returns400(t *testing.T) {
	r := newPlacesRouter()
	w := getNearby(t, r, "?lat=12.9716")
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing lng, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["error"] != "lng required" {
		t.Errorf("unexpected error: %s", body["error"])
	}
}

func TestGetNearbyPlaces_NonNumericLat_Returns400(t *testing.T) {
	r := newPlacesRouter()
	w := getNearby(t, r, "?lat=abc&lng=77.6400")
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for non-numeric lat, got %d", w.Code)
	}
}

func TestGetNearbyPlaces_NonNumericLng_Returns400(t *testing.T) {
	r := newPlacesRouter()
	w := getNearby(t, r, "?lat=12.9716&lng=xyz")
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for non-numeric lng, got %d", w.Code)
	}
}

