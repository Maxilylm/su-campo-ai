import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isValidSectionMapCenter } from "@/lib/section-input";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Draw an existing potrero on the map: store its polygon and the padrón it
// lies in. The full-record PUT on /api/sections stays untouched, so the
// Hacienda form can never clear a drawn shape by omission.
export async function PUT(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id, padronId, mapCenter } = parsed.data;
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ error: "Potrero inválido" }, { status: 400 });
  if (typeof padronId !== "string" || !UUID.test(padronId)) return NextResponse.json({ error: "Dibujá el potrero dentro de un padrón del campo." }, { status: 400 });
  if (!mapCenter || (mapCenter as { type?: unknown }).type !== "Polygon" || !isValidSectionMapCenter(mapCenter)) {
    return NextResponse.json({ error: "El área debe tener al menos 3 puntos." }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const padron = await withTimeout(
    db.from("padrones").select("id").eq("id", padronId).eq("farm_id", result.farmId).maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!padron) return NextResponse.json({ error: "El guardado tardó demasiado. Intentá nuevamente." }, { status: 504 });
  if (padron.error) return databaseFailure("section geometry padron lookup", padron.error);
  if (!padron.data) return NextResponse.json({ error: "El padrón no existe." }, { status: 404 });

  const update = await withTimeout(
    db.from("sections").update({ map_center: mapCenter, padron_id: padronId }).eq("id", id).eq("farm_id", result.farmId).select("id").maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!update) return NextResponse.json({ error: "El guardado tardó demasiado. Intentá nuevamente." }, { status: 504 });
  if (update.error) return databaseFailure("section geometry update", update.error);
  if (!update.data) return NextResponse.json({ error: "El potrero no existe." }, { status: 404 });
  return NextResponse.json({ id });
}
