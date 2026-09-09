package models

import "time"

// VenueReport is a user-submitted report about a venue's vibe data
// (guideline 1.2 UGC moderation).
type VenueReport struct {
	ID         string     `db:"id"          json:"id"`
	PlaceID    string     `db:"place_id"    json:"place_id"`
	ReporterID *string    `db:"reporter_id" json:"reporter_id,omitempty"`
	VibeID     *string    `db:"vibe_id"     json:"vibe_id,omitempty"`
	Reason     string     `db:"reason"      json:"reason"`
	Detail     string     `db:"detail"      json:"detail,omitempty"`
	Status     string     `db:"status"      json:"status"`
	CreatedAt  time.Time  `db:"created_at"  json:"created_at"`
	ResolvedAt *time.Time `db:"resolved_at" json:"resolved_at,omitempty"`
	ResolvedBy string     `db:"resolved_by" json:"resolved_by,omitempty"`
}
