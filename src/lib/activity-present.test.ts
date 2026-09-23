import { describe, expect, it } from "vitest";
import { humanizeActivityDescription, presentActivities } from "./activity";

const audit = (id: string, at: string, table = "cattle", action = "update") => ({
  id, type: "registration", created_at: at,
  description: `${action[0].toUpperCase()}${action.slice(1)} ${table.replace(/_/g, " ")} (e4ebcd70-37df-4075-8c68-1e9a132af34b)`,
  metadata: { table, action, record_id: "e4ebcd70-37df-4075-8c68-1e9a132af34b" },
});
const readable = (id: string, at: string, description: string) => ({ id, type: "movement", created_at: at, description, metadata: null });

describe("humanizeActivityDescription", () => {
  it("names the record and action in Spanish, without the id", () => {
    expect(humanizeActivityDescription(audit("1", "2026-09-23T10:00:00Z"))).toBe("Lote de hacienda actualizado");
    expect(humanizeActivityDescription(audit("2", "2026-09-23T10:00:00Z", "sections", "insert"))).toBe("Sección registrada");
    expect(humanizeActivityDescription(audit("3", "2026-09-23T10:00:00Z", "tasks", "delete"))).toBe("Tarea eliminada");
  });

  it("leaves readable descriptions alone", () => {
    expect(humanizeActivityDescription(readable("4", "2026-09-23T10:00:00Z", "Movidas 48 cabezas"))).toBe("Movidas 48 cabezas");
  });
});

describe("presentActivities", () => {
  it("drops audit rows that are side effects of a readable entry (the home feed seen live)", () => {
    const feed = presentActivities([
      readable("m", "2026-09-23T10:24:59Z", "Movidas 48 cabezas (2 lotes) de I-995 a Potrero Sur."),
      audit("a1", "2026-09-23T10:24:58Z"),
      audit("a2", "2026-09-23T10:24:57Z"),
    ]);
    expect(feed.map((item) => item.description)).toEqual(["Movidas 48 cabezas (2 lotes) de I-995 a Potrero Sur."]);
  });

  it("merges a burst of the same audit row and never shows an id", () => {
    const feed = presentActivities([
      audit("a1", "2026-09-23T10:00:05Z"),
      audit("a2", "2026-09-23T10:00:03Z"),
      audit("s1", "2026-09-23T09:00:00Z", "sections", "insert"),
    ]);
    expect(feed.map((item) => item.description)).toEqual(["Lote de hacienda actualizado (2 registros)", "Sección registrada"]);
    expect(feed.some((item) => /[0-9a-f]{8}-/.test(item.description))).toBe(false);
  });
});
