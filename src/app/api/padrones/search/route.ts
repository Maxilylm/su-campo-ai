import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";

const SNIG_BASE = "https://web.snig.gub.uy/arcgisserver/rest/services/Uruguay/SNIG_Catastro/MapServer/0/query";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const padronCode = req.nextUrl.searchParams.get("code"); // e.g. "D-995"
  if (!padronCode) {
    return NextResponse.json({ error: "code parameter required (e.g. D-995)" }, { status: 400 });
  }

  // Normalize: uppercase, ensure dash format
  const normalized = padronCode.toUpperCase().trim();

  try {
    const params = new URLSearchParams({
      where: `DeptoPadron='${normalized}'`,
      outFields: "*",
      f: "geojson",
      returnGeometry: "true",
      outSR: "4326",
    });

    const res = await fetch(`${SNIG_BASE}?${params}`, {
      headers: { "User-Agent": "CampoAI/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "SNIG service unavailable" }, { status: 502 });
    }

    const geojson = await res.json();
    return NextResponse.json(geojson);
  } catch (error) {
    console.error("SNIG query error:", error);
    return NextResponse.json({ error: "Failed to query SNIG" }, { status: 500 });
  }
}
