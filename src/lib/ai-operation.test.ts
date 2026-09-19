import { describe, expect, it } from "vitest";
import { isInvalidAIOperation, normalizeAIOperations } from "./ai-operation";

describe("AI operation normalization", () => {
  it("keeps valid operations bounded and copies model objects", () => {
    const data = { title: "Revisar stock" };
    const [operation] = normalizeAIOperations([{ table: "tasks", action: "insert", data, move_count: "2" }]);
    expect(operation).toEqual({ table: "tasks", action: "insert", data, move_count: 2 });
    expect(operation.data).not.toBe(data);
  });

  it("turns malformed operations into safe rejected candidates", () => {
    const [missing, invalidMatch, invalidMove] = normalizeAIOperations([
      null,
      { table: "tasks", action: "insert", data: {}, match: "no" },
      { table: "cattle", action: "move", data: {}, move_count: 0 },
    ]);
    expect(isInvalidAIOperation(missing)).toBe(true);
    expect(isInvalidAIOperation(invalidMatch)).toBe(true);
    expect(isInvalidAIOperation(invalidMove)).toBe(true);
  });

  it("carries expectedUpdatedAt through when it's a non-empty string, rejects the op otherwise", () => {
    const [valid] = normalizeAIOperations([
      { table: "sections", action: "update", data: {}, match: { id: "s-1" }, expectedUpdatedAt: "2026-09-19T00:00:00.000Z" },
    ]);
    expect(valid).toEqual({
      table: "sections",
      action: "update",
      data: {},
      match: { id: "s-1" },
      expectedUpdatedAt: "2026-09-19T00:00:00.000Z",
    });

    const [emptyString, wrongType] = normalizeAIOperations([
      { table: "sections", action: "update", data: {}, expectedUpdatedAt: "" },
      { table: "sections", action: "update", data: {}, expectedUpdatedAt: 12345 },
    ]);
    expect(isInvalidAIOperation(emptyString)).toBe(true);
    expect(isInvalidAIOperation(wrongType)).toBe(true);
  });

  it("does not accept arrays or non-arrays as operation data", () => {
    expect(isInvalidAIOperation(normalizeAIOperations([{ table: "tasks", action: "insert", data: [] }])[0])).toBe(true);
    expect(normalizeAIOperations({ table: "tasks" })).toEqual([]);
  });
});
