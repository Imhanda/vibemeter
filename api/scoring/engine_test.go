package scoring_test

import (
	"math"
	"testing"
	"time"
	"vibemeter/models"
	"vibemeter/scoring"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func ptr[T any](v T) *T { return &v }

func approx(t *testing.T, got, want, tol float64, label string) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Errorf("%s: got %.4f, want %.4f (tol ±%.4f)", label, got, want, tol)
	}
}

func contrib(rawScore float64, ageMin float64, trustWeight float64, flagged bool) models.VibeContribution {
	return models.VibeContribution{
		RawScore:    rawScore,
		TrustWeight: trustWeight,
		Flagged:     flagged,
		CreatedAt:   time.Now().Add(-time.Duration(ageMin) * time.Minute),
	}
}

// ── ComputeRawScore ───────────────────────────────────────────────────────────

func TestComputeRawScore_AudioSignals(t *testing.T) {
	// (0.40×0.8 + 0.35×0.7 + 0.25×0.6) × 100 = (0.32 + 0.245 + 0.15) × 100 = 71.5
	req := &models.SubmitVibeRequest{
		CrowdEnergy: ptr(0.8),
		MusicEnergy: ptr(0.7),
		AmbientDB:   ptr(0.6),
	}
	got := scoring.ComputeRawScore(req)
	approx(t, got, 71.5, 0.01, "audio score")
}

func TestComputeRawScore_AllZeroSignals(t *testing.T) {
	req := &models.SubmitVibeRequest{
		CrowdEnergy: ptr(0.0),
		MusicEnergy: ptr(0.0),
		AmbientDB:   ptr(0.0),
	}
	approx(t, scoring.ComputeRawScore(req), 0.0, 0.001, "all-zero score")
}

func TestComputeRawScore_AllMaxSignals(t *testing.T) {
	req := &models.SubmitVibeRequest{
		CrowdEnergy: ptr(1.0),
		MusicEnergy: ptr(1.0),
		AmbientDB:   ptr(1.0),
	}
	approx(t, scoring.ComputeRawScore(req), 100.0, 0.001, "all-max score")
}

func TestComputeRawScore_ClampsAboveOne(t *testing.T) {
	req := &models.SubmitVibeRequest{
		CrowdEnergy: ptr(2.0),
		MusicEnergy: ptr(1.5),
		AmbientDB:   ptr(3.0),
	}
	// Clamped to 1.0 each → same as all-max
	approx(t, scoring.ComputeRawScore(req), 100.0, 0.001, "clamped above 1")
}

func TestComputeRawScore_ClampsBelow0(t *testing.T) {
	req := &models.SubmitVibeRequest{
		CrowdEnergy: ptr(-0.5),
		MusicEnergy: ptr(-1.0),
		AmbientDB:   ptr(-0.1),
	}
	approx(t, scoring.ComputeRawScore(req), 0.0, 0.001, "clamped below 0")
}

func TestComputeRawScore_NilSignalsDefaultToZero(t *testing.T) {
	// Only crowd_energy provided; music and ambient default to 0
	// 0.40×0.5 × 100 = 20.0
	req := &models.SubmitVibeRequest{
		CrowdEnergy: ptr(0.5),
	}
	approx(t, scoring.ComputeRawScore(req), 20.0, 0.01, "partial signals")
}

func TestComputeRawScore_ManualRating(t *testing.T) {
	cases := []struct {
		rating int
		want   float64
	}{
		{1, 0.0},             // (1-1)/4 × 100 × 0.7 = 0
		{3, 35.0},            // (3-1)/4 × 100 × 0.7 = 35
		{5, 70.0},            // (5-1)/4 × 100 × 0.7 = 70
	}
	for _, tc := range cases {
		req := &models.SubmitVibeRequest{ManualRating: ptr(tc.rating)}
		got := scoring.ComputeRawScore(req)
		approx(t, got, tc.want, 0.01, "manual rating")
	}
}

