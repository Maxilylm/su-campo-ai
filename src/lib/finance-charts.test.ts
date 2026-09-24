import { describe, expect, it } from "vitest";
import {
  activeFlowPoints,
  chartCurrencies,
  expensesByCategory,
  financeFlowSeries,
  flowBucketKey,
  flowBucketKeys,
  flowBucketLabel,
  flowGranularity,
  monthlyFlowFromTrend,
  resultByDimension,
} from "./finance-charts";

type Tx = Parameters<typeof financeFlowSeries>[0][number];
const tx = (patch: Partial<Tx>): Tx => ({ type: "egreso", amount: 0, currency: "USD", date: "2026-09-01", category: "otro", ...patch });

describe("flowGranularity", () => {
  it("uses days for a week, weeks for a month and months beyond", () => {
    expect(flowGranularity("7d")).toBe("day");
    expect(flowGranularity("30d")).toBe("week");
    expect(flowGranularity("90d")).toBe("month");
    expect(flowGranularity("year")).toBe("month");
  });
});

describe("flowBucketKey / flowBucketKeys", () => {
  it("groups weeks by their Monday", () => {
    expect(flowBucketKey("2026-09-24", "week")).toBe("2026-09-21"); // Thursday
    expect(flowBucketKey("2026-09-21", "week")).toBe("2026-09-21"); // Monday
    expect(flowBucketKey("2026-09-27", "week")).toBe("2026-09-21"); // Sunday
    expect(flowBucketKey("2026-01-01T10:00:00Z", "month")).toBe("2026-01");
  });

  it("lists every bucket in the range, including empty ones", () => {
    expect(flowBucketKeys("2026-09-20", "2026-09-23", "day")).toEqual(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(flowBucketKeys("2026-08-25", "2026-09-24", "week")).toEqual(["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(flowBucketKeys("2025-11-15", "2026-02-02", "month")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("returns nothing for an inverted range", () => {
    expect(flowBucketKeys("2026-09-24", "2026-09-01", "day")).toEqual([]);
  });
});

describe("flowBucketLabel", () => {
  it("labels days, weeks and months in es-UY short form", () => {
    expect(flowBucketLabel("2026-09-05", "day")).toBe("5/9");
    expect(flowBucketLabel("2026-09-21", "week")).toBe("21/9");
    expect(flowBucketLabel("2026-09", "month")).toBe("sep 26");
  });
});

describe("financeFlowSeries", () => {
  const transactions = [
    tx({ type: "ingreso", amount: 1000, date: "2026-07-10" }),
    tx({ type: "egreso", amount: 300, date: "2026-07-20" }),
    tx({ type: "egreso", amount: 500, date: "2026-09-02" }),
    tx({ type: "ingreso", amount: 99999, currency: "UYU", date: "2026-09-02" }),
  ];

  it("zero-fills buckets and keeps one currency", () => {
    expect(financeFlowSeries(transactions, "USD", "2026-06-26", "2026-09-24", "month")).toEqual([
      { key: "2026-06", income: 0, expenses: 0, net: 0, count: 0 },
      { key: "2026-07", income: 1000, expenses: 300, net: 700, count: 2 },
      { key: "2026-08", income: 0, expenses: 0, net: 0, count: 0 },
      { key: "2026-09", income: 0, expenses: 500, net: -500, count: 1 },
    ]);
  });

  it("extends the range to movements dated after the end", () => {
    const series = financeFlowSeries([tx({ amount: 10, date: "2026-10-03" })], "USD", "2026-09-01", "2026-09-24", "month");
    expect(series.map((point) => point.key)).toEqual(["2026-09", "2026-10"]);
    expect(series[1].expenses).toBe(10);
  });

  it("ignores movements before the start", () => {
    const series = financeFlowSeries([tx({ amount: 10, date: "2026-01-03" })], "USD", "2026-09-01", "2026-09-24", "month");
    expect(series).toEqual([{ key: "2026-09", income: 0, expenses: 0, net: 0, count: 0 }]);
  });

  it("counts only buckets with movements as data points", () => {
    expect(activeFlowPoints(financeFlowSeries(transactions, "USD", "2026-06-26", "2026-09-24", "month"))).toBe(2);
  });
});

describe("monthlyFlowFromTrend", () => {
  it("zero-fills the months of one currency from the metrics trend", () => {
    expect(monthlyFlowFromTrend([
      { month: "2026-08", currency: "USD", income: 50, expenses: 20 },
      { month: "2026-08", currency: "UYU", income: 9, expenses: 9 },
    ], "USD", "2026-07-01", "2026-09-24")).toEqual([
      { key: "2026-07", income: 0, expenses: 0, net: 0, count: 0 },
      { key: "2026-08", income: 50, expenses: 20, net: 30, count: 1 },
      { key: "2026-09", income: 0, expenses: 0, net: 0, count: 0 },
    ]);
  });
});

describe("expensesByCategory", () => {
  it("sorts expenses desc with their share, ignoring income and other currencies", () => {
    const result = expensesByCategory([
      tx({ category: "veterinario", amount: 100 }),
      tx({ category: "mano_obra", amount: 300 }),
      tx({ category: "veterinario", amount: 100 }),
      tx({ category: "venta_ganado", type: "ingreso", amount: 5000 }),
      tx({ category: "maquinaria", amount: 700, currency: "UYU" }),
    ], "USD");
    expect(result.total).toBe(500);
    expect(result.rows).toEqual([
      { key: "mano_obra", amount: 300, share: 0.6, count: 1 },
      { key: "veterinario", amount: 200, share: 0.4, count: 2 },
    ]);
  });

  it("folds the tail beyond the top N into Otros", () => {
    const categories = ["a", "b", "c", "d", "e", "f", "g"];
    const result = expensesByCategory(categories.map((category, i) => tx({ category, amount: 70 - i * 10 })), "USD", 5);
    expect(result.rows.map((row) => row.key)).toEqual(["a", "b", "c", "d", "e", "__others"]);
    expect(result.rows[5]).toEqual({ key: "__others", amount: 30, share: 30 / 280, count: 2 });
  });

  it("does not fold a single leftover category", () => {
    const result = expensesByCategory(["a", "b", "c"].map((category) => tx({ category, amount: 10 })), "USD", 2);
    expect(result.rows.map((row) => row.key)).toEqual(["a", "b", "c"]);
  });
});

describe("resultByDimension", () => {
  const transactions = [
    tx({ type: "ingreso", amount: 1000, section_id: "s1", sections: { name: "Potrero 1" } }),
    tx({ amount: 400, section_id: "s1", sections: { name: "Potrero 1" } }),
    tx({ amount: 250, section_id: "s2", sections: { name: "Bajo" } }),
    tx({ amount: 80 }),
    tx({ amount: 999, section_id: "s2", currency: "UYU" }),
    tx({ type: "ingreso", amount: 300, crop_id: "k1", crops: { crop_type: "Soja" } }),
  ];

  it("nets each section, sorted by result, with Sin asignar last", () => {
    expect(resultByDimension(transactions, "USD", "section")).toEqual([
      { key: "s1", label: "Potrero 1", income: 1000, expenses: 400, net: 600 },
      { key: "s2", label: "Bajo", income: 0, expenses: 250, net: -250 },
      { key: "unassigned", label: "Sin asignar", income: 300, expenses: 80, net: 220 },
    ]);
  });

  it("nets each crop and falls back to the names map", () => {
    expect(resultByDimension(
      [...transactions, tx({ amount: 50, crop_id: "k2" })],
      "USD",
      "crop",
      { k2: "Maíz" },
    )).toEqual([
      { key: "k1", label: "Soja", income: 300, expenses: 0, net: 300 },
      { key: "k2", label: "Maíz", income: 0, expenses: 50, net: -50 },
      { key: "unassigned", label: "Sin asignar", income: 1000, expenses: 730, net: 270 },
    ]);
  });

  it("returns nothing when there are no movements in the currency", () => {
    expect(resultByDimension(transactions, "ARS", "section")).toEqual([]);
  });
});

describe("chartCurrencies", () => {
  it("lists currencies with USD first", () => {
    expect(chartCurrencies([tx({ currency: "UYU" }), tx({ currency: "ARS" }), tx({ currency: "USD" }), tx({ currency: "" })])).toEqual(["USD", "ARS", "UYU"]);
  });
});
