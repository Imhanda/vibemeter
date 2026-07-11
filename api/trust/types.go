package trust

// Verdict is the outcome of a trust evaluation.
type Verdict string

const (
	VerdictClean          Verdict = "clean"
	VerdictSuspicious     Verdict = "suspicious"
	VerdictAbusive        Verdict = "abusive"
	VerdictManualOverride Verdict = "manual_override"
)

// RuleHit names a deterministic signal that fired during evaluation.
type RuleHit string

const (
	HitFlagRate         RuleHit = "flag_rate_7d"
	HitImpossibleTravel RuleHit = "impossible_travel"
	HitVenueBurst       RuleHit = "venue_burst_60m"
	HitFingerprintClone RuleHit = "fingerprint_clone"
	HitNewAccountVolume RuleHit = "new_account_volume"
)

// EvalTrigger carries the context needed to evaluate a single check-in.
type EvalTrigger struct {
	UserID         string
	ContributionID string
	PlaceID        string
	Flagged        bool // the per-check-in outlier flag already computed in SubmitVibe
}

// Event is a row written to trust_events for every evaluation.
type Event struct {
	UserID         string
	ContributionID string
	PlaceID        string
	RuleHits       []RuleHit
	Verdict        Verdict
	Delta          float64
	OldScore       float64
	NewScore       float64
	Enforced       bool
}
