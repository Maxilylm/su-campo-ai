import { NextRequest, NextResponse } from "next/server";
import { getAuthState, requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseJsonBody } from "@/lib/request";
import { createFarmInviteToken, hashFarmInviteToken, isInviteRole, normalizeInviteEmail } from "@/lib/farm-invites";
import { withTimeout } from "@/lib/timeout";

const MEMBERS_QUERY_TIMEOUT_MS = 4000;
const MEMBER_ACTIVITY_TIMEOUT_MS = 2000;

type ActivityActor = { id: string; email?: string | null };

async function recordMemberActivity(
  farmId: string,
  actor: ActivityActor,
  description: string,
  metadata: Record<string, string>,
) {
  const result = await withTimeout(
    getSupabaseAdmin().from("activities").insert({
      farm_id: farmId,
      type: "setup",
      description,
      message_type: "text",
      reported_by: actor.email || actor.id,
      metadata: { source: "farm_members", ...metadata },
    }),
    MEMBER_ACTIVITY_TIMEOUT_MS,
    null,
  );
  if (!result || result.error) console.warn("member activity log:", result?.error?.message || "timed out");
}

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

  await recordMemberActivity(
    access.farmId,
    auth.user,
    `Invitó a ${email} como ${role === "viewer" ? "solo lectura" : "editor"}`,
    { action: "invite_created", email, role },
  );

  return NextResponse.json({ invite: result.data, link: `${req.nextUrl.origin}/invite/${token}` });
}

export async function PATCH(req: NextRequest) {
  const access = await requireFarm({ manageMembers: true });
  if ("error" in access) return access.error;
  const auth = await getAuthState();
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const memberId = typeof parsed.data.memberId === "string" ? parsed.data.memberId : "";
  const role = parsed.data.role;
  if (!memberId) return NextResponse.json({ error: "Indicá el miembro a actualizar." }, { status: 400 });
  if (!isInviteRole(role)) return NextResponse.json({ error: "Elegí un rol de editor o lector." }, { status: 400 });

  const db = getSupabaseAdmin();
  const result = await withTimeout(
    db.from("farm_members")
      .update({ role })
      .eq("id", memberId)
      .eq("farm_id", access.farmId)
      .neq("role", "owner")
      .select("id, email, role")
      .maybeSingle(),
    MEMBERS_QUERY_TIMEOUT_MS,
    null,
  );
  if (!result) return NextResponse.json({ error: "Actualizar el rol tardó demasiado." }, { status: 504 });
  if (result.error?.code === "PGRST205") return migrationRequired();
  if (result.error) return NextResponse.json({ error: "No se pudo actualizar el rol." }, { status: 503 });
  if (!result.data) return NextResponse.json({ error: "El miembro no existe o no se puede modificar." }, { status: 404 });
  await recordMemberActivity(
    access.farmId,
    auth.user,
    `Cambió el acceso de ${result.data.email || "un miembro"} a ${role === "viewer" ? "solo lectura" : "editor"}`,
    { action: "member_role_changed", member_id: result.data.id, role },
  );
  return NextResponse.json({ member: result.data });
}

export async function DELETE(req: NextRequest) {
  const access = await requireFarm({ manageMembers: true });
  if ("error" in access) return access.error;
  const auth = await getAuthState();
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const memberId = typeof parsed.data.memberId === "string" ? parsed.data.memberId : "";
  const inviteId = typeof parsed.data.inviteId === "string" ? parsed.data.inviteId : "";
  const db = getSupabaseAdmin();
  if (memberId) {
    const result = await withTimeout(db.from("farm_members").delete().eq("id", memberId).eq("farm_id", access.farmId).neq("role", "owner").select("id, email").maybeSingle(), MEMBERS_QUERY_TIMEOUT_MS, null);
    if (!result) return NextResponse.json({ error: "Quitar el miembro tardó demasiado." }, { status: 504 });
    if (result.error?.code === "PGRST205") return migrationRequired();
    if (result.error) return NextResponse.json({ error: "No se pudo quitar el miembro." }, { status: 503 });
    if (!result.data) return NextResponse.json({ error: "El miembro no existe o no se puede quitar." }, { status: 404 });
    await recordMemberActivity(access.farmId, auth.user, `Quitó el acceso de ${result.data.email || "un miembro"}`, { action: "member_removed", member_id: result.data.id });
    return NextResponse.json({ ok: true });
  }
  if (inviteId) {
    const result = await withTimeout(db.from("farm_invites").delete().eq("id", inviteId).eq("farm_id", access.farmId).is("accepted_at", null).select("id, email").maybeSingle(), MEMBERS_QUERY_TIMEOUT_MS, null);
    if (!result) return NextResponse.json({ error: "Cancelar la invitación tardó demasiado." }, { status: 504 });
    if (result.error?.code === "PGRST205") return migrationRequired();
    if (result.error) return NextResponse.json({ error: "No se pudo cancelar la invitación." }, { status: 503 });
    if (!result.data) return NextResponse.json({ error: "La invitación no existe o ya fue aceptada." }, { status: 404 });
    await recordMemberActivity(access.farmId, auth.user, `Canceló la invitación de ${result.data.email}`, { action: "invite_cancelled", invite_id: result.data.id });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Indicá un miembro o una invitación." }, { status: 400 });
}
