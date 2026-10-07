import { describe, expect, it } from "vitest";
import {
  cattleCategoryHitRate, cattleDraftsFromTable, cattleImportPayload, detectCattleMapping, emptyCattleDraft, findSection,
  normalizeCattleCategory, normalizeDateText, parseHeadCount, resolveDraftSections, validateCattleDrafts,
} from "./cattle-import";
import type { ImportTable } from "./import-table";

const SECTIONS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Potrero Bajo" },
  { id: "22222222-2222-4222-8222-222222222222", name: "3" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Loma" },
];

function table(headers: string[], rows: string[][]): ImportTable {
  return { headers, rows, headerRowIndex: 0, sheetName: null };
}

describe("normalizeCattleCategory", () => {
  it("maps how producers write categories", () => {
    expect(normalizeCattleCategory("vaca")).toBe("vaca");
    expect(normalizeCattleCategory("Vacas de cría")).toBe("vaca");
    expect(normalizeCattleCategory("Vacas de invernada")).toBe("vaca");
    expect(normalizeCattleCategory("Vientres entorados")).toBe("vaca");
    expect(normalizeCattleCategory("Vaq. 1-2 años")).toBe("vaquillona");
    expect(normalizeCattleCategory("Vaquillonas +2")).toBe("vaquillona");
    expect(normalizeCattleCategory("Novillos 1-2 años")).toBe("novillo");
    expect(normalizeCattleCategory("Terneros/as")).toBe("ternero");
    expect(normalizeCattleCategory("Terneras")).toBe("ternera");
    expect(normalizeCattleCategory("TOROS")).toBe("toro");
    expect(normalizeCattleCategory("Ovinos")).toBe("oveja");
    expect(normalizeCattleCategory("Equinos")).toBe("caballo");
    expect(normalizeCattleCategory("Yeguas")).toBe("yegua");
  });

  it("returns null for unknown or blank text, and does not confuse potrero/total", () => {
    expect(normalizeCattleCategory("")).toBeNull();
    expect(normalizeCattleCategory("Potrero")).toBeNull();
    expect(normalizeCattleCategory("Total")).toBeNull();
    expect(normalizeCattleCategory("Gallinas")).toBeNull();
  });

  it("applies overrides from the AI mapping by normalized key", () => {
    expect(normalizeCattleCategory("Engorde", { engorde: "novillo" })).toBe("novillo");
    expect(normalizeCattleCategory("ENGORDE ", { "Engorde": "novillo" })).toBe("novillo");
  });
});

describe("parseHeadCount and normalizeDateText", () => {
  it("reads thousands separators in counts", () => {
    expect(parseHeadCount("1.250")).toBe(1250);
    expect(parseHeadCount("12")).toBe(12);
    expect(parseHeadCount("12,0")).toBe(12);
    expect(Number.isNaN(parseHeadCount("doce"))).toBe(true);
  });

  it("converts D/M/AAAA dates and leaves others alone", () => {
    expect(normalizeDateText("5/3/2024")).toBe("2024-03-05");
    expect(normalizeDateText("05-03-2024")).toBe("2024-03-05");
    expect(normalizeDateText("2024-03-05")).toBe("2024-03-05");
    expect(normalizeDateText("31/02/2024")).toBe("31/02/2024");
    expect(normalizeDateText("marzo")).toBe("marzo");
  });
});

describe("detectCattleMapping", () => {
  it("recognizes the template and balance-style headers", () => {
    expect(detectCattleMapping(["categoria", "cantidad", "raza", "seccion", "peso", "caravana"])?.columns).toMatchObject({
      category: 0, count: 1, breed: 2, section: 3, weightKg: 4, earTag: 5,
    });
    expect(detectCattleMapping(["Categoría", "Cantidad", "Peso prom", "Potrero"])?.columns).toEqual({ category: 0, count: 1, weightKg: 2, section: 3 });
  });

  it("detects a wide sheet (one column per category) and ignores its Total column", () => {
    const mapping = detectCattleMapping(["Potrero", "Vacas", "Vaquillonas", "Terneros", "Total"]);
    expect(mapping?.columns).toEqual({ section: 0 });
    expect(mapping?.categoryColumns).toEqual({ 1: "vaca", 2: "vaquillona", 3: "ternero" });
  });

  it("returns null when nothing is recognizable", () => {
    expect(detectCattleMapping(["Descripción", "Importe"])).toBeNull();
  });
});

describe("cattleDraftsFromTable", () => {
  it("builds long-layout drafts, skipping totals and blank lines", () => {
    const t = table(["Categoría", "Cantidad", "Peso prom", "Potrero"], [
      ["Vacas de cría", "120", "420,5", "Bajo"],
      ["Novillos 2-3", "1.050", "", "Loma"],
      ["", "", "", ""],
      ["Total", "1.170", "", ""],
    ]);
    const { drafts, skipped } = cattleDraftsFromTable(t, detectCattleMapping(t.headers)!);
    expect(skipped).toBe(2);
    expect(drafts.map((draft) => [draft.category, draft.count, draft.weightKg, draft.sectionName])).toEqual([
      ["vaca", "120", "420,5", "Bajo"],
      ["novillo", "1050", "", "Loma"],
    ]);
  });

  it("expands a wide sheet into one draft per non-zero category cell", () => {
    const t = table(["Potrero", "Vacas", "Terneros", "Total"], [
      ["Bajo", "50", "0", "50"],
      ["Loma", "-", "30", "30"],
      ["Total", "50", "30", "80"],
    ]);
    const { drafts, skipped } = cattleDraftsFromTable(t, detectCattleMapping(t.headers)!);
    expect(skipped).toBe(1);
    expect(drafts.map((draft) => [draft.sectionName, draft.category, draft.count])).toEqual([
      ["Bajo", "vaca", "50"],
      ["Loma", "ternero", "30"],
    ]);
  });

  it("keeps unknown category text so validation flags it, and defaults count to 1 for single tags", () => {
    const t = table(["Categoría", "Caravana"], [["Gallinas", ""], ["", "UY 123"]]);
    const { drafts } = cattleDraftsFromTable(t, detectCattleMapping(t.headers)!);
    expect(drafts.map((draft) => [draft.category, draft.count, draft.earTag])).toEqual([["gallinas", "1", ""], ["", "1", "UY 123"]]);
  });
});

