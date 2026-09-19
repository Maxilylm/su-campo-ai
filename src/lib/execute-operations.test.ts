import { beforeEach, describe, expect, it, vi } from "vitest";

// executeOperations always calls getSupabaseAdmin() (ai.ts) and, for relation
// checks, auth.ts's validateFarmRelations does too — both import from this
// module, so mocking it once here intercepts both.
vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn() }));

type Row = Record<string, unknown>;
type QueryError = { code?: string; message?: string } | null;

/** Minimal chainable fake standing in for the supabase-js query builder,
 * covering exactly the calls executeOperations and validateFarmRelations
 * make: insert().select().single(), update()/delete() filtered by .eq(),
 * and select().eq().maybeSingle()/.single(). */
function makeFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  let idCounter = 0;

  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    const filters: [string, unknown][] = [];
    let singleMode: "single" | "maybeSingle" | null = null;

    const applyFilters = () => tables[table].filter((row) => filters.every(([key, val]) => row[key] === val));

    function finalize(): { data: unknown; error: QueryError } {
      if (mode === "insert") {
        const rows = Array.isArray(payload) ? payload : [payload as Row];
        const created = rows.map((row) => ({ id: `id-${++idCounter}`, ...row }));
        tables[table].push(...created);
        return { data: singleMode ? created[0] : created, error: null };
      }
      if (mode === "update") {
        const matched = applyFilters();
        matched.forEach((row) => Object.assign(row, payload));
        return { data: singleMode ? matched[0] ?? null : matched, error: null };
      }
      if (mode === "delete") {
        const matched = applyFilters();
        for (const row of matched) tables[table].splice(tables[table].indexOf(row), 1);
        return { data: null, error: null };
      }
      const matched = applyFilters();
      if (singleMode === "single") {
        return matched[0] ? { data: matched[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      }
      if (singleMode === "maybeSingle") return { data: matched[0] ?? null, error: null };
      return { data: matched, error: null };
    }

    const builder = {
      select() { return builder; },
      insert(rows: Row | Row[]) { mode = "insert"; payload = rows; return builder; },
      update(data: Row) { mode = "update"; payload = data; return builder; },
      delete() { mode = "delete"; return builder; },
      eq(key: string, val: unknown) { filters.push([key, val]); return builder; },
      limit() { return builder; },
      single() { singleMode = "single"; return Promise.resolve(finalize()); },
      maybeSingle() { singleMode = "maybeSingle"; return Promise.resolve(finalize()); },
      then(resolve: (value: { data: unknown; error: QueryError }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(finalize()).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    from,
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "not mocked in this fake" } }),
    tables,
  };
}

const FARM_A = "11111111-1111-1111-1111-111111111111";
const FARM_B = "22222222-2222-2222-2222-222222222222";

async function loadExecuteOperations() {
  const { executeOperations } = await import("./ai");
  return executeOperations;
}

describe("executeOperations", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("forces farm_id on insert instead of trusting the model's data.farm_id", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb();
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "sections", action: "insert", data: { name: "Norte", farm_id: FARM_B } },
    ] as never);

    expect(logs).toEqual(["Inserted into sections: OK"]);
    expect(db.tables.sections).toHaveLength(1);
    expect(db.tables.sections[0].farm_id).toBe(FARM_A);
  });

  it("resolves a NEW_SECTION_ placeholder to the real id created earlier in the same batch", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb();
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "sections", action: "insert", data: { name: "Norte" } },
      { table: "cattle", action: "insert", data: { category: "vaca", count: 5, section_id: "NEW_SECTION_Norte" } },
    ] as never);

    expect(logs).toEqual(["Inserted into sections: OK", "Inserted into cattle: OK"]);
    const createdSection = db.tables.sections[0];
    expect(db.tables.cattle[0].section_id).toBe(createdSection.id);
  });

  it("rejects a reference to a section that belongs to a different farm", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const foreignSectionId = "id-foreign-section";
    const db = makeFakeDb({ sections: [{ id: foreignSectionId, farm_id: FARM_B, name: "Ajena" }] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "cattle", action: "insert", data: { category: "vaca", count: 5, section_id: foreignSectionId } },
    ] as never);

    expect(logs).toEqual(["Error: AI reference sections does not belong to this farm"]);
    expect(db.tables.cattle ?? []).toHaveLength(0);
  });

  it("continues the batch after one operation fails (partial batch)", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb();
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "padrones", action: "insert", data: { name: "not a mutable table" } },
      { table: "sections", action: "insert", data: { name: "Sur" } },
    ] as never);

    expect(logs).toEqual([
      "Error: unsupported AI operation insert on padrones",
      "Inserted into sections: OK",
    ]);
    expect(db.tables.sections).toHaveLength(1);
  });

  it("treats non-array/malformed operations as an empty batch instead of throwing", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb();
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    await expect(executeOperations(FARM_A, "not an array" as never)).resolves.toEqual([]);
    await expect(executeOperations(FARM_A, null as never)).resolves.toEqual([]);
  });

  it("rejects an update/delete match that doesn't target exactly one id", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb({ sections: [{ id: "id-1", farm_id: FARM_A, name: "Norte" }] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "sections", action: "update", data: { name: "Cambiado" }, match: { id: "id-1", name: "Norte" } },
    ] as never);

    expect(logs).toEqual(["Error: invalid AI target for sections: match must target one id"]);
    expect(db.tables.sections[0].name).toBe("Norte");
  });

  it("rejects move on a non-cattle table instead of silently no-op'ing", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb({ sections: [{ id: "id-1", farm_id: FARM_A, name: "Norte" }] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "sections", action: "move", match: { id: "id-1" }, data: {} },
    ] as never);

    expect(logs).toEqual(["Error: move is only supported for cattle, not sections"]);
  });

  it("strips fields not on the table's column allowlist before insert", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb();
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "sections", action: "insert", data: { name: "Norte", owner_phone: "+59899000000", is_admin: true } },
    ] as never);

    expect(logs).toEqual(["Inserted into sections: OK"]);
    expect(db.tables.sections[0]).not.toHaveProperty("owner_phone");
    expect(db.tables.sections[0]).not.toHaveProperty("is_admin");
  });
});
