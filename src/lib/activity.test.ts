import { describe, expect, it } from "vitest";
import { activityHref, filterActivities } from "./activity";

const activities = [
  { id: "1", type: "health", description: "Control sanitario" },
  { id: "2", type: "movement", description: "Movimiento de lote" },
  { id: "3", type: "health", description: "Tratamiento" },
];

describe("filterActivities", () => {
  it("returns all activities without changing their order", () => {
    expect(filterActivities(activities, "all")).toEqual(activities);
  });

  it("keeps only the selected activity type", () => {
    expect(filterActivities(activities, "health").map((activity) => activity.id)).toEqual(["1", "3"]);
  });

  it("returns an empty list for a type with no activity", () => {
    expect(filterActivities(activities, "setup")).toEqual([]);
  });

  it("searches descriptions without changing the filtered order", () => {
    expect(filterActivities(activities, "all", "  SANITARIO ").map((activity) => activity.id)).toEqual(["1"]);
    expect(filterActivities(activities, "health", "tratamiento").map((activity) => activity.id)).toEqual(["3"]);
    expect(filterActivities(activities, "all", "inexistente")).toEqual([]);
  });
});

describe("activityHref", () => {
  it("maps audit metadata to the owning module", () => {
    expect(activityHref({ metadata: { table: "cattle", record_id: "batch/1" } })).toBe("/produccion/hacienda?cattleId=batch%2F1");
    expect(activityHref({ metadata: { table: "health_events", record_id: "health-1" } })).toBe("/produccion/sanidad?healthId=health-1");
    expect(activityHref({ metadata: { table: "financial_transactions", record_id: "tx-1" } })).toBe("/gestion/finanzas?transactionId=tx-1");
    expect(activityHref({ metadata: { table: "inventory_movements", record_id: "movement-1" } })).toBe("/gestion/inventario?movementId=movement-1");
    expect(activityHref({ metadata: { table: "crop_applications", record_id: "application-1" } })).toBe("/produccion/agricultura?applicationId=application-1");
    expect(activityHref({ metadata: { table: "weight_records", record_id: "weight-1" } })).toBe("/produccion/peso?weightId=weight-1");
    expect(activityHref({ metadata: { table: "padrones", record_id: "padron-1" } })).toBe("/mapa?padronId=padron-1");
    expect(activityHref({ metadata: { table: "map_features", record_id: "feature-1" } })).toBe("/mapa?featureId=feature-1");
    expect(activityHref({ metadata: { table: "map_features" } })).toBe("/mapa");
    expect(activityHref({ metadata: null })).toBeNull();
  });
});
