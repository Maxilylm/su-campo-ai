import { NextResponse } from "next/server";

export async function parseJsonBody(req: Request, maxBytes = 256_000): Promise<
  // JSON fields are validated by each route after parsing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { data: Record<string, any> }
  | { error: Response }
> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { error: NextResponse.json({ error: "El cuerpo de la solicitud es demasiado grande." }, { status: 413 }) };
  }

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) {
      return { error: NextResponse.json({ error: "El cuerpo de la solicitud es demasiado grande." }, { status: 413 }) };
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { error: NextResponse.json({ error: "JSON body must be an object" }, { status: 400 }) };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { data: data as Record<string, any> };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}
