import { NextResponse } from "next/server";

export async function parseJsonBody(req: Request): Promise<
  // JSON fields are validated by each route after parsing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { data: Record<string, any> }
  | { error: Response }
> {
  try {
    const data = await req.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { error: NextResponse.json({ error: "JSON body must be an object" }, { status: 400 }) };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { data: data as Record<string, any> };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}
