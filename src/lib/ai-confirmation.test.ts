import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_CONFIRMATION_TTL_MS, confirmedAIProposalRequestId, createAIConfirmation, parsePendingAIConfirmation, verifyAIConfirmation } from "./ai-confirmation";
import { isAIHandoffReviewPrompt, isBareAIConfirmation, isExplicitAIConfirmation } from "./ai-confirmation-text";
import { requireAIConfirmation, type AIAction } from "./ai";

// requireAIConfirmation snapshots each update/delete target's updated_at
// from the DB before signing a confirmation token, so it needs a fake
// supabase client rather than a real network call.
vi.mock("./supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [{ id: "c-1", updated_at: "2026-09-19T00:00:00.000Z" }], error: null }),
        }),
      }),
    }),
  }),
}));

const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
});

describe("AI confirmation flow", () => {
  it("signs a proposal for one farm and rejects tampering or expiry", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    const now = 1_000_000;
    const proposal = createAIConfirmation("farm-a", "user-1", [{ table: "tasks", action: "insert", data: { title: "Revisar aguada" } }], now, "request-proposal-1234");

    expect(verifyAIConfirmation(proposal.token, "farm-a", "user-1", now)).toMatchObject({
      farmId: "farm-a",
      subjectId: "user-1",
      requestId: proposal.requestId,
      proposalRequestId: "request-proposal-1234",
      operations: [{ table: "tasks", action: "insert" }],
    });
    expect(verifyAIConfirmation(proposal.token, "farm-b", "user-1", now)).toBeNull();
    expect(verifyAIConfirmation(proposal.token, "farm-a", "user-2", now)).toBeNull();
    expect(verifyAIConfirmation(proposal.token.replace(/.$/, "x"), "farm-a", "user-1", now)).toBeNull();
    expect(verifyAIConfirmation(proposal.token, "farm-a", "user-1", now + AI_CONFIRMATION_TTL_MS)).toBeNull();
  });

  it("converts a handoff write into a pending proposal", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    const action: AIAction = {
      intent: "update",
      response: "Encontré una tarea para registrar.",
      dbOperations: [{ table: "tasks", action: "insert", data: { title: "Revisar aguada" } }],
    };
    const result = await requireAIConfirmation("farm-a", "user-1", "REVISIÓN IA: no guardes cambios en esta respuesta.", action);

    expect(result.dbOperations).toEqual([]);
    expect(result.pendingConfirmationToken).toEqual(expect.any(String));
    expect(result.pendingConfirmationRequestId).toEqual(expect.any(String));
    expect(result.pendingConfirmationProposalRequestId).toBeUndefined();
    expect(result.pendingConfirmationLinks).toEqual([{ label: "Tareas", href: "/gestion/tareas" }]);
    expect(result.response).toContain("Todavía no guardé cambios");
    expect(result.response).toContain("Afecta: Tareas");

    const requestBound = await requireAIConfirmation("farm-a", "user-1", "REVISIÓN IA: no guardes cambios en esta respuesta.", action, "request-proposal-1234");
    expect(requestBound.pendingConfirmationProposalRequestId).toBe("request-proposal-1234");
    const persisted = parsePendingAIConfirmation(requestBound, Date.now());
    expect(persisted?.proposalRequestId).toBe("request-proposal-1234");
    expect(persisted?.affectedLinks).toEqual([{ label: "Tareas", href: "/gestion/tareas" }]);
    expect(parsePendingAIConfirmation({ ...requestBound, pendingConfirmationExpiresAt: Date.now() - 1 }, Date.now())).toBeNull();
    expect(confirmedAIProposalRequestId({ confirmedProposalRequestId: "request-proposal-1234" })).toBe("request-proposal-1234");
  });

  it("holds model-proposed updates, deletes and moves for confirmation", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    for (const op of ["update", "delete", "move"]) {
      const action: AIAction = {
        intent: "update",
        response: "Listo.",
        dbOperations: [
          { table: "sections", action: "insert", data: { name: "Potrero 4" } },
          { table: "cattle", action: op, match: { id: "c-1" }, data: { count: 10 } },
        ],
      };
      const result = await requireAIConfirmation("farm-a", "user-1", "borrá el lote de novillos", action);
      expect(result.dbOperations, op).toEqual([]);
      expect(result.pendingConfirmationToken, op).toEqual(expect.any(String));

      // The updated_at snapshot taken while proposing must survive into the
      // signed token and come back out on verify -- update/delete on cattle
      // (an AI_UPDATED_AT_TABLES table) get it; move doesn't (out of scope,
      // already atomic via the move_cattle RPC).
      const verified = verifyAIConfirmation(result.pendingConfirmationToken!, "farm-a", "user-1");
      expect(verified?.operations[1].expectedUpdatedAt, op).toBe(
        op === "move" ? undefined : "2026-09-19T00:00:00.000Z",
      );
    }

    const insertOnly: AIAction = {
      intent: "update",
      response: "Registré la tarea.",
      dbOperations: [{ table: "tasks", action: "insert", data: { title: "Revisar aguada" } }],
    };
    expect(await requireAIConfirmation("farm-a", "user-1", "anotá revisar la aguada", insertOnly)).toBe(insertOnly);
  });

  // The structural rule above lets plain inserts through. These cover the
  // semantic gate layered on top of it, which only engages when a TypeSafe
  // key is configured — every assertion here is about an insert that would
  // otherwise have reached Supabase unattended.
  describe("Jev insert gate", () => {
    const insertOnly = (): AIAction => ({
      intent: "update",
      response: "Registré el egreso.",
      dbOperations: [{ table: "financial_transactions", action: "insert", data: { type: "egreso", amount: 450000 } }],
    });

    function jevAnswering(answers: unknown) {
      return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ model: "jev-1.13.0", answers }),
      } as unknown as Response);
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it("holds an insert whose data the message never mentioned", async () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
      vi.stubEnv("TYPESAFE_API_KEY", "test-key");
      vi.stubGlobal("fetch", jevAnswering({
        intencion: { type: "choice", choice: "registrar", confidence: 0.8, probabilities: { registrar: 0.8 } },
        coincide: { type: "noul", noul: 0.11 },
      }));

      const result = await requireAIConfirmation("farm-a", "user-1", "pagué la cuenta del veterinario", insertOnly());

      expect(result.dbOperations).toEqual([]);
      expect(result.pendingConfirmationToken).toEqual(expect.any(String));
      expect(result.response).toContain("no mencionaste");
    });

    it("holds an insert the model proposed while answering a question", async () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
      vi.stubEnv("TYPESAFE_API_KEY", "test-key");
      vi.stubGlobal("fetch", jevAnswering({
        intencion: { type: "choice", choice: "consultar", confidence: 0.99, probabilities: { consultar: 0.99 } },
        coincide: { type: "noul", noul: 0.05 },
      }));

      const result = await requireAIConfirmation("farm-a", "user-1", "¿cuántos novillos tengo?", insertOnly());

      expect(result.dbOperations).toEqual([]);
      expect(result.response).toContain("No estoy seguro");
    });

    it("applies an insert Jev vouches for, unchanged", async () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
      vi.stubEnv("TYPESAFE_API_KEY", "test-key");
      vi.stubGlobal("fetch", jevAnswering({
        intencion: { type: "choice", choice: "registrar", confidence: 1, probabilities: { registrar: 1 } },
        coincide: { type: "noul", noul: 0.75 },
      }));

      const action = insertOnly();
      expect(await requireAIConfirmation("farm-a", "user-1", "anotá que pagué 450000 al veterinario", action)).toBe(action);
    });

    it("does not consult Jev at all for a write that already needs confirmation", async () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
      vi.stubEnv("TYPESAFE_API_KEY", "test-key");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const action: AIAction = {
        intent: "update",
        response: "Borré el lote.",
        dbOperations: [{ table: "cattle", action: "delete", data: {}, match: { id: "c-1" } }],
      };
      const result = await requireAIConfirmation("farm-a", "user-1", "borrá el lote de novillos", action);

      expect(result.pendingConfirmationToken).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("recognizes only affirmative confirmation language", () => {
    expect(isAIHandoffReviewPrompt("no guardes cambios en esta respuesta")).toBe(true);
    expect(isExplicitAIConfirmation("Confirmo y guardá estos cambios")).toBe(true);
    expect(isExplicitAIConfirmation("Todavía no guardar nada")).toBe(false);
    expect(isBareAIConfirmation("Sí, aplicá")).toBe(true);
    expect(isBareAIConfirmation("Sí, aplicá registrar 20 vacas")).toBe(false);
  });

  it("treats only a whole-message confirmation as consent", () => {
    for (const text of ["Confirmá", "guardá", "Sí, confirmo.", "CONFIRMO", "Dale, aplicá los cambios", "confirmar propuesta"]) {
      expect(isExplicitAIConfirmation(text), text).toBe(true);
    }
    for (const text of [
      "Hoy se aplica urea en el lote 3",
      "Guardar 20 vacas en el potrero",
      "Confirmo, mové 10 novillos",
      "no confirmo",
      "confirmo que no",
      "",
    ]) {
      expect(isExplicitAIConfirmation(text), text).toBe(false);
    }
  });
});
