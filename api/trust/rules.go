package trust

import (
	"context"
	"math"
	"time"
	"vibemeter/db"
	"vibemeter/scoring"
)

const (
	flagRateMinContributions = 5
	flagRateThreshold        = 0.3

	impossibleTravelKMH     = 150.0
	impossibleTravelMaxWait = 6 * time.Hour

	venueBurstWindow = 60 * time.Minute
	venueBurstMax    = 3

	fingerprintLookback = 4
	fingerprintMinMatch = 3
	fingerprintEpsilon  = 0.02

	newAccountWindow     = 24 * time.Hour
	newAccountCheckInMax = 20
)

// ComputeSignals runs the deterministic rule set for a single evaluation.
func ComputeSignals(ctx context.Context, in EvalTrigger) ([]RuleHit, error) {
	var hits []RuleHit

	if hit, err := checkFlagRate(ctx, in.UserID); err != nil {
		return nil, err
	} else if hit {
		hits = append(hits, HitFlagRate)
	}

	if hit, err := checkImpossibleTravel(ctx, in.UserID); err != nil {
		return nil, err
	} else if hit {
		hits = append(hits, HitImpossibleTravel)
	}

	if hit, err := checkVenueBurst(ctx, in.UserID); err != nil {
		return nil, err
	} else if hit {
		hits = append(hits, HitVenueBurst)
	}

	if hit, err := checkFingerprintClone(ctx, in.UserID); err != nil {
		return nil, err
	} else if hit {
		hits = append(hits, HitFingerprintClone)
	}

	if hit, err := checkNewAccountVolume(ctx, in.UserID); err != nil {
		return nil, err
	} else if hit {
		hits = append(hits, HitNewAccountVolume)
	}

	return hits, nil
}

func checkFlagRate(ctx context.Context, userID string) (bool, error) {
	var flagged, total int
	err := db.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FILTER (WHERE flagged), COUNT(*)
		FROM vibe_contributions
		WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
		userID,
	).Scan(&flagged, &total)
	if err != nil {
		return false, err
	}
	return flagRateHit(flagged, total), nil
}

// flagRateHit is the pure decision behind checkFlagRate — split out so it can
// be unit tested without a database.
func flagRateHit(flagged, total int) bool {
	if total < flagRateMinContributions {
		return false
	}
	return float64(flagged)/float64(total) > flagRateThreshold
}

// checkImpossibleTravel compares the venues of a user's two most recent
// check-ins. It uses venue location (places.lat/lng), not raw device GPS —
// vibe_contributions does not persist client_lat/client_lng, and venue
// location is harder to spoof than a device's reported GPS anyway.
func checkImpossibleTravel(ctx context.Context, userID string) (bool, error) {
	type row struct {
		PlaceID   string    `db:"place_id"`
		Lat       float64   `db:"lat"`
		Lng       float64   `db:"lng"`
		CreatedAt time.Time `db:"created_at"`
	}
	var rows []row
	err := db.DB.SelectContext(ctx, &rows, `
		SELECT vc.place_id, p.lat, p.lng, vc.created_at
		FROM vibe_contributions vc
		JOIN places p ON p.id = vc.place_id
		WHERE vc.user_id = $1
		ORDER BY vc.created_at DESC
		LIMIT 2`,
		userID,
	)
	if err != nil {
		return false, err
	}
	if len(rows) < 2 || rows[0].PlaceID == rows[1].PlaceID {
		return false, nil
	}

	distanceM := scoring.Haversine(rows[0].Lat, rows[0].Lng, rows[1].Lat, rows[1].Lng)
	return travelHit(distanceM, rows[0].CreatedAt.Sub(rows[1].CreatedAt)), nil
}

// travelHit is the pure decision behind checkImpossibleTravel.
func travelHit(distanceM float64, delta time.Duration) bool {
	if delta <= 0 || delta > impossibleTravelMaxWait {
		return false
	}
	speedKMH := (distanceM / 1000.0) / delta.Hours()
	return speedKMH > impossibleTravelKMH
}

func checkVenueBurst(ctx context.Context, userID string) (bool, error) {
	var distinctVenues int
	err := db.DB.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT place_id)
		FROM vibe_contributions
		WHERE user_id = $1 AND created_at > $2`,
		userID, time.Now().Add(-venueBurstWindow),
	).Scan(&distinctVenues)
	if err != nil {
		return false, err
	}
	return venueBurstHit(distinctVenues), nil
}

// venueBurstHit is the pure decision behind checkVenueBurst.
func venueBurstHit(distinctVenues int) bool {
	return distinctVenues > venueBurstMax
}

// checkFingerprintClone flags a bot signature: several consecutive check-ins
// with near-identical crowd/music/ambient readings. Real ambient audio has
// natural variance; identical floats repeated across check-ins do not.
func checkFingerprintClone(ctx context.Context, userID string) (bool, error) {
	type row struct {
		CrowdEnergy float64 `db:"crowd_energy"`
		MusicEnergy float64 `db:"music_energy"`
		AmbientDB   float64 `db:"ambient_db"`
	}
	var rows []row
	err := db.DB.SelectContext(ctx, &rows, `
		SELECT crowd_energy, music_energy, ambient_db
		FROM vibe_contributions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2`,
		userID, fingerprintLookback,
	)
	if err != nil {
		return false, err
	}
	signals := make([][3]float64, len(rows))
	for i, r := range rows {
		signals[i] = [3]float64{r.CrowdEnergy, r.MusicEnergy, r.AmbientDB}
	}
	return fingerprintCloneHit(signals), nil
}

// fingerprintCloneHit is the pure decision behind checkFingerprintClone.
// signals[0] is the most recent check-in; each entry is
// [crowd_energy, music_energy, ambient_db].
func fingerprintCloneHit(signals [][3]float64) bool {
	if len(signals) < fingerprintMinMatch {
		return false
	}
	matches := 1 // the most recent check-in matches itself
	for i := 1; i < len(signals); i++ {
		close := true
		for s := 0; s < 3; s++ {
			if math.Abs(signals[i][s]-signals[0][s]) >= fingerprintEpsilon {
				close = false
				break
			}
		}
		if close {
			matches++
		}
	}
	return matches >= fingerprintMinMatch
}

func checkNewAccountVolume(ctx context.Context, userID string) (bool, error) {
	var createdAt time.Time
	var checkInCount int
	err := db.DB.QueryRowContext(ctx, `
		SELECT created_at, check_in_count FROM users WHERE id = $1`,
		userID,
	).Scan(&createdAt, &checkInCount)
	if err != nil {
		return false, err
	}
	return newAccountVolumeHit(checkInCount, time.Since(createdAt)), nil
}

// newAccountVolumeHit is the pure decision behind checkNewAccountVolume.
func newAccountVolumeHit(checkInCount int, accountAge time.Duration) bool {
	return checkInCount > newAccountCheckInMax && accountAge < newAccountWindow
}
