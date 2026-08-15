import { NextRequest, NextResponse } from "next/server";
import { getAuthState, requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseJsonBody } from "@/lib/request";
import { createFarmInviteToken, hashFarmInviteToken, isInviteRole, normalizeInviteEmail } from "@/lib/farm-invites";
import { withTimeout } from "@/lib/timeout";

const MEMBERS_QUERY_TIMEOUT_MS = 4000;

function migrationRequired() {
  return NextResponse.json({ error: "Aplicá supabase/031_farm_memberships.sql para activar el uso compartido.", code: "farm_membership_migration_required" }, { status: 503 });
}

export async function GET() {
  const access = await requireFarm();
  if ("error" in access) return access.error;
  const db = getSupabaseAdmin();
  const result = await withTimeout(
    db.from("farm_members").select("id, user_id, email, role, created_at").eq("farm_id", access.farmId).order("created_at", { ascending: true }),
    MEMBERS_QUERY_TIMEOUT_MS,
    null,
  );
  if (!result) return NextResponse.json({ error: "La consulta de miembros tardó demasiado." }, { status: 504 });
  if (result.error?.code === "PGRST205") return migrationRequired();
  if (result.error) return NextResponse.json({ error: "No se pudieron cargar los miembros." }, { status: 503 });

  const invites = await withTimeout(
    db.from("farm_invites").select("id, email, role, expires_at, created_at").eq("farm_id", access.farmId).is("accepted_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
    MEMBERS_QUERY_TIMEOUT_MS,
    null,
  );
  if (!invites) return NextResponse.json({ error: "La consulta de invitaciones tardó demasiado." }, { status: 504 });
  if (invites.error?.code === "PGRST205") return NextResponse.json({ members: result.data || [], invites: [], migrationRequired: true });
  if (invites.error) return NextResponse.json({ error: "No se pudieron cargar las invitaciones." }, { status: 503 });
  return NextResponse.json({ members: result.data || [], invites: invites.data || [], accessRole: access.role });
}

export async function POST(req: NextRequest) {
  const access = await requireFarm({ manageMembers: true });
  if ("error" in access) return access.error;
  const auth = await getAuthState();
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const email = normalizeInviteEmail(parsed.data.email);
  const role = parsed.data.role;
  if (!email) return NextResponse.json({ error: "Ingresá un email válido." }, { status: 400 });
  if (!isInviteRole(role)) return NextResponse.json({ error: "Elegí un rol de editor o lector." }, { status: 400 });
  if (email === auth.user.email?.toLowerCase()) return NextResponse.json({ error: "Ese email ya es tu usuario propietario." }, { status: 400 });

  const token = createFarmInviteToken();
  const db = getSupabaseAdmin();
  const result = await withTimeout(
    db.from("farm_invites").insert({ farm_id: access.farmId, email, role, token_hash: hashFarmInviteToken(token), invited_by: auth.user.id }).select("id, email, role, expires_at").single(),
    MEMBERS_QUERY_TIMEOUT_MS,
    null,
  );
  if (!result) return NextResponse.json({ error: "Crear la invitación tardó demasiado." }, { status: 504 });
  if (result.error?.code === "PGRST205") return migrationRequired();
  if (result.error) return NextResponse.json({ error: "No se pudo crear la invitación." }, { status: 503 });

  return NextResponse.json({ invite: result.data, link: `${req.nextUrl.origin}/invite/${token}` });
}

export async function DELETE(req: NextRequest) {
  const access = await requireFarm({ manageMembers: true });
  if ("error" in access) return access.error;
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const memberId = typeof parsed.data.memberId === "string" ? parsed.data.memberId : "";
  const inviteId = typeof parsed.data.inviteId === "string" ? parsed.data.inviteId : "";
  const db = getSupabaseAdmin();
  if (memberId) {
    const result = await withTimeout(db.from("farm_members").delete().eq("id", memberId).eq("farm_id", access.farmId).neq("role", "owner"), MEMBERS_QUERY_TIMEOUT_MS, null);
    if (!result) return NextResponse.json({ error: "Quitar el miembro tardó demasiado." }, { status: 504 });
    if (result.error?.code === "PGRST205") return migrationRequired();
    if (result.error) return NextResponse.json({ error: "No se pudo quitar el miembro." }, { status: 503 });
    return NextResponse.json({ ok: true });
  }
  if (inviteId) {
    const result = await withTimeout(db.from("farm_invites").delete().eq("id", inviteId).eq("farm_id", access.farmId).is("accepted_at", null), MEMBERS_QUERY_TIMEOUT_MS, null);
    if (!result) return NextResponse.json({ error: "Cancelar la invitación tardó demasiado." }, { status: 504 });
    if (result.error?.code === "PGRST205") return migrationRequired();
    if (result.error) return NextResponse.json({ error: "No se pudo cancelar la invitación." }, { status: 503 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Indicá un miembro o una invitación." }, { status: 400 });
}
