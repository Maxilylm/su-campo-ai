import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { splitPage } from "@/lib/pagination";

const MAX_PADRONES = 1000;

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "23505" || /duplicate key|unique constraint/i.test(error?.message || "");
}

function withoutSections(record: Record<string, unknown>) {
  const padron = { ...record };
  delete padron.sections;
  return padron;
}

function padronWriteTimeout(action: string) {
  return NextResponse.json(
    { error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "padron_write_timeout" },
    { status: 504 },
  );
}

// GET: list saved padrones
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResult = await withTimeout(
    db
      .from("padrones")
      .select("*, sections(id, name, color, map_center)", { count: "exact" })
      .eq("farm_id", result.farmId)
      .order("padron_code")
      .limit(MAX_PADRONES + 1),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!queryResult) return NextResponse.json({ error: "Los padrones tardaron demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, count, error } = queryResult;

  if (error) return databaseFailure("padrones GET", error);
  const page = splitPage(data || [], MAX_PADRONES);
  const response = NextResponse.json(page.items);
  response.headers.set("X-CampoAI-Padrones-Limit", String(MAX_PADRONES));
  if (page.hasMore || (count ?? 0) > MAX_PADRONES) response.headers.set("X-CampoAI-Padrones-Truncated", "true");
  return response;
}

// POST: save a padron from SNIG search
export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req, 650_000);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const db = getSupabaseAdmin();
  const padronCode = typeof body.padronCode === "string" ? body.padronCode.toUpperCase().trim() : "";
  const padronNumber = Number(body.padronNumber);
  const areaM2 = body.areaM2 == null || body.areaM2 === "" ? null : Number(body.areaM2);
  if (!/^[A-Z0-9]{1,8}-[A-Z0-9]{1,24}$/.test(padronCode)) return NextResponse.json({ error: "padronCode inválido" }, { status: 400 });
  if (!Number.isInteger(padronNumber) || padronNumber < 0) return NextResponse.json({ error: "padronNumber inválido" }, { status: 400 });
  if (areaM2 !== null && (!Number.isFinite(areaM2) || areaM2 <= 0)) return NextResponse.json({ error: "areaM2 inválida" }, { status: 400 });
  if (!body.geometry || typeof body.geometry !== "object" || Array.isArray(body.geometry) || typeof (body.geometry as { type?: unknown }).type !== "string" || !("coordinates" in body.geometry)) return NextResponse.json({ error: "geometry GeoJSON inválida" }, { status: 400 });
  if (JSON.stringify(body.geometry).length > 500_000) return NextResponse.json({ error: "geometry demasiado grande" }, { status: 413 });

  // Creating the padron and its initial section is one logical operation.
  // Prefer the database transaction; older projects fall back to the
  // compatibility path below until 018_padron_transaction.sql is applied.
  const atomicResult = await withTimeout(
    db.rpc("create_padron_with_section", {
      p_farm_id: result.farmId,
      p_padron_code: padronCode,
      p_padron_number: padronNumber,
      p_department_code: body.departmentCode || null,
      p_department_name: body.departmentName || null,
      p_area_m2: areaM2,
      p_geometry: body.geometry,
      ...(idempotencyKey ? { p_idempotency_key: idempotencyKey } : {}),
    }),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!atomicResult) return padronWriteTimeout("crear el padrón");
  const { data: atomicSetup, error: atomicError } = atomicResult;
  if (!atomicError) {
    if (atomicSetup && typeof atomicSetup === "object" && "padron" in atomicSetup && "section" in atomicSetup) {
      return NextResponse.json(atomicSetup);
    }
    return NextResponse.json({ error: "Supabase no devolvió el alta completa del padrón." }, { status: 503 });
  }
  if (atomicError.code !== "PGRST202") {
    console.error("Atomic padron setup failed:", atomicError.message);
    return NextResponse.json({ error: "No se pudo crear el padrón de forma segura." }, { status: 503 });
  }
  // Legacy projects may have the base map schema but not 018/019 yet. The
  // base schema still guarantees one padron per (farm, code) and one section
  // per (farm, name), so use those constraints as a safe compatibility key
  // until the transactional/idempotency migrations are applied.
  const findExistingPadron = async () => withTimeout(
    db
      .from("padrones")
      .select("*, sections(*)")
      .eq("farm_id", result.farmId)
      .eq("padron_code", padronCode)
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );

  let existingPadronResult = await findExistingPadron();
  if (!existingPadronResult) return padronWriteTimeout("verificar el padrón");
  if (existingPadronResult.error) return databaseFailure("padrones compatibility lookup", existingPadronResult.error);

  let padronRecord = existingPadronResult.data as (Record<string, unknown> & { sections?: unknown }) | null;
  let createdPadron = false;
  let existingSections = Array.isArray(padronRecord?.sections) ? padronRecord.sections : [];
  let padron = padronRecord ? withoutSections(padronRecord) : null;

  if (!padronRecord) {
    // Do not send the idempotency column to the legacy schema. Its unique
    // natural key handles concurrent first attempts; a conflict is resolved
    // by reading the winner below.
    const padronResult = await withTimeout(
      db
        .from("padrones")
        .insert({
          farm_id: result.farmId,
          padron_code: padronCode,
          padron_number: padronNumber,
          department_code: body.departmentCode,
          department_name: body.departmentName,
          area_m2: areaM2,
          geometry: body.geometry,
        })
        .select()
        .single(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!padronResult) return padronWriteTimeout("guardar el padrón");
    const { data: insertedPadron, error: padronErr } = padronResult;

    if (padronErr && !isUniqueViolation(padronErr)) return databaseFailure("padrones POST", padronErr);
    if (padronErr) {
      existingPadronResult = await findExistingPadron();
      if (!existingPadronResult) return padronWriteTimeout("resolver el padrón existente");
      if (existingPadronResult.error || !existingPadronResult.data) return databaseFailure("padrones compatibility conflict", existingPadronResult.error || { message: "padron conflict could not be resolved" });
      padronRecord = existingPadronResult.data as Record<string, unknown> & { sections?: unknown };
      existingSections = Array.isArray(padronRecord.sections) ? padronRecord.sections : [];
      padron = withoutSections(padronRecord);
    } else {
      padron = insertedPadron;
      createdPadron = true;
    }
  }

  if (!padron) return NextResponse.json({ error: "Supabase no devolvió el padrón creado." }, { status: 503 });
  if (existingSections.length > 0) return NextResponse.json({ padron, section: existingSections[0] });

  // Auto-create a section linked to this padron
  const sectionResult = await withTimeout(
    db
      .from("sections")
      .insert({
        farm_id: result.farmId,
        padron_id: padron.id,
        name: padronCode,
        size_hectares: areaM2 ? Math.round(areaM2 / 10000 * 10) / 10 : null,
        color: "#22c55e",
        water_status: "bueno",
        pasture_status: "bueno",
      })
      .select()
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!sectionResult) return padronWriteTimeout("crear la sección del padrón");
  const { data: section, error: secErr } = sectionResult;

  if (secErr && isUniqueViolation(secErr)) {
    // A concurrent retry may have created the section between the lookup and
    // this insert. The base unique (farm_id, name) constraint makes resolving
    // the existing row safe without creating a duplicate.
    const existingSectionResult = await withTimeout(
      db
        .from("sections")
        .select("*")
        .eq("farm_id", result.farmId)
        .eq("name", padronCode)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingSectionResult) return padronWriteTimeout("resolver la sección existente");
    if (existingSectionResult.error) return databaseFailure("padrones section conflict", existingSectionResult.error);
    if (existingSectionResult.data && String(existingSectionResult.data.padron_id) === String(padron.id)) {
      return NextResponse.json({ padron, section: existingSectionResult.data });
    }
    return NextResponse.json({
      error: "Ya existe una sección con el nombre de este padrón.",
      code: "padron_section_name_conflict",
    }, { status: 409 });
  }

  if (secErr) {
    console.error("Section creation error:", secErr);
    if (createdPadron) {
      await withTimeout(
        db.from("padrones").delete().eq("id", padron.id).eq("farm_id", result.farmId),
        SUPABASE_READ_TIMEOUT_MS,
        null,
      );
    }
    return NextResponse.json({ error: "No se pudo crear la sección del padrón." }, { status: 500 });
  }

  return NextResponse.json({ padron, section });
}

