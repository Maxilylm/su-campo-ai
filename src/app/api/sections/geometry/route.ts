import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isValidSectionMapCenter } from "@/lib/section-input";
import { padronOutlinePolygon } from "@/lib/geo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Place an existing potrero on the map: store its polygon and the padrón it
// lies in. The polygon is either drawn by hand (`mapCenter`) or, with
// `wholePadron: true`, the padrón's own outline, read here so the client
// never has to send (or trim) a cadastral shape. The full-record PUT on
// /api/sections stays untouched, so the Hacienda form can never clear a
// drawn shape by omission.
export async function PUT(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id, padronId, mapCenter, wholePadron } = parsed.data;
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ error: "Potrero inválido" }, { status: 400 });
  if (wholePadron !== undefined && typeof wholePadron !== "boolean") return NextResponse.json({ error: "wholePadron inválido" }, { status: 400 });
  if (typeof padronId !== "string" || !UUID.test(padronId)) {
    return NextResponse.json({ error: wholePadron ? "Elegí un padrón del campo." : "Dibujá el potrero dentro de un padrón del campo." }, { status: 400 });
  }
  if (!wholePadron && (!mapCenter || (mapCenter as { type?: unknown }).type !== "Polygon" || !isValidSectionMapCenter(mapCenter))) {
    return NextResponse.json({ error: "El área debe tener al menos 3 puntos." }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const padron = await withTimeout(
    db.from("padrones").select(wholePadron ? "id, geometry" : "id").eq("id", padronId).eq("farm_id", result.farmId).maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!padron) return NextResponse.json({ error: "El guardado tardó demasiado. Intentá nuevamente." }, { status: 504 });
  if (padron.error) return databaseFailure("section geometry padron lookup", padron.error);
  if (!padron.data) return NextResponse.json({ error: "El padrón no existe." }, { status: 404 });

  let shape = mapCenter;
  if (wholePadron) {
    shape = padronOutlinePolygon((padron.data as { geometry?: unknown }).geometry);
    if (!shape || !isValidSectionMapCenter(shape)) {
      return NextResponse.json({ error: "Ese padrón no tiene un contorno que se pueda usar. Dibujá el potrero a mano." }, { status: 422 });
    }
  }

  const update = await withTimeout(
    db.from("sections").update({ map_center: shape, padron_id: padronId }).eq("id", id).eq("farm_id", result.farmId).select("id").maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!update) return NextResponse.json({ error: "El guardado tardó demasiado. Intentá nuevamente." }, { status: 504 });
  if (update.error) return databaseFailure("section geometry update", update.error);
  if (!update.data) return NextResponse.json({ error: "El potrero no existe." }, { status: 404 });
  return NextResponse.json({ id });
}
