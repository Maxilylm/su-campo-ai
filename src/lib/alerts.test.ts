import { describe, it, expect } from "vitest";
import { alertActionHref, buildAlerts, cropIdFromAlertId, expenseRegistrationHref, filterAlerts, healthIdFromAlertId, taskDraftFromAlert, taskIdFromAlertId, vaccinationIdFromAlertId, vaccinationRegistrationHref, type AlertInputs } from "./alerts";

const NOW = new Date("2026-06-14T12:00:00Z").getTime();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const empty: AlertInputs = { vaccinations: [], inventory: [], health: [], crops: [] };

describe("buildAlerts", () => {
  it("returns nothing when there is nothing to flag", () => {
    expect(buildAlerts(empty, NOW)).toEqual([]);
  });

  it("flags an overdue vaccination as high severity", () => {
    const a = buildAlerts({ ...empty, vaccinations: [{ id: "1", vaccine_name: "Aftosa", next_due: inDays(-3) }] }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("vaccination");
    expect(a[0].severity).toBe("high");
  });

  it("flags an upcoming vaccination as medium, ignores far-future ones", () => {
    const a = buildAlerts({ ...empty, vaccinations: [
      { id: "1", vaccine_name: "Brucelosis", next_due: inDays(10) },
      { id: "2", vaccine_name: "Rabia", next_due: inDays(99) },
    ] }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("medium");
  });

  it("flags low stock; out-of-stock is high", () => {
    const a = buildAlerts({ ...empty, inventory: [
      { id: "1", name: "Ración", current_stock: 2, min_stock: 10, unit: "kg" },
      { id: "2", name: "Vacuna", current_stock: 0, min_stock: 5, unit: "dosis" },
      { id: "3", name: "OK", current_stock: 50, min_stock: 10, unit: "kg" },
    ] }, NOW);
    expect(a.map((x) => x.kind)).toEqual(["stock", "stock"]);
    expect(a.find((x) => x.title.includes("Vacuna"))?.severity).toBe("high");
    expect(a.find((x) => x.title.includes("Vacuna"))?.inventoryId).toBe("2");
  });

  it("flags unresolved health events only", () => {
    const a = buildAlerts({ ...empty, health: [
      { id: "1", type: "enfermedad", description: "fiebre", resolved: false, section_id: "section-1", cattle_id: "cattle-1" },
      { id: "2", type: "lesion", description: "pata", resolved: true },
    ] }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("health");
    expect(a[0]).toMatchObject({ sectionId: "section-1", cattleId: "cattle-1" });
  });

  it("flags upcoming harvest, ignores harvested/failed/already-harvested", () => {
    const a = buildAlerts({ ...empty, crops: [
      { id: "1", crop_type: "soja", status: "growing", expected_harvest: inDays(5), actual_harvest: null },
      { id: "2", crop_type: "trigo", status: "harvested", expected_harvest: inDays(2), actual_harvest: inDays(-1) },
      { id: "3", crop_type: "maíz", status: "failed", expected_harvest: inDays(3), actual_harvest: null },
    ] }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("harvest");
  });

  it("sorts high severity before medium", () => {
    const a = buildAlerts({
      ...empty,
      vaccinations: [{ id: "1", vaccine_name: "A", next_due: inDays(10) }], // medium
      inventory: [{ id: "2", name: "X", current_stock: 0, min_stock: 5, unit: "kg" }], // high
    }, NOW);
    expect(a[0].severity).toBe("high");
    expect(a[1].severity).toBe("medium");
  });

  it("turns unsafe spray weather into an actionable alert", () => {
    const a = buildAlerts({ ...empty, weather: { wind: 34, precip: 0 } }, NOW);
    expect(a).toEqual([{
      id: "weather-spray",
      kind: "weather",
      severity: "high",
      title: "No pulverizar ahora",
      detail: "Viento fuerte (34 km/h) — riesgo de deriva",
      href: "/",
    }]);
  });

  it("filters the action center without changing alert order", () => {
    const alerts = buildAlerts({
      ...empty,
      health: [{ id: "h1", type: "revision", description: "Control", resolved: false }],
      inventory: [{ id: "i1", name: "Ración", current_stock: 0, min_stock: 5, unit: "kg" }],
    }, NOW);
    expect(filterAlerts(alerts, "all")).toEqual(alerts);
    expect(filterAlerts(alerts, "health").map((alert) => alert.kind)).toEqual(["health"]);
    expect(filterAlerts(alerts, "weather")).toEqual([]);
  });

  it("surfaces pending high-priority tasks as urgent alerts", () => {
    const alerts = buildAlerts({
      ...empty,
      tasks: [
        { id: "t1", title: "Revisar alambrado", due_date: inDays(4), priority: "high", status: "pending", sections: { name: "Norte" } },
        { id: "t2", title: "Tarea lista", due_date: inDays(1), priority: "high", status: "completed" },
      ],
    }, NOW);
    expect(alerts).toEqual([expect.objectContaining({ id: "tsk-t1", kind: "task", severity: "high", href: "/gestion/tareas" })]);
  });

  it("preserves a deadline when turning an alert into a task draft", () => {
    const [alert] = buildAlerts({
      ...empty,
      vaccinations: [{ id: "v1", vaccine_name: "Aftosa", next_due: "2026-06-20T12:00:00Z" }],
    }, NOW);
    expect(taskDraftFromAlert(alert)).toEqual({
      title: "Atender: Vacunación: Aftosa",
      description: "Vence en 6d (20/06)",
      dueDate: "2026-06-20",
      priority: "medium",
    });
  });

  it("preserves the source relation when turning an alert into a task draft", () => {
    const [alert] = buildAlerts({
      ...empty,
      crops: [{ id: "crop-1", crop_type: "soja", status: "growing", expected_harvest: "2026-06-20", actual_harvest: null, section_id: "section-1", sections: { name: "Norte" } }],
    }, NOW);
    expect(taskDraftFromAlert(alert)).toEqual({
      title: "Atender: Cosecha: soja",
      description: "En 6d (20/06) en Norte",
      dueDate: "2026-06-20",
      priority: "medium",
      sectionId: "section-1",
      cropId: "crop-1",
    });
  });

  it("keeps the cattle context when registering a vaccination from an alert", () => {
    expect(vaccinationRegistrationHref({
      id: "vac-v1",
      kind: "vaccination",
      severity: "high",
      title: "Vacunación: Aftosa",
      detail: "Vencida",
      href: "/produccion/sanidad",
      sectionId: "section-1",
      cattleId: "cattle-1",
    })).toBe("/produccion/sanidad?new=vaccination&vaccineName=Aftosa&sectionId=section-1&cattleId=cattle-1");
  });
});

describe("taskIdFromAlertId", () => {
  it("extracts task ids from task alerts only", () => {
    expect(taskIdFromAlertId("tsk-abc-123")).toBe("abc-123");
    expect(taskIdFromAlertId("vac-abc-123")).toBeNull();
    expect(taskIdFromAlertId("tsk-")).toBeNull();
  });
});

describe("alertActionHref", () => {
  it("opens the purchase form for a low-stock alert", () => {
    expect(alertActionHref({
      id: "stk-item-1", kind: "stock", severity: "high", title: "Stock bajo", detail: "0 kg", href: "/gestion/inventario", inventoryId: "item-1",
    })).toBe("/gestion/inventario?buy=1&itemId=item-1");
  });

  it("opens the exact task from a task alert", () => {
    expect(alertActionHref({
      id: "tsk-task-1", kind: "task", severity: "high", title: "Revisar alambrado", detail: "Vence hoy", href: "/gestion/tareas",
    })).toBe("/gestion/tareas?taskId=task-1");
  });

  it("opens exact health, harvest and vaccination records", () => {
    expect(alertActionHref({
      id: "hlt-health-1", kind: "health", severity: "medium", title: "Sanidad", detail: "Control", href: "/produccion/sanidad",
    })).toBe("/produccion/sanidad?healthId=health-1");
    expect(alertActionHref({
      id: "crp-crop-1", kind: "harvest", severity: "high", title: "Cosecha", detail: "Atrasada", href: "/produccion/agricultura", cropId: "crop-1",
    })).toBe("/produccion/agricultura?cropId=crop-1");
    expect(alertActionHref({
      id: "vac-vax-1", kind: "vaccination", severity: "high", title: "Vacunación", detail: "Vencida", href: "/produccion/sanidad",
    })).toBe("/produccion/sanidad?vaccinationId=vax-1");
  });

  it("prepares a vaccination registration with its source section", () => {
    expect(vaccinationRegistrationHref({
      id: "vac-vax-1", kind: "vaccination", severity: "high", title: "Vacunación: Aftosa", detail: "Vencida", href: "/produccion/sanidad", sectionId: "section-1",
    })).toBe("/produccion/sanidad?new=vaccination&vaccineName=Aftosa&sectionId=section-1");
    expect(vaccinationRegistrationHref({
      id: "hlt-health-1", kind: "health", severity: "medium", title: "Sanidad", detail: "Control", href: "/produccion/sanidad",
    })).toBeNull();
  });

  it("prepares veterinary expenses with source context", () => {
    expect(expenseRegistrationHref({
      id: "vac-vax-1", kind: "vaccination", severity: "high", title: "Vacunación: Aftosa", detail: "Vencida", href: "/produccion/sanidad", sectionId: "section-1", cattleId: "cattle-1",
    })).toBe("/gestion/finanzas?new=1&type=egreso&category=veterinario&description=Vacunaci%C3%B3n%3A+Aftosa&sectionId=section-1&cattleId=cattle-1");
    expect(expenseRegistrationHref({
      id: "hlt-health-1", kind: "health", severity: "medium", title: "Sanidad pendiente: enfermedad", detail: "Fiebre", href: "/produccion/sanidad", sectionId: "section-1",
    })).toBe("/gestion/finanzas?new=1&type=egreso&category=veterinario&description=Sanidad%3A+Fiebre&sectionId=section-1");
    expect(expenseRegistrationHref({
      id: "stk-item-1", kind: "stock", severity: "high", title: "Stock bajo", detail: "0 kg", href: "/gestion/inventario",
    })).toBeNull();
  });

  it("keeps normal deep links unchanged", () => {
    expect(alertActionHref({
      id: "weather-spray", kind: "weather", severity: "medium", title: "Clima", detail: "No pulverizar", href: "/",
    })).toBe("/");
  });
});

describe("healthIdFromAlertId", () => {
  it("extracts health event ids from health alerts only", () => {
    expect(healthIdFromAlertId("hlt-abc-123")).toBe("abc-123");
    expect(healthIdFromAlertId("tsk-abc-123")).toBeNull();
    expect(healthIdFromAlertId("hlt-")).toBeNull();
  });
});

describe("vaccinationIdFromAlertId", () => {
  it("extracts vaccination ids from vaccination alerts only", () => {
    expect(vaccinationIdFromAlertId("vac-abc-123")).toBe("abc-123");
    expect(vaccinationIdFromAlertId("hlt-abc-123")).toBeNull();
    expect(vaccinationIdFromAlertId("vac-")).toBeNull();
  });
});

describe("cropIdFromAlertId", () => {
  it("extracts crop ids from harvest alerts only", () => {
    expect(cropIdFromAlertId("crp-abc-123")).toBe("abc-123");
    expect(cropIdFromAlertId("hlt-abc-123")).toBeNull();
    expect(cropIdFromAlertId("crp-")).toBeNull();
  });
});

describe("taskDraftFromAlert", () => {
  it("does not duplicate an existing task as a new task", () => {
    expect(taskDraftFromAlert({
      id: "tsk-1", kind: "task", severity: "high", title: "Tarea", detail: "Vence hoy", href: "/gestion/tareas",
    })).toBeNull();
  });
});
