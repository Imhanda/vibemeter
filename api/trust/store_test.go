package trust

import "testing"

func TestClamp(t *testing.T) {
	cases := []struct {
		name  string
		score float64
		want  float64
	}{
		{"within range unchanged", 0.7, 0.7},
		{"below floor clamped up", -0.5, trustFloor},
		{"above ceiling clamped down", 1.5, trustCeiling},
		{"exactly at floor", trustFloor, trustFloor},
		{"exactly at ceiling", trustCeiling, trustCeiling},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := clamp(c.score); got != c.want {
				t.Errorf("clamp(%v) = %v, want %v", c.score, got, c.want)
			}
		})
	}
}
