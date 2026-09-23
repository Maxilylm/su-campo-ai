import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { moveErrorResponse, moveSummary, parseMoveRequest } from "@/lib/cattle-move";

// Move head between potreros through the atomic move_cattle RPC (split or
// whole batch, row-locked, idempotent), the same path the assistant uses.
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
  const { cattleId, sectionId, count } = request.value;
  const lookup = await withTimeout(
    Promise.all([
      db.from("cattle").select("id, section_id, sections(name)").eq("id", cattleId).eq("farm_id", result.farmId).maybeSingle(),
      db.from("sections").select("id, name").eq("id", sectionId).eq("farm_id", result.farmId).maybeSingle(),
    ]),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!lookup) return NextResponse.json({ error: "El movimiento tardó demasiado. Verificá el resultado antes de reintentar." }, { status: 504 });
  const [source, destination] = lookup;
  if (source.error) return databaseFailure("cattle move source lookup", source.error);
  if (destination.error) return databaseFailure("cattle move destination lookup", destination.error);
  if (!source.data) return NextResponse.json({ error: "El lote ya no existe. Actualizá la página." }, { status: 404 });
  if (!destination.data) return NextResponse.json({ error: "El potrero de destino no existe." }, { status: 404 });

  const moved = await withTimeout(
    db.rpc("move_cattle", {
      p_farm_id: result.farmId,
      p_source_cattle_id: cattleId,
      p_destination_section_id: sectionId,
      p_move_count: count,
      p_idempotency_key: idempotencyKey ? `ui:${idempotencyKey}` : null,
    }).single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!moved) return NextResponse.json({ error: "El movimiento tardó demasiado. Verificá el resultado antes de reintentar." }, { status: 504 });
  if (moved.error) {
    const mapped = moveErrorResponse(moved.error.message);
    if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    return databaseFailure("cattle move", moved.error);
  }

  const row = moved.data as { move_mode?: string; moved_count?: number } | null;
  const mode = row?.move_mode ?? "noop";
  const sourceSection = source.data.sections as { name?: string } | { name?: string }[] | null;
  const fromName = (Array.isArray(sourceSection) ? sourceSection[0]?.name : sourceSection?.name) ?? null;
  const summary = moveSummary(mode, row?.moved_count ?? 0, fromName, destination.data.name);
  if (mode !== "noop") {
    // History is best-effort: the move itself already committed.
    await withTimeout(
      db.from("activities").insert({ farm_id: result.farmId, type: "movement", description: summary, message_type: "text" }),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
  }
  return NextResponse.json({ mode, movedCount: row?.moved_count ?? 0, summary });
}
