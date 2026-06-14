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
export function sprayAdvice(windKmh: number, precipMm: number): { ok: boolean; reason: string } {
  if (precipMm >= 1) return { ok: false, reason: "Lluvia prevista — el producto se lava" };
  if (windKmh > 20) return { ok: false, reason: `Viento fuerte (${Math.round(windKmh)} km/h) — riesgo de deriva` };
  if (windKmh > 15) return { ok: false, reason: `Viento moderado (${Math.round(windKmh)} km/h) — precaución` };
  return { ok: true, reason: `Condiciones aptas (viento ${Math.round(windKmh)} km/h)` };
}
