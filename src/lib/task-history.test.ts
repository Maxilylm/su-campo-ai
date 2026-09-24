import { describe, expect, it } from "vitest";
import { buildTaskHistory } from "./task-history";

const audit = (id: string, action: string, at: string, recordId = "t1") => ({ id, created_at: at, metadata: { action, record_id: recordId } });

describe("buildTaskHistory", () => {
  it("labels the audit rows newest first and marks the completion", () => {
    const history = buildTaskHistory(
      { id: "t1", status: "completed", created_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-03T08:00:00.500Z" },
      [
        audit("a3", "update", "2026-09-03T08:00:01Z"),
        audit("a2", "update", "2026-09-02T09:00:00Z"),
        audit("a1", "insert", "2026-09-01T10:00:00Z"),
      ],
    );
    expect(history.map((entry) => [entry.id, entry.label])).toEqual([
      ["a3", "Completada"],
      ["a2", "Actualizada"],
      ["a1", "Creada"],
    ]);
  });

  it("matches the completion to the closest update only", () => {
    const history = buildTaskHistory(
      { id: "t1", status: "completed", completed_at: "2026-09-03T08:00:03Z" },
      [audit("a", "update", "2026-09-03T08:00:00Z"), audit("b", "update", "2026-09-03T08:00:04Z")],
    );
    expect(history.filter((entry) => entry.label === "Completada").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("falls back to the task timestamps without audit rows", () => {
    const history = buildTaskHistory({ id: "t1", status: "completed", created_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-02T10:00:00Z" }, []);
    expect(history.map((entry) => entry.label)).toEqual(["Completada", "Creada"]);
  });

  it("ignores rows of other records, deletes and a reopened task's old completion", () => {
    const history = buildTaskHistory(
      { id: "t1", status: "pending", completed_at: null },
      [audit("x", "update", "2026-09-02T10:00:00Z", "t2"), audit("d", "delete", "2026-09-02T10:00:00Z"), audit("u", "update", "2026-09-02T11:00:00Z")],
    );
    expect(history.map((entry) => [entry.id, entry.label])).toEqual([["u", "Actualizada"]]);
  });
});
