// Validation and error mapping for moving head between potreros through the
// atomic move_cattle RPC. Pure so both are unit-tested.

export interface MoveRequest {
  sectionId: string;
  /** One entry per batch; a whole-potrero move sends every batch at once. */
  moves: { cattleId: string; count: number }[];
}

const MAX_BATCHES_PER_MOVE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MOVE_COUNT = 1_000_000;

function parseCount(value: unknown): number | null {
  const count = typeof value === "string" ? Number(value) : value;
  return typeof count === "number" && Number.isInteger(count) && count > 0 && count <= MAX_MOVE_COUNT ? count : null;
}

/** Accepts a single batch `{ cattleId, count, sectionId }` or a whole herd
 * `{ moves: [{ cattleId, count }], sectionId }`. */
export function parseMoveRequest(body: Record<string, unknown>): { ok: true; value: MoveRequest } | { ok: false; error: string } {
  if (typeof body.sectionId !== "string" || !UUID.test(body.sectionId)) return { ok: false, error: "Potrero de destino inválido" };
  const rawMoves = Array.isArray(body.moves) ? body.moves : [{ cattleId: body.cattleId, count: body.count }];
  if (rawMoves.length === 0 || rawMoves.length > MAX_BATCHES_PER_MOVE) return { ok: false, error: "Cantidad de lotes inválida" };
  const moves: MoveRequest["moves"] = [];
  const seen = new Set<string>();
  for (const raw of rawMoves) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    if (typeof entry.cattleId !== "string" || !UUID.test(entry.cattleId) || seen.has(entry.cattleId)) return { ok: false, error: "Lote inválido" };
    const count = parseCount(entry.count);
    if (count === null) return { ok: false, error: "La cantidad debe ser un número entero mayor que cero" };
    seen.add(entry.cattleId);
    moves.push({ cattleId: entry.cattleId, count });
  }
  return { ok: true, value: { sectionId: body.sectionId, moves } };
}

/** move_cattle raises plain exceptions; turn the expected ones into a user
 * message and status, and leave anything else to the generic failure path. */
export function moveErrorResponse(message: string | undefined): { status: number; error: string } | null {
  if (!message) return null;
  if (message.includes("source cattle batch not found")) return { status: 404, error: "El lote ya no existe. Actualizá la página." };
  if (message.includes("destination section does not belong to farm")) return { status: 404, error: "El potrero de destino no existe." };
  if (message.includes("move count must be positive")) return { status: 400, error: "La cantidad debe ser mayor que cero" };
  return null;
}

export function moveSummary(moved: number, batches: number, fromName: string | null, toName: string): string {
  if (moved === 0) return `La hacienda ya estaba en ${toName}.`;
  return `Movidas ${moved} cabezas${batches > 1 ? ` (${batches} lotes)` : ""}${fromName ? ` de ${fromName}` : ""} a ${toName}.`;
}
