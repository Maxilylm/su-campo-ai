import { fetchWithTimeout } from "./fetch";

export interface FarmWeather {
  available: boolean;
  reason?: string;
  place?: { name: string; admin: string };
  current?: { temp: number; wind: number; precip: number; code: number };
  daily?: { date: string; tmax: number; tmin: number; precip: number; code: number }[];
}

/**
 * Shared Open-Meteo adapter for UI weather and actionable farm alerts.
 * It returns an unavailable result so a provider outage never hides the dashboard.
 */
export async function getFarmWeather(location: string | null | undefined): Promise<FarmWeather> {
  const trimmed = location?.trim();
  if (!trimmed) return { available: false, reason: "no_location" };

  try {
    const q = encodeURIComponent(trimmed.split(",")[0].trim());
    const geoRes = await fetchWithTimeout(
      "https://geocoding-api.open-meteo.com/v1/search?name=" + q + "&count=1&language=es&format=json",
      { next: { revalidate: 86400 } },
      5000
    );
    if (!geoRes.ok) return { available: false, reason: "geocode_failed" };
    const geo = await geoRes.json();
    const place = geo?.results?.[0];
    if (!place) return { available: false, reason: "geocode_failed" };

    const forecastUrl =
      "https://api.open-meteo.com/v1/forecast?latitude=" + place.latitude + "&longitude=" + place.longitude +
      "&current=temperature_2m,wind_speed_10m,precipitation,weather_code" +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code" +
      "&timezone=auto&forecast_days=7";
    const fc = await fetchWithTimeout(forecastUrl, { next: { revalidate: 1800 } }, 7000);
    if (!fc.ok) return { available: false, reason: "forecast_failed" };
    const w = await fc.json();

    const daily = (w.daily?.time || []).map((date: string, i: number) => ({
      date,
      tmax: w.daily.temperature_2m_max[i],
      tmin: w.daily.temperature_2m_min[i],
      precip: w.daily.precipitation_sum[i],
      code: w.daily.weather_code[i],
    }));

    return {
      available: true,
      place: { name: place.name, admin: place.admin1 || place.country || "" },
      current: {
        temp: w.current?.temperature_2m,
        wind: w.current?.wind_speed_10m,
        precip: w.current?.precipitation ?? 0,
        code: w.current?.weather_code ?? 0,
      },
      daily,
    };
  } catch (error) {
    console.error("Weather provider error:", error);
    return { available: false, reason: "fetch_failed" };
  }
}
