import { afterEach, describe, expect, it } from "vitest";
import { AI_CONFIRMATION_TTL_MS, createAIConfirmation, verifyAIConfirmation } from "./ai-confirmation";
import { isAIHandoffReviewPrompt, isBareAIConfirmation, isExplicitAIConfirmation } from "./ai-confirmation-text";
import { requireAIConfirmation, type AIAction } from "./ai";

const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
});

describe("AI confirmation flow", () => {
  it("signs a proposal for one farm and rejects tampering or expiry", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    const now = 1_000_000;
    const proposal = createAIConfirmation("farm-a", [{ table: "tasks", action: "insert", data: { title: "Revisar aguada" } }], now);

    expect(verifyAIConfirmation(proposal.token, "farm-a", now)).toMatchObject({
      farmId: "farm-a",
      requestId: proposal.requestId,
      operations: [{ table: "tasks", action: "insert" }],
    });
    expect(verifyAIConfirmation(proposal.token, "farm-b", now)).toBeNull();
    expect(verifyAIConfirmation(proposal.token.replace(/.$/, "x"), "farm-a", now)).toBeNull();
    expect(verifyAIConfirmation(proposal.token, "farm-a", now + AI_CONFIRMATION_TTL_MS)).toBeNull();
  });

  it("converts a handoff write into a pending proposal", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    const action: AIAction = {
      intent: "update",
      response: "Encontré una tarea para registrar.",
      dbOperations: [{ table: "tasks", action: "insert", data: { title: "Revisar aguada" } }],
    };
    const result = requireAIConfirmation("farm-a", "REVISIÓN IA: no guardes cambios en esta respuesta.", action);

    expect(result.dbOperations).toEqual([]);
    expect(result.pendingConfirmationToken).toEqual(expect.any(String));
    expect(result.pendingConfirmationRequestId).toEqual(expect.any(String));
    expect(result.response).toContain("Todavía no guardé cambios");
  });

  it("recognizes only affirmative confirmation language", () => {
    expect(isAIHandoffReviewPrompt("no guardes cambios en esta respuesta")).toBe(true);
    expect(isExplicitAIConfirmation("Confirmo y guardá estos cambios")).toBe(true);
    expect(isExplicitAIConfirmation("Todavía no guardar nada")).toBe(false);
    expect(isBareAIConfirmation("Sí, aplicá")).toBe(true);
    expect(isBareAIConfirmation("Sí, aplicá registrar 20 vacas")).toBe(false);
  });
});