func TestComputeRawScore_ManualRatingIgnoredWhenSignalsPresent(t *testing.T) {
	// If audio signals are present, manual rating must be ignored
	rating := 5
	req := &models.SubmitVibeRequest{
		CrowdEnergy:  ptr(0.5),
		ManualRating: &rating,
	}
	// Treated as audio (crowd only): 0.40×0.5 × 100 = 20
	got := scoring.ComputeRawScore(req)
	if got == 70.0 {
		t.Errorf("manual rating should be ignored when audio signals are present")
	}
	approx(t, got, 20.0, 0.01, "audio wins over manual")
}

// ── AggregateWithDecay ────────────────────────────────────────────────────────

func TestAggregateWithDecay_Empty(t *testing.T) {
	score, conf := scoring.AggregateWithDecay(nil, time.Now())
	if score != 0 || conf != 0 {
		t.Errorf("empty contributions: want 0,0 got %.2f,%.2f", score, conf)
	}
}

func TestAggregateWithDecay_SingleFreshContribution(t *testing.T) {
	cs := []models.VibeContribution{contrib(80, 0, 1.0, false)}
	score, conf := scoring.AggregateWithDecay(cs, time.Now())
	// Single fresh check-in → score ≈ 80
	approx(t, score, 80.0, 0.5, "single fresh score")
	// confidence: min(1/5, 1) × (1 - 0/180) = 0.2
	approx(t, conf, 0.2, 0.05, "single fresh confidence")
}

func TestAggregateWithDecay_OldCheckInsDecay(t *testing.T) {
	// Check-in at 0 min and at 90 min: at 90 min, weight ≈ 0.5
	fresh := contrib(80, 0, 1.0, false)
	old := contrib(20, 90, 1.0, false)
	cs := []models.VibeContribution{fresh, old}
	score, _ := scoring.AggregateWithDecay(cs, time.Now())
	// Fresh (weight≈1) pulls score above midpoint; old (weight≈0.5) pulls down
	// weighted avg ≈ (80×1 + 20×0.5) / (1+0.5) = 90/1.5 = 60
	if score < 50 || score > 80 {
		t.Errorf("decayed score out of expected range: %.2f", score)
	}
	// Fresh score dominates old
	if score < 55 {
		t.Errorf("fresh check-in should dominate: got %.2f", score)
	}
}

func TestAggregateWithDecay_FiveContributionsMaxConfidence(t *testing.T) {
	cs := []models.VibeContribution{
		contrib(70, 0, 1.0, false),
		contrib(70, 5, 1.0, false),
		contrib(70, 10, 1.0, false),
		contrib(70, 15, 1.0, false),
		contrib(70, 20, 1.0, false),
	}
	_, conf := scoring.AggregateWithDecay(cs, time.Now())
	// min(5/5, 1.0) = 1.0; age factor close to 1 since oldest is 20 min
	if conf < 0.8 {
		t.Errorf("5 recent check-ins should yield high confidence, got %.2f", conf)
	}
}

func TestAggregateWithDecay_FlaggedContributionsCappedAt0_3(t *testing.T) {
	good := contrib(80, 0, 1.0, false)
	flagged := contrib(10, 1, 1.0, true) // would pull score down heavily if not capped
	cs := []models.VibeContribution{good, flagged}
	score, _ := scoring.AggregateWithDecay(cs, time.Now())
	// Flagged at 0.3× weight: (80×1 + 10×0.3) / (1+0.3) ≈ (80+3)/1.3 ≈ 63.8
	// Without cap it would be: (80×1 + 10×1) / 2 = 45
	if score < 60 {
		t.Errorf("flagged contribution should have reduced weight, score=%.2f", score)
	}
}

