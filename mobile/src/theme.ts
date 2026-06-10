// VibeMeter — Nightlife-native dark theme
// Deep purple-black base, vibe state as visual hero

export const C = {
  // Backgrounds
  bgBase:     "#0A0812",  // root canvas
  bgSurface:  "#120F1E",  // cards, sections
  bgElevated: "#1C1730",  // modals, selected states

  // Brand accent
  teal:    "#0ECFB0",
  tealDim: "#0A8F7A",

  // Vibe states
  raging:  "#FF3D5A",  // score > 75
  buzzing: "#FF9500",  // score 50-75
  chill:   "#0ECFB0",  // score < 50
  unknown: "#3D3560",  // no data

  // Text
  textPrimary:   "#F0EEFF",
  textSecondary: "#8A82A8",
  textMuted:     "#4A4568",

  // Borders
  border: "#221E38",
  borderActive: "#0ECFB0",
};

export const GRADIENTS = {
  raging:  ["#FF3D5A", "#8B0026"] as const,
  buzzing: ["#FF9500", "#7A3800"] as const,
  chill:   ["#0ECFB0", "#005A4E"] as const,
  surface: ["#1C1730", "#120F1E"] as const,
  teal:    ["#0ECFB0", "#0A8F7A"] as const,
};

export function vibeColor(score: number | null): string {
  if (score == null) return C.unknown;
  if (score > 75)  return C.raging;
  if (score >= 50) return C.buzzing;
  return C.chill;
}

export function vibeGradient(score: number | null): readonly [string, string] {
  if (score == null) return [C.unknown, "#1A1230"];
  if (score > 75)  return GRADIENTS.raging;
  if (score >= 50) return GRADIENTS.buzzing;
  return GRADIENTS.chill;
}

export function vibeLabel(score: number | null): string {
  if (score == null) return "No data";
  if (score > 75)  return "Raging 🔥";
  if (score >= 50) return "Buzzing ⚡";
  return "Chill 😎";
}

// Hex color + alpha suffix for LinearGradient wash effects
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return hex + a;
}
