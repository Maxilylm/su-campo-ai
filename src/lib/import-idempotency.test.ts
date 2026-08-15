import { describe, expect, it } from "vitest";
import { isCompleteImportBatch } from "./import-idempotency";

describe("isCompleteImportBatch", () => {
  it("recognizes every row in a committed batch", () => {
    expect(isCompleteImportBatch([{ import_row_index: 0 }, { import_row_index: 1 }], 2)).toBe(true);
  });

  it("rejects partial, duplicated, or out-of-order gaps", () => {
    expect(isCompleteImportBatch([{ import_row_index: 0 }], 2)).toBe(false);
    expect(isCompleteImportBatch([{ import_row_index: 0 }, { import_row_index: 0 }], 2)).toBe(false);
    expect(isCompleteImportBatch([{ import_row_index: 1 }, { import_row_index: 2 }], 2)).toBe(false);
  });
});
