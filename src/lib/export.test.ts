import { describe, expect, it } from "vitest";
import { EXPORT_TIMEOUT_CODE, isExportTimeout, isMissingTasksTable } from "./export";

describe("isMissingTasksTable", () => {
  it("recognizes PostgREST and PostgreSQL missing-table errors", () => {
    expect(isMissingTasksTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTasksTable({ code: "42P01" })).toBe(true);
    expect(isMissingTasksTable({ message: 'relation "public.tasks" does not exist' })).toBe(true);
  });

  it("does not hide unrelated export failures", () => {
    expect(isMissingTasksTable({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTasksTable(null)).toBe(false);
  });
});

describe("isExportTimeout", () => {
  it("recognizes the local timeout sentinel without treating database timeouts as optional", () => {
    expect(isExportTimeout({ code: EXPORT_TIMEOUT_CODE })).toBe(true);
    expect(isExportTimeout({ code: "57014" })).toBe(false);
    expect(isExportTimeout(null)).toBe(false);
  });
});
