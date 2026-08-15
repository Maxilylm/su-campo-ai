"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { useFarm } from "@/contexts/FarmContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fetchWithTimeout } from "@/lib/fetch";
import { sendJsonResult } from "@/lib/mutate";

type Member = { id: string; email: string | null; role: "owner" | "editor" | "viewer"; created_at: string };
type Invite = { id: string; email: string; role: "editor" | "viewer"; expires_at: string; created_at: string };

const roleLabel: Record<Member["role"] | Invite["role"], string> = {
  owner: "Propietario",
  editor: "Editor",
  viewer: "Solo lectura",
};

export function FarmMembersCard() {
  const { farm, accessRole, isOnline, readOnly } = useFarm();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [changingMemberId, setChangingMemberId] = useState<string | null>(null);
  const canManage = accessRole === "owner" && isOnline && !readOnly;

  const load = useCallback(async () => {
    if (!farm || !isOnline) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetchWithTimeout("/api/members", { cache: "no-store" }, 8000);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudieron cargar los miembros.");
      setMembers(Array.isArray(payload.members) ? payload.members : []);
      setInvites(Array.isArray(payload.invites) ? payload.invites : []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los miembros.");
    } finally {
      setLoading(false);
    }
  }, [farm, isOnline]);

  useEffect(() => { void load(); }, [load]);

  async function invite() {
    if (!email.trim() || !canManage) return;
    setSaving(true);
    setError("");
    setInviteLink("");
    try {
      const response = await fetchWithTimeout("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      }, 10000);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo crear la invitación.");
      setInviteLink(typeof payload.link === "string" ? payload.link : "");
      setEmail("");
      await load();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "No se pudo crear la invitación.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: { memberId?: string; inviteId?: string }) {
    if (!canManage) return;
    const result = await sendJsonResult("/api/members", "DELETE", item);
    if (!result.ok) {
      setError(result.error || "No se pudo quitar el acceso.");
      return;
    }
    await load();
  }

  async function updateRole(memberId: string, nextRole: "editor" | "viewer") {
    if (!canManage) return;
    setChangingMemberId(memberId);
    setError("");
    const result = await sendJsonResult("/api/members", "PATCH", { memberId, role: nextRole });
    if (!result.ok) setError(result.error || "No se pudo actualizar el rol.");
    else await load();
    setChangingMemberId(null);
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("No se pudo copiar el enlace. Seleccionalo y copialo manualmente.");
    }
  }

  if (!farm) return null;

  return (
    <section className="max-w-2xl rounded-xl border border-border bg-card p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-lg bg-primary/10 p-2"><Users className="h-5 w-5 text-primary" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">Personas con acceso</h2>
          <p className="text-sm text-muted-foreground">Invitá a tu equipo como editor o con acceso de solo lectura.</p>
        </div>
      </div>

      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {loading ? <p className="text-sm text-muted-foreground">Cargando accesos…</p> : (
        <div className="space-y-2">
          {members.map((member) => (
            <div key={member.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <Shield className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.email || "Usuario sin email"}</p>{(!canManage || member.role === "owner") && <p className="text-xs text-muted-foreground">{roleLabel[member.role]}</p>}</div>
              {canManage && member.role !== "owner" && <Select value={member.role} onValueChange={(value) => void updateRole(member.id, value as "editor" | "viewer")} disabled={changingMemberId === member.id}><SelectTrigger className="w-[140px]" aria-label={`Rol de ${member.email || "usuario"}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Solo lectura</SelectItem></SelectContent></Select>}
              {canManage && member.role !== "owner" && <Button type="button" variant="ghost" size="icon" aria-label={`Quitar acceso de ${member.email || "usuario"}`} onClick={() => void remove({ memberId: member.id })}><Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" /></Button>}
            </div>
          ))}
          {invites.map((inviteItem) => (
            <div key={inviteItem.id} className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3">
              <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{inviteItem.email}</p><p className="text-xs text-muted-foreground">Invitación pendiente · {roleLabel[inviteItem.role]}</p></div>
              {canManage && <Button type="button" variant="ghost" size="icon" aria-label={`Cancelar invitación de ${inviteItem.email}`} onClick={() => void remove({ inviteId: inviteItem.id })}><Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" /></Button>}
            </div>
          ))}
          {!members.length && !invites.length && <p className="text-sm text-muted-foreground">Todavía no hay otros accesos.</p>}
        </div>
      )}

      {accessRole === "owner" && (
        <div className="mt-5 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="grid gap-2"><Label htmlFor="member-email">Email del trabajador</Label><Input id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="trabajador@ejemplo.com" disabled={!canManage || saving} /></div>
            <div className="grid gap-2"><Label htmlFor="member-role">Permiso</Label><Select value={role} onValueChange={(value) => setRole(value as "editor" | "viewer")} disabled={!canManage || saving}><SelectTrigger id="member-role" className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Solo lectura</SelectItem></SelectContent></Select></div>
            <Button type="button" onClick={() => void invite()} disabled={!canManage || saving || !email.trim()}><UserPlus className="mr-1.5 h-4 w-4" />{saving ? "Generando…" : "Invitar"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">La invitación dura 7 días. Compartí el enlace generado con la persona para que ingrese con ese mismo email.</p>
          {inviteLink && <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2"><code className="min-w-0 flex-1 truncate text-xs">{inviteLink}</code><Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>{copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}{copied ? "Copiado" : "Copiar"}</Button></div>}
        </div>
      )}
      {accessRole !== "owner" && <p className="mt-4 text-xs text-muted-foreground">Solo el propietario puede invitar o quitar personas.</p>}
    </section>
  );
}
