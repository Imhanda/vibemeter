package config

import (
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL        string
	RedisURL           string
	FirebaseProjectID  string
	GooglePlacesAPIKey string
	GoogleWebClientID  string
	GoogleClientSecret string
	YAMNetURL          string
	AnthropicAPIKey    string
	GeoFenceRadiusM    float64
	ScoreWindowMinutes int
	RateLimitMax       int
	SkipAuth           bool
	Port               string
}

var C Config

func Load() {
	C = Config{
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://vibemeter:vibemeter@localhost:5432/vibemeter?sslmode=disable"),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		FirebaseProjectID:  getEnv("FIREBASE_PROJECT_ID", ""),
		GooglePlacesAPIKey: getEnv("GOOGLE_PLACES_API_KEY", ""),
		GoogleWebClientID:  getEnv("GOOGLE_WEB_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		YAMNetURL:          getEnv("YAMNET_URL", "http://localhost:8082"),
		AnthropicAPIKey:    getEnv("ANTHROPIC_API_KEY", ""),
		GeoFenceRadiusM:    getEnvFloat("GEO_FENCE_RADIUS_M", 300),
		ScoreWindowMinutes: getEnvInt("SCORE_WINDOW_MINUTES", 180),
		RateLimitMax:       getEnvInt("RATE_LIMIT_MAX", 2),
		SkipAuth:           getEnv("SKIP_AUTH", "false") == "true",
		Port:               getEnv("PORT", "8080"),
	}
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return defaultVal
}

func getEnvFloat(key string, defaultVal float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return defaultVal
}
