import { describe, expect, it } from "vitest";
import { AI_CONTEXT_PRIORITY, contextTrimNotice, estimateTokens, fitContextToBudget, type AIContextBlock } from "./ai-context-budget";

function block(label: string, priority: number, rows: number, rowText = "x".repeat(36)): AIContextBlock {
  let text = `\n${label.toUpperCase()}:\n`;
  for (let i = 0; i < rows; i += 1) text += `- ${label} ${i} ${rowText}\n`;
  return { label, priority, text };
}

describe("estimateTokens", () => {
  it("uses ceil(chars / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("fitContextToBudget", () => {
  const preamble = "=== ESTADO ACTUAL DEL CAMPO ===\n\n";

  it("returns the context unchanged when it fits", () => {
    const blocks = [block("tareas", AI_CONTEXT_PRIORITY.high, 3), block("pesajes", AI_CONTEXT_PRIORITY.lowest, 3)];
    const result = fitContextToBudget(preamble, blocks, 6_000);
    expect(result.trimmed).toEqual([]);
    expect(result.text).toBe(preamble + blocks[0].text + blocks[1].text);
  });

  it("trims the least relevant block first and keeps block order", () => {
    const deadlines = block("pendientes", AI_CONTEXT_PRIORITY.critical, 20);
    const weights = block("pesajes", AI_CONTEXT_PRIORITY.lowest, 200);
    const tasks = block("tareas", AI_CONTEXT_PRIORITY.high, 20);
    const result = fitContextToBudget(preamble, [deadlines, weights, tasks], 1_000);

    expect(result.trimmed).toEqual(["pesajes"]);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(1_000);
    expect(result.text).toContain(deadlines.text);
    expect(result.text).toContain(tasks.text);
    expect(result.text).toContain("- pesajes 0 ");
    expect(result.text).not.toContain("- pesajes 199 ");
    expect(result.text.indexOf("PENDIENTES:")).toBeLessThan(result.text.indexOf("PESAJES:"));
    expect(result.text.indexOf("PESAJES:")).toBeLessThan(result.text.indexOf("TAREAS:"));
  });

  it("drops a block reduced to its header, then moves on to the next priority", () => {
    const deadlines = block("pendientes", AI_CONTEXT_PRIORITY.critical, 40);
    const crops = block("cultivos", AI_CONTEXT_PRIORITY.low, 40);
    const weights = block("pesajes", AI_CONTEXT_PRIORITY.lowest, 40);
    const result = fitContextToBudget(preamble, [deadlines, crops, weights], 700);

    expect(result.trimmed).toEqual(["pesajes", "cultivos"]);
    expect(result.text).not.toContain("PESAJES:");
    expect(result.text).toContain("CULTIVOS:");
    expect(result.text).toContain(deadlines.text);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(700);
  });

  it("breaks priority ties by trimming the later block first", () => {
    const a = block("inventario", AI_CONTEXT_PRIORITY.low, 50);
    const b = block("finanzas", AI_CONTEXT_PRIORITY.low, 50);
    const result = fitContextToBudget(preamble, [a, b], 900);
    expect(result.trimmed[0]).toBe("finanzas");
    expect(result.text).toContain(a.text);
  });

  it("signals the trim with an AVISO right after the preamble", () => {
    const result = fitContextToBudget(preamble, [block("pesajes", AI_CONTEXT_PRIORITY.lowest, 500)], 500);
    expect(result.text.startsWith(preamble + "AVISO DE CONTEXTO: para no exceder el límite del modelo")).toBe(true);
    expect(result.text).toContain("se recortaron: pesajes.");
  });

  it("never trims the preamble, even when it alone exceeds the budget", () => {
    const bigPreamble = "AVISO DE CONTEXTO: " + "y".repeat(8_000) + "\n\n";
    const result = fitContextToBudget(bigPreamble, [block("pesajes", AI_CONTEXT_PRIORITY.lowest, 5)], 1_000);
    expect(result.text.startsWith(bigPreamble)).toBe(true);
    expect(result.trimmed).toEqual(["pesajes"]);
  });

  it("is deterministic", () => {
    const blocks = [
      block("pendientes", AI_CONTEXT_PRIORITY.critical, 30),
      block("secciones", AI_CONTEXT_PRIORITY.medium, 80),
      block("inventario", AI_CONTEXT_PRIORITY.low, 80),
    ];
    const copy = () => blocks.map((b) => ({ ...b }));
    expect(fitContextToBudget(preamble, copy(), 1_500)).toEqual(fitContextToBudget(preamble, copy(), 1_500));
  });
});

describe("contextTrimNotice", () => {
  it("is empty when nothing was trimmed", () => {
    expect(contextTrimNotice([])).toBe("");
  });
});

describe("pinned blocks", () => {
  it("are never trimmed", () => {
    const totals: AIContextBlock = { label: "totales", priority: AI_CONTEXT_PRIORITY.pinned, text: "\nTOTALES: 3 secciones, 120 cabezas total\n" };
    const result = fitContextToBudget("", [totals, block("pesajes", AI_CONTEXT_PRIORITY.lowest, 400)], 300);
    expect(result.text).toContain(totals.text);
    expect(result.trimmed).toEqual(["pesajes"]);
  });
});
