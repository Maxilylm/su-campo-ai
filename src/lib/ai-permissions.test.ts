import { describe, expect, it } from "vitest";
import { enforceAIWriteAccess, type AIAction } from "./ai";

describe("AI write permissions", () => {
  it("keeps read-only questions available", () => {
    const action: AIAction = { intent: "query", response: "Hay 42 cabezas." };
    expect(enforceAIWriteAccess(action, false)).toEqual(action);
  });

  it("blocks model writes for viewers even if operations were returned", () => {
    const result = enforceAIWriteAccess({
      intent: "update",
      response: "Registré la tarea.",
      dbOperations: [{ table: "tasks", action: "insert", data: { title: "Revisar aguada" } }],
    }, false);

    expect(result.intent).toBe("help");
    expect(result.readOnlyBlocked).toBe(true);
    expect(result.dbOperations).toEqual([]);
    expect(result.response).toContain("solo lectura");
  });

  it("does not change editor actions", () => {
    const action: AIAction = { intent: "update", response: "Registré la tarea.", dbOperations: [] };
    expect(enforceAIWriteAccess(action, true)).toBe(action);
  });
});
