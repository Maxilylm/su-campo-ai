import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { moveErrorResponse, moveSummary, parseMoveRequest } from "@/lib/cattle-move";

// A whole-potrero move runs one RPC per batch; give it room beyond a single call.
export const maxDuration = 30;

function relatedName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name : null;
}

// Move head between potreros through the atomic move_cattle RPC (split or
// whole batch, row-locked, idempotent), the same path the assistant uses.
// A whole herd arrives as one request: the browser pays one round trip, not
// one per batch — live, per-batch requests took 3-8 s each and timed out.
// The grazing clock (045) updates via its trigger.
export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const request = parseMoveRequest(parsed.data);
  if (!request.ok) return NextResponse.json({ error: request.error }, { status: 400 });
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { sectionId, moves } = request.value;
  const cattleIds = moves.map((move) => move.cattleId);
  const lookup = await withTimeout(
    Promise.all([
      db.from("cattle").select("id, section_id, sections(name)").eq("farm_id", result.farmId).in("id", cattleIds),
      db.from("sections").select("id, name").eq("id", sectionId).eq("farm_id", result.farmId).maybeSingle(),
    ]),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!lookup) return NextResponse.json({ error: "El movimiento tardó demasiado. No se movió nada; intentá nuevamente." }, { status: 504 });
  const [sources, destination] = lookup;
  if (sources.error) return databaseFailure("cattle move source lookup", sources.error);
  if (destination.error) return databaseFailure("cattle move destination lookup", destination.error);
  if ((sources.data ?? []).length !== cattleIds.length) return NextResponse.json({ error: "Algún lote ya no existe. Actualizá la página." }, { status: 404 });
  if (!destination.data) return NextResponse.json({ error: "El potrero de destino no existe." }, { status: 404 });
  const fromName = relatedName(sources.data?.[0]?.sections);

  let movedCount = 0;
  let movedBatches = 0;
  for (const [index, move] of moves.entries()) {
    const moved = await withTimeout(
      db.rpc("move_cattle", {
        p_farm_id: result.farmId,
        p_source_cattle_id: move.cattleId,
        p_destination_section_id: sectionId,
        p_move_count: move.count,
        // Per batch, so a retry of the same request replays each move exactly once.
        p_idempotency_key: idempotencyKey ? `ui:${idempotencyKey}:${index}` : null,
      }).single(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!moved || moved.error) {
      const mapped = moved?.error ? moveErrorResponse(moved.error.message) : null;
      const done = movedCount > 0 ? ` Ya se movieron ${movedCount} cabezas; reintentá para completar el resto.` : "";
      if (!moved) return NextResponse.json({ error: `El movimiento tardó demasiado.${done || " Verificá el resultado antes de reintentar."}`, movedCount }, { status: 504 });
      if (mapped) return NextResponse.json({ error: `${mapped.error}${done}`, movedCount }, { status: mapped.status });
      return databaseFailure("cattle move", moved.error!);
    }
    const row = moved.data as { move_mode?: string; moved_count?: number } | null;
    if (row?.move_mode && row.move_mode !== "noop") {
      movedCount += row.moved_count ?? 0;
      movedBatches += 1;
    }
  }

  const summary = moveSummary(movedCount, movedBatches, fromName, destination.data.name);
  if (movedCount > 0) {
    // History is best-effort: the moves already committed.
    await withTimeout(
      db.from("activities").insert({ farm_id: result.farmId, type: "movement", description: summary, message_type: "text" }),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
  }
  return NextResponse.json({ movedCount, movedBatches, summary });
}
