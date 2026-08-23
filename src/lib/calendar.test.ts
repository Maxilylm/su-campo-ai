import { describe, it, expect } from "vitest";
import { buildFarmCalendarEvents, toICalendar } from "./calendar";

describe("farm calendar export", () => {
  it("builds sorted vaccination and harvest events", () => {
    const events = buildFarmCalendarEvents({
      farmName: "La Gloria",
      vaccinations: [
        { id: "v1", vaccine_name: "Aftosa", next_due: "2026-08-20T12:00:00Z", sections: { name: "Norte" } },
      ],
      crops: [
        { id: "c1", crop_type: "Soja", expected_harvest: "2026-08-18", actual_harvest: null, sections: null },
      ],
      tasks: [
        { id: "t1", title: "Revisar alambrado", description: "Llevar herramientas", due_date: "2026-08-19", priority: "high", status: "pending", sections: { name: "Norte" } },
        { id: "t2", title: "Tarea lista", description: null, due_date: "2026-08-17", priority: "medium", status: "completed" },
      ],
    });
    expect(events.map((event) => event.title)).toEqual(["Cosecha: Soja", "Tarea: Revisar alambrado", "Vacunación: Aftosa"]);
    expect(events[0].description).toContain("Cosecha prevista");
    expect(events[1].description).toContain("Prioridad alta");
    expect(events.map((event) => event.href)).toEqual([
      "/produccion/agricultura?cropId=c1",
      "/gestion/tareas?taskId=t1",
      "/produccion/sanidad?vaccinationId=v1",
    ]);
  });

  it("creates an all-day ICS file and escapes calendar text", () => {
    const ics = toICalendar([
      { uid: "1@campoai", title: "Cosecha, soja", description: "Norte; revisar\\nmaquinaria", date: "2026-08-18" },
    ], "Campo, La Gloria", new Date("2026-08-01T10:20:30.000Z"));
    expect(ics).toContain("X-WR-CALNAME:Campo\\, La Gloria");
    expect(ics).toContain("DTSTAMP:20260801T102030Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260818");
    expect(ics).toContain("DTEND;VALUE=DATE:20260819");
    expect(ics).toContain("SUMMARY:Cosecha\\, soja");
    expect(ics).toContain("DESCRIPTION:Norte\\; revisar\\\\nmaquinaria");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("resolves deep-links to absolute URLs for calendar apps", () => {
    const ics = toICalendar([
      { uid: "task-1@campoai", title: "Revisar alambrado", date: "2026-08-18", href: "/gestion/tareas?taskId=t1" },
    ], "Campo", new Date("2026-08-01T10:20:30.000Z"), "https://su-campo-ai.vercel.app");
    expect(ics).toContain("URL:https://su-campo-ai.vercel.app/gestion/tareas?taskId=t1");
  });

  it("skips completed harvests and invalid dates", () => {
    const ics = toICalendar([
      { uid: "bad", title: "Bad", date: "not-a-date" },
      { uid: "done", title: "Done", date: "2026-08-18" },
    ], "Campo");
    const events = buildFarmCalendarEvents({
      farmName: "Campo",
      vaccinations: [],
      crops: [{ id: "done", crop_type: "Soja", expected_harvest: "2026-08-18", actual_harvest: "2026-08-17" }],
      tasks: [{ id: "done-task", title: "Done", description: null, due_date: "2026-08-18", priority: "high", status: "completed" }],
    });
    expect(events).toEqual([]);
    expect(ics).not.toContain("SUMMARY:Bad");
  });
});
