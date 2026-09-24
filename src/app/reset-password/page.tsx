"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authErrorMessage } from "@/lib/auth-errors";
import Link from "next/link";

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
      if (updateError) { setError(authErrorMessage(updateError, "No se pudo actualizar la contraseña.")); return; }
      router.replace("/");
    } catch (cause) {
      setError(authErrorMessage(cause, "No se pudo actualizar la contraseña. Pedí un enlace nuevo e intentá otra vez."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8">
          <Logo size="large" />
          <p className="mt-3 text-sm text-muted-foreground">Gestión ganadera y agrícola</p>
        </div>
        <form onSubmit={save} className="space-y-6">
          <div className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-xs sm:p-8">
            <div>
              <h1 className="text-xl font-semibold">Elegí una nueva contraseña</h1>
              <p className="mt-1 text-sm text-muted-foreground">Usá al menos 6 caracteres.</p>
            </div>
            <div className="space-y-2"><Label htmlFor="new-password">Nueva contraseña</Label><PasswordInput id="new-password" autoComplete="new-password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "password-feedback" : undefined} /></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">Repetir contraseña</Label><PasswordInput id="confirm-password" autoComplete="new-password" minLength={6} required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "password-feedback" : undefined} /></div>
            {error && <Alert variant="destructive" id="password-feedback"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={saving}>{saving ? "Guardando…" : "Guardar contraseña"}</Button>
          </div>
          <p className="text-center text-sm text-muted-foreground"><Link href="/login" className="font-medium text-primary hover:underline">Volver a iniciar sesión</Link></p>
        </form>
      </div>
    </main>
  );
}
