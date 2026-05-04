package models

import (
	"time"

	"github.com/lib/pq"
)

type VibeContribution struct {
	ID          string         `db:"id"           json:"id"`
	PlaceID     string         `db:"place_id"     json:"place_id"`
	UserID      string         `db:"user_id"      json:"user_id"`
	CrowdEnergy float64        `db:"crowd_energy" json:"crowd_energy"`
	MusicEnergy float64        `db:"music_energy" json:"music_energy"`
	AmbientDB   float64        `db:"ambient_db"   json:"ambient_db"`
	RawScore    float64        `db:"raw_score"    json:"raw_score"`
	IsManual    bool           `db:"is_manual"    json:"is_manual"`
	TrustWeight float64        `db:"trust_weight" json:"trust_weight"`
	Flagged     bool           `db:"flagged"      json:"flagged"`
	Tags        pq.StringArray `db:"tags"         json:"tags"`
	CreatedAt   time.Time      `db:"created_at"   json:"created_at"`
}

// SubmitVibeRequest is what the mobile client POSTs.
type SubmitVibeRequest struct {
	PlaceID      string   `json:"place_id"      binding:"required"`
	MusicEnergy  *float64 `json:"music_energy"`
	CrowdEnergy  *float64 `json:"crowd_energy"`
	AmbientDB    *float64 `json:"ambient_db"`
	ManualRating *int     `json:"manual_rating"`
	ClientLat    float64  `json:"client_lat"    binding:"required"`
	ClientLng    float64  `json:"client_lng"    binding:"required"`
	Tags         []string `json:"tags"`
}

type VibeHistoryEntry struct {
	Hour  string  `json:"hour"`
	Score float64 `json:"score"`
	Count int     `json:"count"`
}

type SignalBreakdown struct {
	CrowdEnergy float64 `json:"crowd_energy"`
	MusicEnergy float64 `json:"music_energy"`
	AmbientDB   float64 `json:"ambient_db"`
}
