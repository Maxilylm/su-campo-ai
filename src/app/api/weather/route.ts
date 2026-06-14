import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

// Free, no-key weather via Open-Meteo. Geocodes the farm's location text, then
// fetches a 7-day forecast. Always returns 200 with { available } so the UI degrades.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data: farm } = await db.from("farms").select("location").eq("id", result.farmId).single();
  const location = farm?.location?.trim();

  if (!location) {
    return NextResponse.json({ available: false, reason: "no_location" });
  }

  try {
    // Geocode — use the first comma-segment (e.g. "Paysandú, Uruguay" → "Paysandú").
    const q = encodeURIComponent(location.split(",")[0].trim());
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=es&format=json`,
      { next: { revalidate: 86400 } }
    );
    const geo = await geoRes.json();
    const place = geo?.results?.[0];
    if (!place) return NextResponse.json({ available: false, reason: "geocode_failed" });

    const fc = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,wind_speed_10m,precipitation,weather_code` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
        `&timezone=auto&forecast_days=7`,
      { next: { revalidate: 1800 } }
    );
    const w = await fc.json();

    const daily = (w.daily?.time || []).map((date: string, i: number) => ({
      date,
      tmax: w.daily.temperature_2m_max[i],
      tmin: w.daily.temperature_2m_min[i],
      precip: w.daily.precipitation_sum[i],
      code: w.daily.weather_code[i],
    }));

    return NextResponse.json({
      available: true,
      place: { name: place.name, admin: place.admin1 || place.country || "" },
      current: {
        temp: w.current?.temperature_2m,
        wind: w.current?.wind_speed_10m,
        precip: w.current?.precipitation ?? 0,
        code: w.current?.weather_code ?? 0,
      },
      daily,
    });
  } catch (e) {
    console.error("Weather error:", e);
    return NextResponse.json({ available: false, reason: "fetch_failed" });
  }
}
