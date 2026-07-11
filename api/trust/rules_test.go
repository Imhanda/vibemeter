package trust

import (
	"testing"
	"time"
)

func TestFlagRateHit(t *testing.T) {
	cases := []struct {
		name           string
		flagged, total int
		want           bool
	}{
		{"below min contributions", 4, 4, false},
		{"at threshold, not over", 1, 4, false}, // total < 5, ignored regardless of rate
		{"exactly 30%, not over", 3, 10, false}, // 0.3 is not > 0.3
		{"just over threshold", 4, 10, true},    // 0.4 > 0.3
		{"all flagged", 5, 5, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := flagRateHit(c.flagged, c.total); got != c.want {
				t.Errorf("flagRateHit(%d, %d) = %v, want %v", c.flagged, c.total, got, c.want)
			}
		})
	}
}

func TestTravelHit(t *testing.T) {
	cases := []struct {
		name      string
		distanceM float64
		delta     time.Duration
		want      bool
	}{
		{"zero delta ignored", 50000, 0, false},
		{"negative delta ignored", 50000, -time.Minute, false},
		{"beyond max wait window ignored", 500000, 7 * time.Hour, false},
		{"walking pace, not a hit", 500, 10 * time.Minute, false},
		{"exactly at threshold, not over", 150000, time.Hour, false}, // 150km/h == threshold, not >
		{"faster than threshold, hit", 200000, time.Hour, true},      // 200km/h > 150km/h
		{"cross-city teleport, hit", 20000, time.Minute, true},       // 1200km/h
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := travelHit(c.distanceM, c.delta); got != c.want {
				t.Errorf("travelHit(%v, %v) = %v, want %v", c.distanceM, c.delta, got, c.want)
			}
		})
	}
}

func TestVenueBurstHit(t *testing.T) {
	cases := []struct {
		distinctVenues int
		want           bool
	}{
		{0, false}, {3, false}, {4, true}, {10, true},
	}
	for _, c := range cases {
		if got := venueBurstHit(c.distinctVenues); got != c.want {
			t.Errorf("venueBurstHit(%d) = %v, want %v", c.distinctVenues, got, c.want)
		}
	}
}

func TestFingerprintCloneHit(t *testing.T) {
	identical := [][3]float64{
		{0.5, 0.5, 0.5},
		{0.5, 0.5, 0.5},
		{0.5, 0.5, 0.5},
	}
	if !fingerprintCloneHit(identical) {
		t.Error("expected identical readings to hit")
	}

	varied := [][3]float64{
		{0.5, 0.5, 0.5},
		{0.2, 0.9, 0.1},
		{0.8, 0.3, 0.6},
	}
	if fingerprintCloneHit(varied) {
		t.Error("expected varied readings not to hit")
	}

	tooFew := [][3]float64{
		{0.5, 0.5, 0.5},
		{0.5, 0.5, 0.5},
	}
	if fingerprintCloneHit(tooFew) {
		t.Error("expected fewer than fingerprintMinMatch readings not to hit")
	}

	justOverEpsilon := [][3]float64{
		{0.50, 0.50, 0.50},
		{0.53, 0.50, 0.50}, // 0.03 diff >= 0.02 epsilon
		{0.50, 0.50, 0.50},
	}
	if fingerprintCloneHit(justOverEpsilon) {
		t.Error("expected a diff at/above epsilon on one signal not to match")
	}
}

func TestNewAccountVolumeHit(t *testing.T) {
	cases := []struct {
		name         string
		checkInCount int
		age          time.Duration
		want         bool
	}{
		{"low volume, new account", 5, time.Hour, false},
		{"high volume, old account", 50, 30 * 24 * time.Hour, false},
		{"exactly at threshold, not over", 20, time.Hour, false},
		{"high volume, brand new account", 21, time.Hour, true},
		{"high volume, right at window edge", 21, newAccountWindow - time.Minute, true},
		{"high volume, just outside window", 21, newAccountWindow + time.Minute, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := newAccountVolumeHit(c.checkInCount, c.age); got != c.want {
				t.Errorf("newAccountVolumeHit(%d, %v) = %v, want %v", c.checkInCount, c.age, got, c.want)
			}
		})
	}
}
