import { describe, it, expect } from "vitest";
import { buildAgenda, groupAgendaByDay } from "./agenda";

const DAY = 86_400_000;
// Fixed "now": 2026-08-14 12:00 UTC
const NOW = Date.UTC(2026, 7, 14, 12);

const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const emptyInputs = { vaccinations: [], crops: [] };

describe("buildAgenda", () => {
  it("includes upcoming vaccinations with positive daysFromNow and a day-precision date", () => {
    const items = buildAgenda(
      {
        ...emptyInputs,
        vaccinations: [
          { id: "v1", vaccine_name: "Aftosa", next_due: iso(5), head_count: 30, sections: { name: "Norte" } },
        ],
      },
      NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "vac-v1",
      kind: "vaccination",
      daysFromNow: 5,
      date: "2026-08-19",
      href: "/produccion/sanidad",
    });
    expect(items[0].title).toContain("Aftosa");
    expect(items[0].detail).toContain("Norte");
    expect(items[0].detail).toContain("30");
  });

  it("includes overdue vaccinations with negative daysFromNow", () => {
    const items = buildAgenda(
      {
        ...emptyInputs,
        vaccinations: [{ id: "v1", vaccine_name: "Rabia", next_due: iso(-3), head_count: 1, sections: null }],
      },
      NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0].daysFromNow).toBe(-3);
  });

  it("excludes vaccinations with no due date or beyond the horizon", () => {
    const items = buildAgenda(
      {
        ...emptyInputs,
        vaccinations: [
          { id: "v1", vaccine_name: "Aftosa", next_due: null, head_count: 1, sections: null },
          { id: "v2", vaccine_name: "Aftosa", next_due: iso(61), head_count: 1, sections: null },
          { id: "v3", vaccine_name: "Aftosa", next_due: iso(60), head_count: 1, sections: null },
        ],
      },
      NOW,
      60
    );
    expect(items.map((i) => i.id)).toEqual(["vac-v3"]);
  });

  it("includes pending expected harvests but not completed or failed crops", () => {
    const items = buildAgenda(
      {
        ...emptyInputs,
        crops: [
          { id: "c1", crop_type: "soja", status: "growing", expected_harvest: iso(10), actual_harvest: null, sections: { name: "Sur" } },
          { id: "c2", crop_type: "maiz", status: "harvested", expected_harvest: iso(10), actual_harvest: iso(-1), sections: null },
          { id: "c3", crop_type: "trigo", status: "failed", expected_harvest: iso(10), actual_harvest: null, sections: null },
          { id: "c4", crop_type: "avena", status: "growing", expected_harvest: null, actual_harvest: null, sections: null },
        ],
      },
      NOW
    );
    expect(items.map((i) => i.id)).toEqual(["har-c1"]);
    expect(items[0]).toMatchObject({ kind: "harvest", href: "/produccion/agricultura", daysFromNow: 10 });
    expect(items[0].title.toLowerCase()).toContain("soja");
  });

  it("sorts items by date ascending across kinds", () => {
    const items = buildAgenda(
      {
        vaccinations: [{ id: "v1", vaccine_name: "Aftosa", next_due: iso(7), head_count: 1, sections: null }],
        crops: [
          { id: "c1", crop_type: "soja", status: "growing", expected_harvest: iso(2), actual_harvest: null, sections: null },
        ],
      },
      NOW
    );
    expect(items.map((i) => i.id)).toEqual(["har-c1", "vac-v1"]);
  });
});

describe("groupAgendaByDay", () => {
  it("splits overdue items from dated future groups, keeping group order", () => {
    const items = buildAgenda(
      {
        vaccinations: [
          { id: "v1", vaccine_name: "Aftosa", next_due: iso(-2), head_count: 1, sections: null },
          { id: "v2", vaccine_name: "Rabia", next_due: iso(3), head_count: 1, sections: null },
          { id: "v3", vaccine_name: "Carbunclo", next_due: iso(3), head_count: 1, sections: null },
        ],
        crops: [
          { id: "c1", crop_type: "soja", status: "growing", expected_harvest: iso(9), actual_harvest: null, sections: null },
        ],
      },
      NOW
    );
    const { overdue, days } = groupAgendaByDay(items);
    expect(overdue.map((i) => i.id)).toEqual(["vac-v1"]);
    expect(days.map((d) => d.date)).toEqual(["2026-08-17", "2026-08-23"]);
    expect(days[0].items.map((i) => i.id)).toEqual(["vac-v2", "vac-v3"]);
  });

  it("counts today as a future day group, not overdue", () => {
    const items = buildAgenda(
      {
        ...emptyInputs,
        vaccinations: [{ id: "v1", vaccine_name: "Aftosa", next_due: iso(0), head_count: 1, sections: null }],
      },
      NOW
    );
    const { overdue, days } = groupAgendaByDay(items);
    expect(overdue).toHaveLength(0);
    expect(days).toHaveLength(1);
    expect(days[0].items[0].daysFromNow).toBe(0);
  });
});
