// Confidence band thresholds for the three-state venue display.
// confidence is the 0–1 float from the scoring engine:
//   min(count/5, 1) × (1 − age_of_oldest/180)

export type ConfidenceBand = "early" | "growing" | "confident";

export function confidenceBand(confidence: number | null | undefined): ConfidenceBand | null {
  if (confidence == null) return null;
  if (confidence < 0.3) return "early";
  if (confidence <= 0.7) return "growing";
  return "confident";
}

export function confidenceLabel(band: ConfidenceBand): string {
  switch (band) {
    case "early":
      return "Early data";
    case "growing":
      return "Growing";
    case "confident":
      return "Confident";
  }
}

export function confidenceDescription(band: ConfidenceBand): string {
  switch (band) {
    case "early":
      return "Just one or two recent check-ins — treat this as a rough signal.";
    case "growing":
      return "A few recent check-ins agree on this score.";
    case "confident":
      return "Enough fresh check-ins to trust this score right now.";
  }
}
