import { describe, expect, it } from "vitest";
import { describeSprayWindow, findSprayWindows, nextSprayWindowText, type HourlyWeather } from "./spray-window";

function day(date: string, wind: number[], precip: number[] = []): HourlyWeather[] {
  return wind.map((w, hour) => ({ time: `${date}T${String(hour).padStart(2, "0")}:00`, wind: w, precip: precip[hour] ?? 0 }));
}
const calmMorning = [2, 2, 2, 2, 2, 2, 8, 9, 10, 12, 18, 22, 25, 25, 20, 18, 14, 12, 10, 8, 5, 3, 2, 2]; // 6-10 ok, 16-20 ok
const windy = Array(24).fill(25);

describe("findSprayWindows", () => {
  it("finds daylight runs with workable wind and no rain", () => {
    const windows = findSprayWindows(day("2026-09-24", calmMorning), { now: "2026-09-24T00:00" });
    expect(windows).toEqual([
      { date: "2026-09-24", startHour: 6, endHour: 10, maxWind: 12 },
      { date: "2026-09-24", startHour: 16, endHour: 20, maxWind: 14 },
    ]);
  });

  it("skips past hours, too-short runs, calm air and rain", () => {
    expect(findSprayWindows(day("2026-09-24", calmMorning), { now: "2026-09-24T08:00" })[0]).toEqual({ date: "2026-09-24", startHour: 16, endHour: 20, maxWind: 14 });
    const rainy = day("2026-09-24", calmMorning, [0, 0, 0, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1]);
    expect(findSprayWindows(rainy, { now: "2026-09-24T00:00" })).toEqual([]);
    expect(findSprayWindows(day("2026-09-24", Array(24).fill(1)), { now: "2026-09-24T00:00" })).toEqual([]);
  });

  it("never joins hours across midnight", () => {
    const hours = [...day("2026-09-24", Array(24).fill(10)), ...day("2026-09-25", Array(24).fill(10))];
    expect(findSprayWindows(hours, { now: "2026-09-24T00:00" }).map((w) => [w.date, w.startHour, w.endHour])).toEqual([["2026-09-24", 6, 20], ["2026-09-25", 6, 20]]);
  });
});

describe("describeSprayWindow / nextSprayWindowText", () => {
  it("speaks in days a foreman uses", () => {
    expect(describeSprayWindow({ date: "2026-09-24", startHour: 7, endHour: 11, maxWind: 9 }, "2026-09-24")).toBe("hoy 7–11 h");
    expect(describeSprayWindow({ date: "2026-09-25", startHour: 7, endHour: 11, maxWind: 9 }, "2026-09-24")).toBe("mañana 7–11 h");
    expect(describeSprayWindow({ date: "2026-09-27", startHour: 6, endHour: 9, maxWind: 9 }, "2026-09-24")).toBe("dom 27, 6–9 h");
  });

  it("finds tomorrow's window after a windy today, or says there is none", () => {
    const hours = [...day("2026-09-24", windy), ...day("2026-09-25", calmMorning)];
    expect(nextSprayWindowText(hours, "2026-09-24T10:00")).toBe("próxima ventana para pulverizar: mañana 6–10 h (viento hasta 12 km/h, sin lluvia)");
    expect(nextSprayWindowText(day("2026-09-24", windy), "2026-09-24T10:00")).toBe("sin ventana para pulverizar en los próximos días");
    expect(nextSprayWindowText(undefined, "2026-09-24T10:00")).toBeNull();
  });
});
