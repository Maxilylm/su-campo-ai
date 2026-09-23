// Pure weather helpers — no IO, unit-testable. Powered by Open-Meteo (free, no key).

// WMO weather code → Spanish label + emoji.
export function weatherCodeLabel(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: "Despejado", emoji: "☀️" };
  if (code <= 3) return { label: "Parcialmente nublado", emoji: "⛅" };
  if (code <= 48) return { label: "Niebla", emoji: "🌫️" };
  if (code <= 57) return { label: "Llovizna", emoji: "🌦️" };
  if (code <= 67) return { label: "Lluvia", emoji: "🌧️" };
  if (code <= 77) return { label: "Nieve", emoji: "❄️" };
  if (code <= 82) return { label: "Chaparrones", emoji: "🌧️" };
  if (code <= 86) return { label: "Nevadas", emoji: "🌨️" };
  return { label: "Tormenta", emoji: "⛈️" };
}

// Spraying suitability from wind (km/h) and expected precipitation (mm).
// Rain washes product off; strong wind causes drift.
/** Judged on the rounded wind every screen shows: at 15.5 km/h the raw value
 * said "no" while the card read "15 km/h", and 15.0 read "apto" — the same
 * number labeled both ways (seen live, loop 7). */
export function sprayAdvice(windKmh: number, precipMm: number): { ok: boolean; reason: string } {
  const wind = Math.round(windKmh);
  if (precipMm >= 1) return { ok: false, reason: "Lluvia prevista — el producto se lava" };
  if (wind > 20) return { ok: false, reason: `Viento fuerte (${wind} km/h) — riesgo de deriva` };
  if (wind > 15) return { ok: false, reason: `Viento moderado (${wind} km/h) — precaución` };
  return { ok: true, reason: `Condiciones aptas (viento ${wind} km/h)` };
}
