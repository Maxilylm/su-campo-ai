import { afterEach, describe, expect, it, vi } from "vitest";
import { getFarmWeather } from "./weather-server";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe("getFarmWeather", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not call the provider without a farm location", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getFarmWeather("  ")).resolves.toEqual({ available: false, reason: "no_location" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("combines geocoding and forecast data into the shared shape", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ name: "Paysandú", admin1: "Paysandú", latitude: -32.3, longitude: -58.1 }] }))
      .mockResolvedValueOnce(jsonResponse({
        current: { temperature_2m: 22.4, wind_speed_10m: 12, precipitation: 0.2, weather_code: 2 },
        daily: {
          time: ["2026-08-15"],
          temperature_2m_max: [25],
          temperature_2m_min: [12],
          precipitation_sum: [1.1],
          weather_code: [61],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getFarmWeather("Paysandú, Uruguay")).resolves.toEqual({
      available: true,
      place: { name: "Paysandú", admin: "Paysandú" },
      current: { temp: 22.4, wind: 12, precip: 0.2, code: 2 },
      daily: [{ date: "2026-08-15", tmax: 25, tmin: 12, precip: 1.1, code: 61 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("degrades cleanly when geocoding fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));

    await expect(getFarmWeather("Campo desconocido")).resolves.toEqual({ available: false, reason: "geocode_failed" });
  });
});
