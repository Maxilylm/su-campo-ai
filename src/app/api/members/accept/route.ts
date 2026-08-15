import { NextRequest, NextResponse } from "next/server";
import { getAuthState } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseJsonBody } from "@/lib/request";
import { hashFarmInviteToken } from "@/lib/farm-invites";
import { withTimeout } from "@/lib/timeout";

const ACCEPT_TIMEOUT_MS = 4000;

export async function POST(req: NextRequest) {
  const auth = await getAuthState();
  if (!auth.user) return NextResponse.json({ error: "Iniciá sesión para aceptar la invitación." }, { status: 401 });
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const token = typeof parsed.data.token === "string" ? parsed.data.token.trim() : "";
  if (token.length < 40 || token.length > 100) return NextResponse.json({ error: "La invitación no es válida." }, { status: 400 });

  const db = getSupabaseAdmin();
  const inviteResult = await withTimeout(
    db.from("farm_invites").select("id, farm_id, email, role, expires_at").eq("token_hash", hashFarmInviteToken(token)).is("accepted_at", null).gt("expires_at", new Date().toISOString()).maybeSingle(),
    ACCEPT_TIMEOUT_MS,
    null,
  );
  if (!inviteResult) return NextResponse.json({ error: "La invitación tardó demasiado en validarse." }, { status: 504 });
  if (inviteResult.error?.code === "PGRST205") return NextResponse.json({ error: "Aplicá supabase/031_farm_memberships.sql para activar las invitaciones.", code: "farm_membership_migration_required" }, { status: 503 });
  if (inviteResult.error || !inviteResult.data) return NextResponse.json({ error: "La invitación no existe, venció o ya fue usada." }, { status: 404 });
  if (inviteResult.data.email.toLowerCase() !== (auth.user.email || "").toLowerCase()) return NextResponse.json({ error: `La invitación fue creada para ${inviteResult.data.email}. Ingresá con ese email.` }, { status: 403 });

  const existing = await withTimeout(db.from("farm_members").select("id, role").eq("farm_id", inviteResult.data.farm_id).eq("user_id", auth.user.id).maybeSingle(), ACCEPT_TIMEOUT_MS, null);
  if (!existing) return NextResponse.json({ error: "Validar tu membresía tardó demasiado." }, { status: 504 });
  if (existing.error) return NextResponse.json({ error: "No se pudo validar tu membresía." }, { status: 503 });
  const memberRole = existing.data?.role === "owner" ? "owner" : inviteResult.data.role;
  const memberResult = existing.data
    ? await withTimeout(db.from("farm_members").update({ role: memberRole, email: auth.user.email }).eq("id", existing.data.id).eq("farm_id", inviteResult.data.farm_id), ACCEPT_TIMEOUT_MS, null)
    : await withTimeout(db.from("farm_members").insert({ farm_id: inviteResult.data.farm_id, user_id: auth.user.id, email: auth.user.email, role: memberRole }), ACCEPT_TIMEOUT_MS, null);
  if (!memberResult) return NextResponse.json({ error: "Guardar tu acceso tardó demasiado." }, { status: 504 });
  if (memberResult.error) return NextResponse.json({ error: "No se pudo guardar tu acceso al campo." }, { status: 503 });

  const accepted = await withTimeout(db.from("farm_invites").update({ accepted_at: new Date().toISOString(), accepted_by: auth.user.id }).eq("id", inviteResult.data.id).is("accepted_at", null), ACCEPT_TIMEOUT_MS, null);
  if (!accepted) return NextResponse.json({ error: "Tu acceso se guardó, pero no se pudo cerrar la invitación. Podés continuar." }, { status: 200 });
  return NextResponse.json({ ok: true, farmId: inviteResult.data.farm_id, role: memberRole });
}
