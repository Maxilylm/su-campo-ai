// Validation and error mapping for moving head between potreros through the
// atomic move_cattle RPC. Pure so both are unit-tested.

export interface MoveRequest {
  cattleId: string;
  sectionId: string;
  count: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MOVE_COUNT = 1_000_000;

export function parseMoveRequest(body: Record<string, unknown>): { ok: true; value: MoveRequest } | { ok: false; error: string } {
  if (typeof body.cattleId !== "string" || !UUID.test(body.cattleId)) return { ok: false, error: "Lote inválido" };
  if (typeof body.sectionId !== "string" || !UUID.test(body.sectionId)) return { ok: false, error: "Potrero de destino inválido" };
  const count = typeof body.count === "string" ? Number(body.count) : body.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0 || count > MAX_MOVE_COUNT) {
    return { ok: false, error: "La cantidad debe ser un número entero mayor que cero" };
  }
  return { ok: true, value: { cattleId: body.cattleId, sectionId: body.sectionId, count } };
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

export function moveSummary(mode: string, moved: number, fromName: string | null, toName: string): string {
  if (mode === "noop") return `El lote ya estaba en ${toName}.`;
  return `Movidas ${moved} cabezas${fromName ? ` de ${fromName}` : ""} a ${toName}.`;
}
