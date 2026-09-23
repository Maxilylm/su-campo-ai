import { isValidDateOnly } from "./date";

// A manual start for the grazing clock: potreros that were already occupied
// (or empty) before migration 045 have no transition on record, so the user
// can say when the animals went in (or out) once.

const MAX_YEARS_BACK = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OccupancyClockInput {
  sectionId: string;
  date: string;
}

/** `today` is the browser's local date; the server passes its own as a
 * fallback. Dates in the future or implausibly old are rejected. */
export function parseOccupancyClock(body: Record<string, unknown>, today: string): { ok: true; value: OccupancyClockInput } | { ok: false; error: string } {
  if (typeof body.sectionId !== "string" || !UUID.test(body.sectionId)) return { ok: false, error: "Potrero inválido" };
  if (!isValidDateOnly(body.date)) return { ok: false, error: "Fecha inválida (AAAA-MM-DD)" };
  if (body.date > today) return { ok: false, error: "La fecha no puede ser futura" };
  const oldest = `${Number(today.slice(0, 4)) - MAX_YEARS_BACK}${today.slice(4)}`;
  if (body.date < oldest) return { ok: false, error: `La fecha no puede ser anterior a ${MAX_YEARS_BACK} años` };
  return { ok: true, value: { sectionId: body.sectionId, date: body.date } };
}

/** Noon UTC keeps the stored instant on the same calendar day in every
 * Uruguayan/Argentine timezone, so "desde el 10" never reads as the 9th. */
export function occupancyTimestamp(date: string): string {
  return `${date}T12:00:00.000Z`;
}
