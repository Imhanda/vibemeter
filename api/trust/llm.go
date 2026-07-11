package trust

// ConsultVerdict is a placeholder for the Claude-backed escalation tier for
// "suspicious" (single rule hit) evaluations.
//
// TODO(fast-follow): once shadow mode has produced enough real trust_events
// data to confirm rule thresholds are calibrated (i.e. the "suspicious" tier
// isn't firing on a large fraction of traffic), wire this up to Claude using
// the same anthropic.NewClient() / client.Messages.New(...) pattern already
// used in api/handlers/search.go and api/handlers/summary.go, gated behind a
// new TRUST_AGENT_LLM_ENABLED config flag. Until then, "suspicious" verdicts
// are logged with no trust_score penalty — see agent.go.
func ConsultVerdict(hits []RuleHit) (verdict Verdict, rationale string) {
	return VerdictSuspicious, "llm escalation not yet implemented — logged only, no penalty applied"
}
