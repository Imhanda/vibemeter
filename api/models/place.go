package models

import "time"

type Place struct {
	ID             string     `db:"id"               json:"place_id"`
	Name           string     `db:"name"             json:"name"`
	Lat            float64    `db:"lat"              json:"lat"`
	Lng            float64    `db:"lng"              json:"lng"`
	Type           string     `db:"type"             json:"type"`
	Address        string     `db:"address"          json:"address"`
	PhotoURL       string     `db:"photo_url"        json:"photo_url"`
	PlacesSyncedAt *time.Time `db:"places_synced_at" json:"places_synced_at,omitempty"`
	CreatedAt      time.Time  `db:"created_at"       json:"created_at"`
}

type NearbyResult struct {
	ID        string  `db:"id"`
	Name      string  `db:"name"`
	Type      string  `db:"type"`
	Lat       float64 `db:"lat"`
	Lng       float64 `db:"lng"`
	PhotoURL  string  `db:"photo_url"`
	DistanceM float64 `db:"distance_m"`
}
