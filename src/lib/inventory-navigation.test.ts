import { describe, expect, it } from "vitest";
import { filterCropsForSection, inventoryUseHref } from "./inventory-navigation";

describe("filterCropsForSection", () => {
  const crops = [
    { id: "north-crop", section_id: "north" },
    { id: "south-crop", section_id: "south" },
    { id: "unassigned-crop", section_id: null },
  ];

  it("keeps compatible and unassigned crops", () => {
    expect(filterCropsForSection(crops, "north").map((crop) => crop.id)).toEqual([
      "north-crop",
      "unassigned-crop",
    ]);
  });

  it("returns every crop when no section is selected", () => {
    expect(filterCropsForSection(crops, "")).toEqual(crops);
  });

  it("keeps a stale selected crop visible so it can be changed", () => {
    expect(filterCropsForSection(crops, "north", "south-crop").map((crop) => crop.id)).toEqual([
      "north-crop",
      "south-crop",
      "unassigned-crop",
    ]);
  });

  it("builds a contextual inventory-use link without forcing a quantity", () => {
    expect(inventoryUseHref({
      cropId: "crop-1",
      sectionId: "north",
      cattleId: null,
      itemName: "Glifosato",
      date: "2026-08-14",
      notes: "Aplicación herbicida: Glifosato",
    })).toBe("/gestion/inventario?use=1&cropId=crop-1&sectionId=north&itemName=Glifosato&date=2026-08-14&notes=Aplicaci%C3%B3n+herbicida%3A+Glifosato");
    expect(inventoryUseHref({ cattleId: "cattle-1", sectionId: "north", itemName: "Aftosa" })).toBe("/gestion/inventario?use=1&sectionId=north&cattleId=cattle-1&itemName=Aftosa");
  });
});
