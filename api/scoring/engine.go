package scoring

import (
	"math"
	"time"
	"vibemeter/models"
)

const (
	CrowdEnergyWeight = 0.55
	MusicEnergyWeight = 0.40
	AmbientDBWeight   = 0.05
	ManualWeight      = 0.70
	DecayLambda       = 0.0077 // at 90 min → weight ≈ 0.50; at 180 min → weight ≈ 0.25
	OutlierThreshold  = 40.0

	// CheckinGraduationThreshold is the number of all-time, non-flagged
	// check-ins a venue needs before its score is driven purely by
	// check-ins rather than a Google-rating fallback. See BlendWithGoogleRating.
	CheckinGraduationThreshold = 20
)

// ComputeRawScore returns a 0–100 score for a single check-in.
func ComputeRawScore(req *models.SubmitVibeRequest) float64 {
	if req.ManualRating != nil && req.CrowdEnergy == nil && req.MusicEnergy == nil && req.AmbientDB == nil {
		normalised := (float64(*req.ManualRating) - 1) / 4.0 // [1–5] → [0–1]
		return normalised * 100 * ManualWeight
	}

	crowd, music, ambient := 0.0, 0.0, 0.0
	if req.CrowdEnergy != nil {
		crowd = clamp(*req.CrowdEnergy)
	}
	if req.MusicEnergy != nil {
		music = clamp(*req.MusicEnergy)
	}
	if req.AmbientDB != nil {
		ambient = clamp(*req.AmbientDB)
	}
	return (CrowdEnergyWeight*crowd + MusicEnergyWeight*music + AmbientDBWeight*ambient) * 100
}

// AggregateWithDecay computes weighted venue score and confidence per §4.3.
func AggregateWithDecay(contributions []models.VibeContribution, now time.Time) (score, confidence float64) {
	if len(contributions) == 0 {
		return 0, 0
	}

	var weightedSum, totalWeight, oldestAge float64
	for _, c := range contributions {
		ageMin := now.Sub(c.CreatedAt).Minutes()
		if ageMin < 0 {
			ageMin = 0
		}
		w := math.Exp(-DecayLambda*ageMin) * effectiveTrustWeight(c)
		weightedSum += c.RawScore * w
		totalWeight += w
		if ageMin > oldestAge {
			oldestAge = ageMin
		}
	}

	if totalWeight == 0 {
		return 0, 0
	}

	score = weightedSum / totalWeight
	confidence = math.Min(float64(len(contributions))/5.0, 1.0) * math.Max(0, 1-oldestAge/180.0)
	return score, confidence
}

// effectiveTrustWeight returns the contribution's weight, capping flagged ones at 0.3×.
func effectiveTrustWeight(c models.VibeContribution) float64 {
	w := c.TrustWeight
	if c.Flagged {
		w = math.Min(w, 0.3)
	}
	return w
}

// IsOutlier returns true when rawScore deviates >40 pts from the existing rolling avg.
func IsOutlier(rawScore float64, existing []models.VibeContribution) bool {
	if len(existing) < 3 {
		return false
	}
	var sum float64
	for _, c := range existing {
		sum += c.RawScore
	}
	return math.Abs(rawScore-sum/float64(len(existing))) > OutlierThreshold
}

// Haversine returns the great-circle distance in metres between two lat/lng points.
func Haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000.0
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	Δφ := (lat2 - lat1) * math.Pi / 180
	Δλ := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(Δφ/2)*math.Sin(Δφ/2) + math.Cos(φ1)*math.Cos(φ2)*math.Sin(Δλ/2)*math.Sin(Δλ/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// BlendWithGoogleRating blends a check-in-derived venue score with a Google
// rating fallback, shifting weight toward the check-in score as a venue
// accumulates check-in history. totalCheckins is the all-time count of
// non-flagged contributions at the venue, not the recent aggregation
// window — a venue that graduates stays check-in-driven even through a
// quiet period, it doesn't drift back toward the Google rating.
func BlendWithGoogleRating(checkinScore float64, totalCheckins int, googleRating float64) (score float64, source string) {
	if googleRating <= 0 {
		return checkinScore, "checkin" // no google data — nothing to blend
	}
	googleScore := googleRating * 20 // 1–5 stars -> 0–100, same scale as raw_score
	if totalCheckins <= 0 {
		return googleScore, "google"
	}
	w := math.Min(float64(totalCheckins)/CheckinGraduationThreshold, 1.0)
	if w >= 1.0 {
		return checkinScore, "checkin"
	}
	return w*checkinScore + (1-w)*googleScore, "blended"
}

func clamp(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