describe("sections", () => {
  it("finds potreros by id, exact name or without the 'Potrero' prefix", () => {
    expect(findSection("Bajo", SECTIONS)?.name).toBe("Potrero Bajo");
    expect(findSection("potrero bajo", SECTIONS)?.name).toBe("Potrero Bajo");
    expect(findSection("Potrero 3", SECTIONS)?.name).toBe("3");
    expect(findSection(SECTIONS[2].id, SECTIONS)?.name).toBe("Loma");
    expect(findSection("Cañada", SECTIONS)).toBeNull();
    expect(findSection("", SECTIONS)).toBeNull();
  });

  it("refuses ambiguous loose matches", () => {
    expect(findSection("Potrero 1", [{ id: "a", name: "1" }, { id: "b", name: "Lote 1" }])).toBeNull();
  });

  it("resolves draft sections and clears ids that are not the farm's", () => {
    const drafts = resolveDraftSections([
      { ...emptyCattleDraft(), category: "vaca", sectionName: "Bajo" },
      { ...emptyCattleDraft(), category: "vaca", sectionName: "Cañada" },
      { ...emptyCattleDraft(), category: "vaca", sectionId: "foreign-id", sectionName: "" },
    ], SECTIONS);
    expect(drafts.map((draft) => [draft.sectionId, draft.sectionName])).toEqual([
      [SECTIONS[0].id, "Potrero Bajo"],
      [null, "Cañada"],
      [null, ""],
    ]);
  });
});

describe("validateCattleDrafts", () => {
  it("flags each problem on its row", () => {
    const drafts = [
      { ...emptyCattleDraft(), category: "vaca", count: "10", sectionId: SECTIONS[0].id, sectionName: "Potrero Bajo" },
      { ...emptyCattleDraft(), category: "gallina", count: "0" },
      { ...emptyCattleDraft(), category: "toro", sectionName: "Cañada" },
      { ...emptyCattleDraft(), category: "vaca", earTag: "uy 1", weightKg: "-3", birthDate: "2024-13-01" },
      { ...emptyCattleDraft(), category: "vaca", earTag: "UY 1 " },
      { ...emptyCattleDraft(), category: "", count: "1,5" },
    ];
    const result = validateCattleDrafts(drafts, SECTIONS);
    expect(result.valid).toBe(false);
    expect(result.rowErrors[0]).toEqual([]);
    expect(result.rowErrors[1]).toEqual(["Categoría «gallina» no reconocida.", "La cantidad debe ser un entero positivo."]);
    expect(result.rowErrors[2][0]).toContain("No encontré el potrero «Cañada»");
    expect(result.rowErrors[3]).toEqual(["Peso inválido (kg).", "La fecha de nacimiento debe ser AAAA-MM-DD."]);
    expect(result.rowErrors[4]).toEqual(["La caravana «UY 1» se repite en la fila 4."]);
    expect(result.rowErrors[5]).toEqual(["Falta la categoría.", "La cantidad debe ser un entero positivo."]);
  });

  it("rejects an empty list and more than 200 rows", () => {
    expect(validateCattleDrafts([], SECTIONS)).toMatchObject({ valid: false, errors: ["No hay filas para importar."] });
    const many = Array.from({ length: 201 }, () => ({ ...emptyCattleDraft(), category: "vaca" }));
    expect(validateCattleDrafts(many, SECTIONS).valid).toBe(false);
  });

  it("passes clean rows and builds the endpoint payload", () => {
    const drafts = [{ ...emptyCattleDraft(), category: "novillo", count: "1.200", weightKg: "380,5", sectionId: SECTIONS[1].id, sectionName: "3", breed: " Hereford ", birthDate: "2024-03-05" }];
    expect(validateCattleDrafts(drafts, SECTIONS).valid).toBe(true);
    expect(cattleImportPayload(drafts)).toEqual([{
      sectionId: SECTIONS[1].id, category: "novillo", count: 1200, breed: "Hereford", weightKg: 380.5, earTag: null, tagRange: null,
      birthDate: "2024-03-05", origin: null, vaccinationStatus: null, reproductiveStatus: null, healthStatus: null, notes: null,
    }]);
  });
});

describe("cattleCategoryHitRate", () => {
  it("measures how many category texts are recognizable", () => {
    const t = table(["Categoría", "Cantidad"], [["Vacas", "1"], ["Vientres", "2"], ["Engorde", "3"], ["Total", "6"]]);
    expect(cattleCategoryHitRate(t, detectCattleMapping(t.headers)!)).toBeCloseTo(2 / 3);
    expect(cattleCategoryHitRate(t, { columns: {} })).toBe(0);
  });
});
