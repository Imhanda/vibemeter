package trust

import (
	"context"
	"log"
	"vibemeter/cache"
	"vibemeter/config"
)

const (
	cleanDelta   = 0.03
	abusiveDelta = -0.3
)

// Evaluate runs the rule engine for a single check-in and, depending on the
// verdict, adjusts the user's trust score. Intended to be launched in a
// goroutine right after a contribution is inserted — see SubmitVibe in
// api/handlers/vibe.go — so it never blocks the check-in response.
//
// While config.C.TrustAgentEnforce is false (the default), decisions are
// computed and logged to trust_events but never written to users.trust_score
// or the Redis trust cache — "shadow mode" for reviewing real decisions
// before they take effect.
func Evaluate(ctx context.Context, in EvalTrigger) {
	hits, err := ComputeSignals(ctx, in)
	if err != nil {
		log.Println("trust: signal computation failed:", err)
		return
	}

	verdict, delta := classify(hits)

	oldScore, err := FetchTrustScore(ctx, in.UserID)
	if err != nil {
		log.Println("trust: fetch score failed:", err)
		return
	}

	newScore := clamp(oldScore + delta)
	enforced := config.C.TrustAgentEnforce

	if enforced && delta != 0 {
		newScore, err = ApplyTrustDelta(ctx, in.UserID, delta)
		if err != nil {
			log.Println("trust: apply delta failed:", err)
			return
		}
		if err := cache.SetTrustScore(ctx, in.UserID, newScore); err != nil {
			log.Println("trust: redis cache update failed:", err)
		}
	}

	event := Event{
		UserID:         in.UserID,
		ContributionID: in.ContributionID,
		PlaceID:        in.PlaceID,
		RuleHits:       hits,
		Verdict:        verdict,
		Delta:          delta,
		OldScore:       oldScore,
		NewScore:       newScore,
		Enforced:       enforced && delta != 0,
	}
	if err := InsertTrustEvent(ctx, event); err != nil {
		log.Println("trust: insert event failed:", err)
	}
}

// classify maps rule hits to a verdict and the trust_score delta to apply.
// The "suspicious" (single hit) tier is logged only for now — see llm.go —
// pending the Claude escalation fast-follow, so it always resolves to a 0
// delta rather than guessing at a penalty for an ambiguous case.
func classify(hits []RuleHit) (Verdict, float64) {
	switch {
	case len(hits) == 0:
		return VerdictClean, cleanDelta
	case len(hits) == 1:
		_, _ = ConsultVerdict(hits) // logged for visibility; not yet actioned
		return VerdictSuspicious, 0
	default:
		return VerdictAbusive, abusiveDelta
	}
}
