// Centralized status/severity → Tailwind class mapping. The classes are the
// semantic tokens in globals.css (ok/warn/bad), which switch per theme and are
// measured ≥ 4.5:1 there. Pure (unit-testable).

export type Tone = "good" | "warn" | "bad" | "neutral";

// Text + subtle border — for outline badges.
export function toneBadge(tone: Tone): string {
  switch (tone) {
    case "good": return "text-ok border-ok-line";
    case "warn": return "text-warn border-warn-line";
    case "bad": return "text-bad border-bad-line";
    default: return "text-muted-foreground";
  }
}

// Tinted chip (icon background) — for alert/severity badges.
export function toneTint(tone: Tone): string {
  switch (tone) {
    case "good": return "bg-ok-soft text-ok";
    case "warn": return "bg-warn-soft text-warn";
    case "bad": return "bg-bad-soft text-bad";
    default: return "bg-muted text-muted-foreground";
  }
}

export function vaccinationTone(status: string): Tone {
  if (status === "al_dia") return "good";
  if (status === "vencida") return "bad";
  return "warn"; // pendiente / unknown
}

export const alertSeverityTone = (severity: "high" | "medium"): Tone =>
  severity === "high" ? "bad" : "warn";
