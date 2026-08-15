import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { getFarmWeather } from "@/lib/weather-server";
import { withTimeout } from "@/lib/timeout";

const WEATHER_DB_TIMEOUT_MS = 2500;
const WEATHER_PROVIDER_TIMEOUT_MS = 8000;

// Free, no-key weather via Open-Meteo. Geocodes the farm's location text, then
// fetches a 7-day forecast. Always returns 200 with { available } so the UI degrades.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const farmResult = await withTimeout(
    db.from("farms").select("location").eq("id", result.farmId).single(),
    WEATHER_DB_TIMEOUT_MS,
    null,
  );
  if (!farmResult) return NextResponse.json({ error: "La ubicación del campo tardó demasiado." }, { status: 504 });
  const { data: farm, error: farmError } = farmResult;
  if (farmError) return NextResponse.json({ error: "No se pudo cargar la ubicación del campo." }, { status: 503 });
  const weather = await withTimeout(
    getFarmWeather(farm?.location),
    WEATHER_PROVIDER_TIMEOUT_MS,
    { available: false, reason: "timeout" },
  );
  return NextResponse.json(weather);
}
