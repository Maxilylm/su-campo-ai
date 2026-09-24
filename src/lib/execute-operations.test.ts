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
type RpcError = { code?: string; message?: string; details?: string; hint?: string };
type RpcHandler = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;

// Without a handler every RPC is "not in the schema cache" (PGRST202), which
// sends executeOperations down the pre-051 sequential path.
const missingRpc: RpcHandler = async () => ({ data: null, error: { code: "PGRST202", message: "not mocked in this fake" } });

function makeFakeDb(seed: Record<string, Row[]> = {}, rpcHandler: RpcHandler = missingRpc) {
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
        return { data: singleMode ? matched[0] ?? null : matched, error: null };
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
    rpc: (name: string, args: Record<string, unknown>) => rpcHandler(name, args),
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

  it("applies nothing when any operation of the batch fails validation", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const rpc = vi.fn(missingRpc);
    const db = makeFakeDb({}, rpc);
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "sections", action: "insert", data: { name: "Sur" } },
      { table: "padrones", action: "insert", data: { name: "not a mutable table" } },
    ] as never);

    expect(logs).toEqual([
      "Error: no se aplicó insert sections porque otra operación del lote falló; no se guardó ningún cambio de esta propuesta.",
      "Error: unsupported AI operation insert on padrones",
    ]);
    expect(db.tables.sections ?? []).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
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

  it("rejects an update whose expectedUpdatedAt no longer matches the row (stale proposal)", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb({ sections: [{ id: "id-1", farm_id: FARM_A, name: "Norte", updated_at: "2026-09-19T00:00:00.000Z" }] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      {
        table: "sections",
        action: "update",
        data: { name: "Cambiado" },
        match: { id: "id-1" },
        expectedUpdatedAt: "2026-09-18T00:00:00.000Z", // stale: row's real updated_at moved on
      },
    ] as never);

    expect(logs).toEqual(["Error updating sections: el registro cambió desde que se propuso este cambio; pedí la propuesta de nuevo."]);
    expect(db.tables.sections[0].name).toBe("Norte");
  });

  it("applies an update whose expectedUpdatedAt still matches the row", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb({ sections: [{ id: "id-1", farm_id: FARM_A, name: "Norte", updated_at: "2026-09-19T00:00:00.000Z" }] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      {
        table: "sections",
        action: "update",
        data: { name: "Cambiado" },
        match: { id: "id-1" },
        expectedUpdatedAt: "2026-09-19T00:00:00.000Z",
      },
    ] as never);

    expect(logs).toEqual(["Updated sections: OK"]);
    expect(db.tables.sections[0].name).toBe("Cambiado");
  });

  it("rejects a delete whose expectedUpdatedAt no longer matches the row (stale proposal)", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb({ sections: [{ id: "id-1", farm_id: FARM_A, name: "Norte", updated_at: "2026-09-19T00:00:00.000Z" }] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "sections", action: "delete", data: {}, match: { id: "id-1" }, expectedUpdatedAt: "2026-09-18T00:00:00.000Z" },
    ] as never);

    expect(logs).toEqual(["Error deleting from sections: el registro cambió desde que se propuso este cambio; pedí la propuesta de nuevo."]);
    expect(db.tables.sections).toHaveLength(1);
  });

  it("rejects an update/delete on an updated_at-tracked table with no expectedUpdatedAt at all", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = makeFakeDb({ sections: [{ id: "id-1", farm_id: FARM_A, name: "Norte", updated_at: "2026-09-19T00:00:00.000Z" }] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    const executeOperations = await loadExecuteOperations();

    const logs = await executeOperations(FARM_A, [
      { table: "sections", action: "update", data: { name: "Cambiado" }, match: { id: "id-1" } },
    ] as never);

    expect(logs).toEqual(["Error updating sections: falta la marca de tiempo esperada; pedí la propuesta de nuevo."]);
    expect(db.tables.sections[0].name).toBe("Norte");
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

  describe("atomic batch (apply_ai_operations, migration 051)", () => {
    it("sends the validated batch in one call and logs each op from its result", async () => {
      const { getSupabaseAdmin } = await import("./supabase");
      const rpc = vi.fn<RpcHandler>(async () => ({
        data: {
          replayed: false,
          results: [
            { index: 0, kind: "insert", table: "sections", id: "sec-new" },
            { index: 1, kind: "insert", table: "cattle", id: "cat-new" },
            { index: 2, kind: "update", table: "sections", id: "id-1" },
          ],
        },
        error: null,
      }));
      const db = makeFakeDb({ sections: [{ id: "id-1", farm_id: FARM_A, name: "Norte", updated_at: "2026-09-19T00:00:00.000Z" }] }, rpc);
      vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
      const executeOperations = await loadExecuteOperations();

      const logs = await executeOperations(FARM_A, [
        { table: "sections", action: "insert", data: { name: "Nuevo", farm_id: FARM_B } },
        // The placeholder's section does not exist yet: the relation check
        // skips it and the RPC resolves it to the id it just created.
        { table: "cattle", action: "insert", data: { category: "vaca", count: 5, section_id: "NEW_SECTION_Nuevo" } },
        { table: "sections", action: "update", data: { name: "Norte 2" }, match: { id: "id-1" }, expectedUpdatedAt: "2026-09-19T00:00:00.000Z" },
      ] as never, undefined, "req-1");

      expect(logs).toEqual(["Inserted into sections: OK", "Inserted into cattle: OK", "Updated sections: OK"]);
      expect(rpc).toHaveBeenCalledTimes(1);
      const [name, args] = rpc.mock.calls[0];
      expect(name).toBe("apply_ai_operations");
      expect(args).toEqual({
        p_farm_id: FARM_A,
        p_idempotency_key: "ai-batch:req-1",
        p_ops: [
          { kind: "insert", table: "sections", data: { name: "Nuevo" }, placeholder: "NEW_SECTION_Nuevo" },
          { kind: "insert", table: "cattle", data: { category: "vaca", count: 5, section_id: "NEW_SECTION_Nuevo" } },
          { kind: "update", table: "sections", id: "id-1", data: { name: "Norte 2" }, expected_updated_at: "2026-09-19T00:00:00.000Z" },
        ],
      });
      // Nothing went through the per-table client.
      expect(db.tables.sections[0].name).toBe("Norte");
      expect(db.tables.cattle ?? []).toHaveLength(0);
    });

    it("reports the failing op and marks the rest as not applied when the transaction rolls back", async () => {
      const { getSupabaseAdmin } = await import("./supabase");
      const rpc = vi.fn<RpcHandler>(async () => ({
        data: null,
        error: { code: "P0001", message: "sections id-1 changed since the proposal", details: JSON.stringify({ op_index: 1 }), hint: "stale" },
      }));
      const db = makeFakeDb({ sections: [{ id: "id-1", farm_id: FARM_A, name: "Norte", updated_at: "2026-09-19T00:00:00.000Z" }] }, rpc);
      vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
      const executeOperations = await loadExecuteOperations();

      const logs = await executeOperations(FARM_A, [
        { table: "sections", action: "insert", data: { name: "Sur" } },
        { table: "sections", action: "delete", data: {}, match: { id: "id-1" }, expectedUpdatedAt: "2026-09-19T00:00:00.000Z" },
      ] as never);

      expect(logs).toEqual([
        "Error: no se aplicó insert sections porque otra operación del lote falló; no se guardó ningún cambio de esta propuesta.",
        "Error deleting from sections: el registro cambió desde que se propuso este cambio; pedí la propuesta de nuevo.",
      ]);
      expect(rpc.mock.calls[0][1].p_idempotency_key).toBeNull();
    });

    it("asks for a retry when the batch lost a deadlock", async () => {
      const { getSupabaseAdmin } = await import("./supabase");
      const rpc = vi.fn<RpcHandler>(async () => ({
        data: null,
        error: { code: "40P01", message: "deadlock detected", details: JSON.stringify({ op_index: 0 }), hint: "deadlock" },
      }));
      vi.mocked(getSupabaseAdmin).mockReturnValue(makeFakeDb({}, rpc) as never);
      const executeOperations = await loadExecuteOperations();

      const logs = await executeOperations(FARM_A, [{ table: "sections", action: "insert", data: { name: "Sur" } }] as never);

      expect(logs[0]).toMatch(/no se guardó ningún cambio, reintentá/);
      expect(logs.every((line) => line.startsWith("Error"))).toBe(true);
    });

    it("maps a cattle move's result from move_cattle's mode", async () => {
      const { getSupabaseAdmin } = await import("./supabase");
      const rpc = vi.fn<RpcHandler>(async () => ({
        data: { replayed: true, results: [{ index: 0, kind: "move", table: "cattle", move_mode: "split", moved_count: 12 }] },
        error: null,
      }));
      const db = makeFakeDb({
        sections: [{ id: "sec-2", farm_id: FARM_A, name: "Sur" }],
        cattle: [{ id: "cat-1", farm_id: FARM_A, section_id: "sec-1", count: 40, category: "novillo" }],
      }, rpc);
      vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
      const executeOperations = await loadExecuteOperations();

      const logs = await executeOperations(FARM_A, [
        { table: "cattle", action: "move", data: { section_id: "sec-2" }, match: { id: "cat-1" }, move_count: 12 },
      ] as never, undefined, "req-9");

      expect(logs).toEqual(["Moved 12 heads to new section: OK (atomic split)"]);
      expect(rpc.mock.calls[0][1].p_ops).toEqual([
        { kind: "move", source_id: "cat-1", destination_section_id: "sec-2", move_count: 12, idempotency_key: "req-9:move:0" },
      ]);
    });

    it("falls back to per-operation writes when the RPC is missing", async () => {
      const { getSupabaseAdmin } = await import("./supabase");
      const rpc = vi.fn(missingRpc);
      const db = makeFakeDb({}, rpc);
      vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
      const executeOperations = await loadExecuteOperations();

      const logs = await executeOperations(FARM_A, [{ table: "sections", action: "insert", data: { name: "Sur" } }] as never);

      expect(logs).toEqual(["Inserted into sections: OK"]);
      expect(rpc).toHaveBeenCalledWith("apply_ai_operations", expect.anything());
      expect(db.tables.sections).toHaveLength(1);
    });

    it("does not fall back when the RPC fails for any other reason", async () => {
      const { getSupabaseAdmin } = await import("./supabase");
      const rpc = vi.fn<RpcHandler>(async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }));
      const db = makeFakeDb({}, rpc);
      vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
      const executeOperations = await loadExecuteOperations();

      const logs = await executeOperations(FARM_A, [{ table: "sections", action: "insert", data: { name: "Sur" } }] as never);

      expect(logs[0]).toBe("Error: no se pudieron aplicar los cambios del asistente: duplicate key");
      expect(db.tables.sections ?? []).toHaveLength(0);
    });
  });
});
