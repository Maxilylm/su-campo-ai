import { NextResponse } from "next/server";

export function databaseFailure(operation: string, error: { message?: string }) {
  console.error(`${operation}:`, error.message || error);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 503 });
}
