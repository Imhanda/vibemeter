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
	Score        float64   `json:"vibe_score"`
	Confidence   float64   `json:"confidence"`
	CheckInCount int       `json:"check_in_count"`
	LastUpdated  time.Time `json:"last_updated"`
	CrowdEnergy  float64   `json:"crowd_energy"`
	MusicEnergy  float64   `json:"music_energy"`
	AmbientDB    float64   `json:"ambient_db"`
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

// ── Subscriber cache ─────────────────────────────────────────────────────────
// Key: subscribers:{place_id} → Hash { user_id → threshold (int as string) }
// No TTL — entries are removed explicitly on unfollow.

func subscribersKey(placeID string) string {
	return fmt.Sprintf("subscribers:%s", placeID)
}

// AddVenueSubscriber upserts a subscriber with their threshold into the Redis hash.
func AddVenueSubscriber(ctx context.Context, placeID, userID string, threshold int) error {
	return RDB.HSet(ctx, subscribersKey(placeID), userID, threshold).Err()
}

// RemoveVenueSubscriber removes a subscriber from the Redis hash.
func RemoveVenueSubscriber(ctx context.Context, placeID, userID string) error {
	return RDB.HDel(ctx, subscribersKey(placeID), userID).Err()
}

// GetVenueSubscribers returns a map of userID → threshold for a venue.
func GetVenueSubscribers(ctx context.Context, placeID string) (map[string]int, error) {
	raw, err := RDB.HGetAll(ctx, subscribersKey(placeID)).Result()
	if err != nil {
		return nil, err
	}
	out := make(map[string]int, len(raw))
	for uid, val := range raw {
		t := 0
		fmt.Sscanf(val, "%d", &t)
		out[uid] = t
	}
	return out, nil
}

// IsVenueSubscriber checks if a user is subscribed to a venue.
func IsVenueSubscriber(ctx context.Context, placeID, userID string) (bool, error) {
	exists, err := RDB.HExists(ctx, subscribersKey(placeID), userID).Result()
	return exists, err
}

func PublishScoreUpdate(ctx context.Context, placeID string, payload []byte) error {
	channel := fmt.Sprintf("ws:room:%s", placeID)
	return RDB.Publish(ctx, channel, payload).Err()
}

func SubscribeToVenue(ctx context.Context, placeID string) *redis.PubSub {
	channel := fmt.Sprintf("ws:room:%s", placeID)
	return RDB.Subscribe(ctx, channel)
}