// POST subsection: create a sub-section for a padron
export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const db = getSupabaseAdmin();
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sizeHectares = body.sizeHectares == null || body.sizeHectares === "" ? null : Number(body.sizeHectares);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (sizeHectares !== null && (!Number.isFinite(sizeHectares) || sizeHectares <= 0)) return NextResponse.json({ error: "sizeHectares inválido" }, { status: 400 });

  // The referenced padron must belong to the caller's farm.
  const padronLookup = await withTimeout(
    db
      .from("padrones")
      .select("id")
      .eq("id", body.padronId)
      .eq("farm_id", result.farmId)
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!padronLookup) return padronWriteTimeout("verificar el padrón");
  const { data: padron, error: padronError } = padronLookup;
  if (padronError && padronError.code !== "PGRST116") return databaseFailure("padrones section lookup", padronError);
  if (!padron) {
    return NextResponse.json({ error: "Padron no encontrado" }, { status: 404 });
  }

  let idempotencyColumnAvailable = Boolean(idempotencyKey);
  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db.from("sections").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return padronWriteTimeout("verificar el reintento de la sección");
    if (existingLookup.error && !["PGRST204", "PGRST205"].includes(existingLookup.error.code || "")) {
      return databaseFailure("padrones subsection idempotency lookup", existingLookup.error);
    }
    idempotencyColumnAvailable = !existingLookup.error;
    if (existingLookup.data) return NextResponse.json(existingLookup.data);
  }

  // Create a sub-section linked to the padron
  const sectionResult = await withTimeout(
    db
      .from("sections")
      .insert({
        farm_id: result.farmId,
        padron_id: body.padronId,
        name,
        size_hectares: sizeHectares,
        color: body.color || "#22c55e",
        map_center: body.mapCenter || null,
        water_status: "bueno",
        pasture_status: "bueno",
        ...(idempotencyKey && idempotencyColumnAvailable ? { idempotency_key: idempotencyKey } : {}),
      })
      .select()
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!sectionResult) return padronWriteTimeout("crear la sección del padrón");
  let resolvedSectionResult: NonNullable<typeof sectionResult> = sectionResult;
  if (resolvedSectionResult.error?.code === "PGRST204" && idempotencyKey && idempotencyColumnAvailable) {
    const legacyPayload = {
      farm_id: result.farmId,
      padron_id: body.padronId,
      name,
      size_hectares: sizeHectares,
      color: body.color || "#22c55e",
      map_center: body.mapCenter || null,
      water_status: "bueno",
      pasture_status: "bueno",
    };
    const legacySectionResult = await withTimeout(
      db.from("sections").insert(legacyPayload).select().single(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!legacySectionResult) return padronWriteTimeout("crear la sección del padrón");
    resolvedSectionResult = legacySectionResult;
  }
  const { data, error } = resolvedSectionResult;

  if (error?.code === "23505" && idempotencyKey && idempotencyColumnAvailable) {
    const replay = await withTimeout(
      db.from("sections").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replay) return padronWriteTimeout("resolver el reintento de la sección");
    if (replay.error) return databaseFailure("padrones subsection idempotency replay", replay.error);
    if (replay.data) return NextResponse.json(replay.data);
  }

  if (error) return databaseFailure("padrones PUT", error);
  return NextResponse.json(data);
}

// DELETE: remove a padron and its linked sections
export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();

  // Unlink sections first (set padron_id to null)
  const unlinkResult = await withTimeout(
    db.from("sections").update({ padron_id: null }).eq("padron_id", id).eq("farm_id", result.farmId),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!unlinkResult) return padronWriteTimeout("desvincular las secciones del padrón");
  const { error: unlinkError } = unlinkResult;
  if (unlinkError) return databaseFailure("padrones section unlink", unlinkError);

  const deleteResult = await withTimeout(
    db.from("padrones")
      .delete()
      .eq("id", id)
      .eq("farm_id", result.farmId)
      .select("id")
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!deleteResult) return padronWriteTimeout("eliminar el padrón");
  const { data: deleted, error } = deleteResult;
  if (error) return databaseFailure("padrones DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Padrón no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
