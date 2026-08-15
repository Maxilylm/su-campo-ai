import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { fetchWithTimeout } from "@/lib/fetch";

const SNIG_BASE = "https://web.snig.gub.uy/arcgisserver/rest/services/Uruguay/SNIG_Catastro/MapServer/0/query";

// The authenticated farm lookup plus the external SNIG query both need room
// to complete before the hosting platform cuts off the request.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const padronCode = req.nextUrl.searchParams.get("code"); // e.g. "D-995"
  if (!padronCode) {
    return NextResponse.json({ error: "code parameter required (e.g. D-995)" }, { status: 400 });
  }

  // Normalize: uppercase, ensure dash format
  const normalized = padronCode.toUpperCase().trim();
  if (!/^[A-Z0-9]{1,8}-[A-Z0-9]{1,24}$/.test(normalized)) {
    return NextResponse.json({ error: "invalid padron code" }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      where: `DeptoPadron='${normalized}'`,
      outFields: "*",
      f: "geojson",
      returnGeometry: "true",
      outSR: "4326",
    });

    const res = await fetchWithTimeout(`${SNIG_BASE}?${params}`, {
      headers: { "User-Agent": "CampoAI/1.0" },
    }, 15000);

    if (!res.ok) {
      return NextResponse.json({ error: "SNIG service unavailable" }, { status: 502 });
    }

    const geojson = await res.json();
    return NextResponse.json(geojson);
  } catch (error) {
    console.error("SNIG query error:", error);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "La consulta al SNIG tardó demasiado. Intentá nuevamente.", code: "snig_timeout" },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: "No se pudo consultar el servicio de padrones." }, { status: 502 });
  }
}
