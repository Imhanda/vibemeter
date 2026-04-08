package models

import "time"

type User struct {
	ID           string     `db:"id"             json:"user_id"`
	DisplayName  string     `db:"display_name"   json:"display_name"`
	PhotoURL     string     `db:"photo_url"      json:"photo_url"`
	TrustScore   float64    `db:"trust_score"    json:"trust_score"`
	CheckInCount int        `db:"check_in_count" json:"check_ins"`
	StreakDays   int        `db:"streak_days"    json:"streak_days"`
	LastCheckin  *time.Time `db:"last_checkin"   json:"last_checkin,omitempty"`
	CreatedAt    time.Time  `db:"created_at"     json:"created_at"`
}

type Badge struct {
	ID        int       `db:"id"         json:"id"`
	UserID    string    `db:"user_id"    json:"user_id"`
	BadgeType string    `db:"badge_type" json:"badge_type"`
	PlaceID   *string   `db:"place_id"   json:"place_id,omitempty"`
	EarnedAt  time.Time `db:"earned_at"  json:"earned_at"`
}
