package trust

import (
	"context"
	"vibemeter/db"

	"github.com/lib/pq"
)

const (
	trustFloor   = 0.1
	trustCeiling = 1.0
)

func clamp(score float64) float64 {
	if score < trustFloor {
		return trustFloor
	}
	if score > trustCeiling {
		return trustCeiling
	}
	return score
}

// FetchTrustScore reads the user's current persisted trust score.
func FetchTrustScore(ctx context.Context, userID string) (float64, error) {
	var score float64
	err := db.DB.QueryRowContext(ctx,
		`SELECT trust_score FROM users WHERE id = $1`, userID,
	).Scan(&score)
	return score, err
}

// ApplyTrustDelta atomically clamps and applies a delta to a user's trust
// score, returning the resulting value. Uses a single UPDATE ... RETURNING
// rather than read-then-write to avoid losing concurrent updates.
func ApplyTrustDelta(ctx context.Context, userID string, delta float64) (newScore float64, err error) {
	err = db.DB.QueryRowContext(ctx, `
		UPDATE users
		SET trust_score = LEAST($3, GREATEST($2, trust_score + $1))
		WHERE id = $4
		RETURNING trust_score`,
		delta, trustFloor, trustCeiling, userID,
	).Scan(&newScore)
	return newScore, err
}

// InsertTrustEvent writes an audit row for a trust evaluation or override.
func InsertTrustEvent(ctx context.Context, e Event) error {
	_, err := db.DB.ExecContext(ctx, `
		INSERT INTO trust_events
		    (user_id, contribution_id, place_id, rule_hits, verdict, delta, old_score, new_score, enforced)
		VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, $6, $7, $8, $9)`,
		e.UserID, e.ContributionID, e.PlaceID, pq.Array(ruleHitStrings(e.RuleHits)), string(e.Verdict),
		e.Delta, e.OldScore, e.NewScore, e.Enforced,
	)
	return err
}

func ruleHitStrings(hits []RuleHit) []string {
	out := make([]string, len(hits))
	for i, h := range hits {
		out[i] = string(h)
	}
	return out
}
