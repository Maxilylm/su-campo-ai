// Centralized status/severity → Tailwind class mapping, so the palette is
// consistent and dark-mode-correct in one place. Pure (unit-testable).

export type Tone = "good" | "warn" | "bad" | "neutral";

// Text + subtle border — for outline badges.
export function toneBadge(tone: Tone): string {
  switch (tone) {
    case "good": return "text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "warn": return "text-amber-600 dark:text-amber-400 border-amber-500/30";
    case "bad": return "text-red-600 dark:text-red-400 border-red-500/30";
    default: return "text-muted-foreground";
  }
}

// Tinted chip (icon background) — for alert/severity badges.
export function toneTint(tone: Tone): string {
  switch (tone) {
    case "good": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "warn": return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "bad": return "bg-red-500/10 text-red-600 dark:text-red-400";
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
