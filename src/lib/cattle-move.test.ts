import { describe, expect, it } from "vitest";
import { moveErrorResponse, moveSummary, parseMoveRequest } from "./cattle-move";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseMoveRequest", () => {
  it("accepts ids and a positive whole count", () => {
    expect(parseMoveRequest({ cattleId: A, sectionId: B, count: 10 })).toEqual({ ok: true, value: { cattleId: A, sectionId: B, count: 10 } });
    expect(parseMoveRequest({ cattleId: A, sectionId: B, count: "5" })).toMatchObject({ ok: true, value: { count: 5 } });
  });

  it("rejects bad ids and counts", () => {
    expect(parseMoveRequest({ cattleId: "x", sectionId: B, count: 1 })).toEqual({ ok: false, error: "Lote inválido" });
    expect(parseMoveRequest({ cattleId: A, sectionId: "' or 1=1", count: 1 })).toMatchObject({ ok: false });
    for (const count of [0, -3, 1.5, "abc", null]) expect(parseMoveRequest({ cattleId: A, sectionId: B, count })).toMatchObject({ ok: false });
  });
});

describe("moveErrorResponse", () => {
  it("maps the RPC's expected exceptions and ignores the rest", () => {
    expect(moveErrorResponse("source cattle batch not found")?.status).toBe(404);
    expect(moveErrorResponse("destination section does not belong to farm")?.status).toBe(404);
    expect(moveErrorResponse("deadlock detected")).toBeNull();
  });
});

describe("moveSummary", () => {
  it("describes the move for the activity feed", () => {
    expect(moveSummary("split", 10, "Norte", "Sur")).toBe("Movidas 10 cabezas de Norte a Sur.");
    expect(moveSummary("noop", 0, "Sur", "Sur")).toBe("El lote ya estaba en Sur.");
  });
});
