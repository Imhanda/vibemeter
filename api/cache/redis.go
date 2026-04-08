package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"
	"vibemeter/config"

	"github.com/redis/go-redis/v9"
)

var RDB *redis.Client

type VenueScore struct {
	VibeScore    float64   `json:"vibe_score"`
	Confidence   float64   `json:"confidence"`
	CheckInCount int       `json:"check_in_count"`
	LastUpdated  time.Time `json:"last_updated"`
}

const venueScoreTTL = 3 * time.Hour

func InitRedis() {
	opt, err := redis.ParseURL(config.C.RedisURL)
	if err != nil {
		log.Fatal("Invalid Redis URL:", err)
	}
	RDB = redis.NewClient(opt)
	if err := RDB.Ping(context.Background()).Err(); err != nil {
		log.Fatal("Redis connection failed:", err)
	}
	log.Println("Connected to Redis")
}

func SetVenueScore(ctx context.Context, placeID string, vs VenueScore) error {
	key := fmt.Sprintf("venue:%s", placeID)
	data, err := json.Marshal(vs)
	if err != nil {
		return err
	}
	return RDB.Set(ctx, key, data, venueScoreTTL).Err()
}

func GetVenueScore(ctx context.Context, placeID string) (*VenueScore, error) {
	key := fmt.Sprintf("venue:%s", placeID)
	data, err := RDB.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var vs VenueScore
	if err := json.Unmarshal(data, &vs); err != nil {
		return nil, err
	}
	return &vs, nil
}

// IncrRateLimit increments the per-user-per-venue rate limit counter.
// Returns the new count. Sets a 1-hour TTL on first increment.
func IncrRateLimit(ctx context.Context, userID, placeID string) (int64, error) {
	key := fmt.Sprintf("ratelimit:%s:%s", userID, placeID)
	count, err := RDB.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	if count == 1 {
		RDB.Expire(ctx, key, time.Hour)
	}
	return count, nil
}

func GetRateLimit(ctx context.Context, userID, placeID string) (int64, error) {
	key := fmt.Sprintf("ratelimit:%s:%s", userID, placeID)
	count, err := RDB.Get(ctx, key).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return count, err
}

func GetTrustScore(ctx context.Context, userID string) (float64, error) {
	key := fmt.Sprintf("trust:%s", userID)
	score, err := RDB.Get(ctx, key).Float64()
	if err == redis.Nil {
		return 0.7, nil // default for new users
	}
	return score, err
}

func SetTrustScore(ctx context.Context, userID string, score float64) error {
	key := fmt.Sprintf("trust:%s", userID)
	return RDB.Set(ctx, key, score, 0).Err()
}

func PublishScoreUpdate(ctx context.Context, placeID string, payload []byte) error {
	channel := fmt.Sprintf("ws:room:%s", placeID)
	return RDB.Publish(ctx, channel, payload).Err()
}

func SubscribeToVenue(ctx context.Context, placeID string) *redis.PubSub {
	channel := fmt.Sprintf("ws:room:%s", placeID)
	return RDB.Subscribe(ctx, channel)
}
