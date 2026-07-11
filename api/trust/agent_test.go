package trust

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		name        string
		hits        []RuleHit
		wantVerdict Verdict
		wantDelta   float64
	}{
		{"no hits is clean", nil, VerdictClean, cleanDelta},
		{"one hit is suspicious, no penalty yet", []RuleHit{HitVenueBurst}, VerdictSuspicious, 0},
		{"two hits is abusive", []RuleHit{HitVenueBurst, HitImpossibleTravel}, VerdictAbusive, abusiveDelta},
		{"all five hits is abusive", []RuleHit{HitFlagRate, HitImpossibleTravel, HitVenueBurst, HitFingerprintClone, HitNewAccountVolume}, VerdictAbusive, abusiveDelta},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			verdict, delta := classify(c.hits)
			if verdict != c.wantVerdict || delta != c.wantDelta {
				t.Errorf("classify(%v) = (%v, %v), want (%v, %v)", c.hits, verdict, delta, c.wantVerdict, c.wantDelta)
			}
		})
	}
}
