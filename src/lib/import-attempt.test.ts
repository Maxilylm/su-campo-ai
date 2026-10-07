import { describe, expect, it } from "vitest";
import { attemptAfter, attemptFor, classifyImportResponse } from "./import-attempt";

describe("import attempts", () => {
  let n = 0;
  const newKey = () => `k${++n}`;

  it("reuses the key only for the same rows to the same endpoint", () => {
    const first = attemptFor(null, "/api/cattle/import", "[1]", newKey);
    expect(attemptFor(first, "/api/cattle/import", "[1]", newKey)).toBe(first);
    expect(attemptFor(first, "/api/cattle/import", "[2]", newKey).key).not.toBe(first.key);
    expect(attemptFor(first, "/api/inventory/import", "[1]", newKey).key).not.toBe(first.key);
  });

  it("classifies responses", () => {
    expect(classifyImportResponse(200, true)).toBe("saved");
    expect(classifyImportResponse(400, true)).toBe("rejected");
    expect(classifyImportResponse(409, true)).toBe("rejected");
    expect(classifyImportResponse(429, true)).toBe("rejected");
    expect(classifyImportResponse(500, true)).toBe("uncertain");
    expect(classifyImportResponse(504, true)).toBe("uncertain");
    expect(classifyImportResponse(413, false)).toBe("uncertain");
  });

  it("remembers only uncertain attempts, so a definite rejection gets a new key", () => {
    const attempt = attemptFor(null, "/x", "[1]", newKey);
    expect(attemptAfter("uncertain", attempt)).toBe(attempt);
    expect(attemptAfter("rejected", attempt)).toBeNull();
    expect(attemptAfter("saved", attempt)).toBeNull();
    const retry = attemptFor(attemptAfter("rejected", attempt), "/x", "[1]", newKey);
    expect(retry.key).not.toBe(attempt.key);
  });
});
