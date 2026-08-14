"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") === "session_expired"
      ? "Tu sesión venció. Volvé a ingresar."
      : ""
  );
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = getSupabaseBrowser();

        if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError(error.message); setLoading(false); return; }
        window.location.href = "/";
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) { setError(error.message); setLoading(false); return; }
        if (data.user && !data.session) { setCheckEmail(true); setLoading(false); return; }
        window.location.href = "/";
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        if (error) { setError(error.message); setLoading(false); return; }
        setCheckEmail(true);
        setLoading(false);
      }
    } catch (err) {
      // Thrown errors (misconfigured env, network down) must not strand the
      // form on "Cargando..." with no feedback.
      setError(err instanceof Error ? err.message : "No se pudo conectar. Intenta de nuevo.");
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 flex min-h-dvh">
      {/* Form side */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-16 max-w-lg mx-auto lg:mx-0 lg:max-w-none lg:flex-[0_0_40%]">
        <div className="absolute top-4 right-4 lg:top-6 lg:right-6">
          <ThemeToggle />
        </div>

        <div className="mb-8">
          <Logo size="large" />
          <p className="text-muted-foreground text-sm mt-2">Gestion agropecuaria inteligente</p>
        </div>

        {checkEmail && (
          <Alert className="mb-6 border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <AlertDescription>
              <p className="font-medium text-emerald-600 dark:text-emerald-400">Revisa tu email</p>
              <p className="text-sm text-muted-foreground mt-1">{mode === "forgot" ? "Te enviamos un enlace para restablecer tu contraseña." : "Te enviamos un link de confirmacion. Hace click en el link para activar tu cuenta."}</p>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-8 space-y-5">
            <h2 className="text-lg font-semibold">
              {mode === "login" ? "Iniciar sesion" : mode === "signup" ? "Crear cuenta" : "Restablecer contraseña"}
            </h2>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required />
            </div>

            {mode !== "forgot" && (
              <div className="space-y-2">
                <Label htmlFor="password">Contrasena</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Cargando..." : mode === "login" ? "Entrar" : mode === "signup" ? "Crear cuenta" : "Enviar enlace"}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" && <><button type="button" onClick={() => { setMode("forgot"); setError(""); setCheckEmail(false); }} className="text-primary hover:underline font-medium">Olvidaste tu contraseña?</button><span className="mx-2">·</span></>}
            {mode === "signup" ? "Ya tenes cuenta?" : mode === "forgot" ? "¿Recordaste tu contraseña?" : "No tenes cuenta?"}{" "}
            <button type="button" onClick={() => { setMode(mode === "signup" || mode === "forgot" ? "login" : "signup"); setError(""); setCheckEmail(false); }} className="text-primary hover:underline font-medium">{mode === "signup" || mode === "forgot" ? "Iniciar sesion" : "Registrate"}</button>
          </p>
        </form>
      </div>

      {/* Hero side — desktop only */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-emerald-950 via-background to-background dark:from-emerald-950/50 dark:via-background dark:to-background relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(5,150,105,0.15),_transparent_50%)]" />
        <div className="relative text-center px-12">
          <h2 className="text-3xl font-bold text-white tracking-tight mb-3">Gestiona tu campo con inteligencia</h2>
          <p className="text-muted-foreground text-base max-w-md mx-auto">Hacienda, cultivos, inventario y finanzas — todo desde una sola plataforma, con soporte de voz y chat.</p>
        </div>
      </div>
    </main>
  );
}
