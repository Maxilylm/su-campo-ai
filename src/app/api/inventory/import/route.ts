import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

const MAX_IMPORT_ROWS = 200;
const CATEGORIES = new Set(["alimento", "semilla", "fertilizante", "agroquímico", "medicamento", "combustible", "otro"]);
const UNITS = new Set(["kg", "L", "dosis", "unidad"]);
const CURRENCIES = new Set(["USD", "UYU", "ARS"]);

function text(value: unknown, maxLength = 500): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req, 1_200_000);
  if ("error" in parsed) return parsed.error;
  const rows = parsed.data.rows;
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: "El archivo no contiene filas para importar." }, { status: 400 });
  if (rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: `La importación admite hasta ${MAX_IMPORT_ROWS} filas por vez.` }, { status: 413 });

  const errors: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`Fila ${line}: formato inválido.`);
      return;
    }
    const data = row as Record<string, unknown>;
    const name = text(data.name, 200);
    const category = text(data.category) || "otro";
    const unit = text(data.unit) || "unidad";
    const currency = text(data.currency) || "USD";
    const currentStock = data.currentStock == null || data.currentStock === "" ? 0 : Number(data.currentStock);
    const minStock = data.minStock == null || data.minStock === "" ? null : Number(data.minStock);
    const costPerUnit = data.costPerUnit == null || data.costPerUnit === "" ? null : Number(data.costPerUnit);

    if (!name) errors.push(`Fila ${line}: falta el nombre.`);
    if (!CATEGORIES.has(category)) errors.push(`Fila ${line}: categoría inválida.`);
    if (!UNITS.has(unit)) errors.push(`Fila ${line}: unidad inválida.`);
    if (!CURRENCIES.has(currency)) errors.push(`Fila ${line}: moneda inválida.`);
    if (!Number.isFinite(currentStock) || currentStock < 0) errors.push(`Fila ${line}: stock actual inválido.`);
    if (minStock !== null && (!Number.isFinite(minStock) || minStock < 0)) errors.push(`Fila ${line}: stock mínimo inválido.`);
    if (costPerUnit !== null && (!Number.isFinite(costPerUnit) || costPerUnit < 0)) errors.push(`Fila ${line}: costo unitario inválido.`);

    inserts.push({
      farm_id: result.farmId,
      name,
      category,
      unit,
      current_stock: currentStock,
      min_stock: minStock,
      cost_per_unit: costPerUnit,
      currency,
      notes: text(data.notes, 2000),
    });
  });

  if (errors.length > 0) return NextResponse.json({ error: "Hay filas que necesitan corrección.", rowErrors: errors.slice(0, 20) }, { status: 400 });

  const db = getSupabaseAdmin();
  let insertResult = await db.from("inventory_items").insert(inserts).select("id");
  if (insertResult.error?.code === "PGRST204") {
    insertResult = await db.from("inventory_items").insert(inserts.map((insert) => {
      const { currency, ...legacy } = insert;
      void currency;
      return legacy;
    })).select("id");
  }
  if (insertResult.error) return databaseFailure("inventory import", insertResult.error);
  return NextResponse.json({ imported: insertResult.data?.length || 0 });
}
