import { describe, expect, it } from "vitest";
import { AI_CONTEXT_LABELS, AI_CONTEXT_LIMITS, boundAIContextRows, messageNeedsFinancialContext, messageNeedsInventoryContext, messageNeedsMapContext, messageNeedsWeatherContext } from "./ai-context";

describe("AI context bounds", () => {
  it("keeps the requested limit and reports omitted rows", () => {
    expect(boundAIContextRows(["a", "b", "c"], 2)).toEqual({ items: ["a", "b"], truncated: true });
    expect(boundAIContextRows(["a", "b"], 2)).toEqual({ items: ["a", "b"], truncated: false });
  });

  it("normalizes missing results without throwing", () => {
    expect(boundAIContextRows(undefined, 5)).toEqual({ items: [], truncated: false });
  });

  it("keeps recent weighings in the shared context contract", () => {
    expect(AI_CONTEXT_LIMITS.weightRecords).toBe(20);
    expect(AI_CONTEXT_LABELS.weightRecords).toBe("pesajes recientes");
    expect(AI_CONTEXT_LIMITS.padrones).toBe(100);
    expect(AI_CONTEXT_LABELS.mapFeatures).toBe("infraestructura del mapa");
    expect(AI_CONTEXT_LIMITS.inventoryMovements).toBe(50);
    expect(AI_CONTEXT_LABELS.inventoryMovements).toBe("movimientos de inventario");
  });

  it("requests weather context only for weather-related questions", () => {
    expect(messageNeedsWeatherContext("¿Puedo pulverizar mañana con este viento?" )).toBe(true);
    expect(messageNeedsWeatherContext("¿Cuántas vacas hay en Norte?" )).toBe(false);
    expect(messageNeedsWeatherContext("¿Cuándo conviene sembrar soja?" )).toBe(true);
  });

  it("loads map context only for map-related questions", () => {
    expect(messageNeedsMapContext("¿Qué hay en el mapa del campo?" )).toBe(true);
    expect(messageNeedsMapContext("¿Dónde está la aguada del Norte?" )).toBe(true);
    expect(messageNeedsMapContext("¿Cuántas vacas hay en Norte?" )).toBe(false);
  });

  it("loads inventory traceability only for stock questions", () => {
    expect(messageNeedsInventoryContext("¿Qué insumos consumí esta semana?" )).toBe(true);
    expect(messageNeedsInventoryContext("¿Cuántas vacas hay en Norte?" )).toBe(false);
  });

  it("loads financial detail only for finance questions", () => {
    expect(messageNeedsFinancialContext("¿Cuánto gasté en veterinario?" )).toBe(true);
    expect(messageNeedsFinancialContext("¿Cuántas vacas hay en Norte?" )).toBe(false);
  });
});