func TestAggregateWithDecay_ConfidenceFadesWithAge(t *testing.T) {
	// Single check-in, 150 min old (well into fading range)
	cs := []models.VibeContribution{contrib(70, 150, 1.0, false)}
	_, conf := scoring.AggregateWithDecay(cs, time.Now())
	// min(1/5,1)×(1-150/180) = 0.2 × 0.167 ≈ 0.033
	if conf > 0.1 {
		t.Errorf("very old check-in should have low confidence, got %.4f", conf)
	}
}

// ── IsOutlier ─────────────────────────────────────────────────────────────────

func TestIsOutlier_FewerThanThreeContributions(t *testing.T) {
	cs := []models.VibeContribution{
		{RawScore: 50}, {RawScore: 50},
	}
	// Never flags with < 3 existing contributions
	if scoring.IsOutlier(99, cs) {
		t.Error("should not flag outlier with fewer than 3 existing contributions")
	}
}

func TestIsOutlier_WithinThreshold(t *testing.T) {
	cs := []models.VibeContribution{
		{RawScore: 60}, {RawScore: 60}, {RawScore: 60},
	}
	// avg=60, new=80 → diff=20 ≤ 40 → not outlier
	if scoring.IsOutlier(80, cs) {
		t.Error("score within 40pts of average should not be an outlier")
	}
}

func TestIsOutlier_BeyondThreshold(t *testing.T) {
	cs := []models.VibeContribution{
		{RawScore: 50}, {RawScore: 50}, {RawScore: 50},
	}
	// avg=50, new=95 → diff=45 > 40 → outlier
	if !scoring.IsOutlier(95, cs) {
		t.Error("score 45pts above average should be flagged as outlier")
	}
}

func TestIsOutlier_BelowThreshold(t *testing.T) {
	cs := []models.VibeContribution{
		{RawScore: 80}, {RawScore: 80}, {RawScore: 80},
	}
	// avg=80, new=5 → diff=75 > 40 → outlier
	if !scoring.IsOutlier(5, cs) {
		t.Error("score 75pts below average should be flagged as outlier")
	}
}

func TestIsOutlier_ExactlyAtThreshold(t *testing.T) {
	cs := []models.VibeContribution{
		{RawScore: 50}, {RawScore: 50}, {RawScore: 50},
	}
	// diff == 40 is NOT > 40, so not an outlier
	if scoring.IsOutlier(90, cs) {
		t.Error("score exactly 40pts from average should not be an outlier")
	}
}

// ── Haversine ─────────────────────────────────────────────────────────────────

func TestHaversine_SamePoint(t *testing.T) {
	d := scoring.Haversine(12.9716, 77.6400, 12.9716, 77.6400)
	approx(t, d, 0.0, 0.001, "same point distance")
}

func TestHaversine_KnownDistance(t *testing.T) {
	// Toit Brewpub → ~55m south (approx 0.0005° lat shift)
	lat1, lng1 := 12.9716, 77.6400
	lat2, lng2 := 12.9711, 77.6400
	d := scoring.Haversine(lat1, lng1, lat2, lng2)
	// ~55m expected
	if d < 40 || d > 70 {
		t.Errorf("expected ~55m, got %.1fm", d)
	}
}

func TestHaversine_300mThreshold(t *testing.T) {
	// Shift ~0.0027° in lat ≈ 300m
	lat1, lng1 := 12.9716, 77.6400
	lat2, lng2 := 12.9743, 77.6400
	d := scoring.Haversine(lat1, lng1, lat2, lng2)
	if d < 250 || d > 350 {
		t.Errorf("expected ~300m shift, got %.1fm", d)
	}
}

func TestHaversine_FarAway(t *testing.T) {
	// Bengaluru → Mumbai: ~845 km (straight-line great-circle distance)
	d := scoring.Haversine(12.9716, 77.5946, 19.0760, 72.8777)
	if d < 800_000 || d > 900_000 {
		t.Errorf("Bengaluru→Mumbai: expected ~845km, got %.0fm", d)
	}
}
