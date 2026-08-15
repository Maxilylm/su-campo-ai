"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authErrorMessage } from "@/lib/auth-errors";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setSaving(true);
    setError("");
    try {
      const { error: updateError } = await getSupabaseBrowser().auth.updateUser({ password });
      if (updateError) { setError(authErrorMessage(updateError, "No se pudo actualizar la contraseña.")); setSaving(false); return; }
      router.replace("/");
    } catch {
      setError("No se pudo actualizar la contraseña. Pedí un enlace nuevo e intentá otra vez.");
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-6">
      <form onSubmit={save} className="w-full max-w-md rounded-2xl border border-border bg-card p-8 space-y-5">
        <div><Logo size="large" /><p className="mt-2 text-sm text-muted-foreground">Elegí una nueva contraseña</p></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="space-y-2"><Label htmlFor="new-password">Nueva contraseña</Label><Input id="new-password" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="confirm-password">Repetir contraseña</Label><Input id="confirm-password" type="password" minLength={6} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        <Button type="submit" className="w-full" disabled={saving}>{saving ? "Guardando..." : "Guardar contraseña"}</Button>
      </form>
    </main>
  );
}
