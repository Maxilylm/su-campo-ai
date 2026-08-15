"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { safeNextPath } from "@/lib/navigation";
import { serviceStatusLabel, type ServiceStatusPayload } from "@/lib/service-status";
import { fetchServiceStatus } from "@/lib/service-status-client";
import { authErrorMessage, authRedirectError } from "@/lib/auth-errors";
import { SchemaMigrationNotice } from "@/components/SchemaMigrationNotice";
import { ServiceHealthReport } from "@/components/ServiceHealthReport";
import { useFarm } from "@/contexts/FarmContext";

function subscribeToLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function getRedirectError() {
  return authRedirectError(new URLSearchParams(window.location.search).get("error"));
}

function getServerRedirectError() {
  return "";
}

export default function LoginPage() {
  const { isOnline } = useFarm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const redirectError = useSyncExternalStore(subscribeToLocation, getRedirectError, getServerRedirectError);
  const [checkEmail, setCheckEmail] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<"checking" | "healthy" | "degraded">("checking");
  const [supabaseReason, setSupabaseReason] = useState<string>();
  const [authReason, setAuthReason] = useState<string>();
  const [groqReason, setGroqReason] = useState<string>();
  const [schemaReason, setSchemaReason] = useState<string>();
  const [tasksMigrationRequired, setTasksMigrationRequired] = useState(false);
  const [schemaMigrations, setSchemaMigrations] = useState<string[]>([]);
  const [statusPayload, setStatusPayload] = useState<ServiceStatusPayload | null>(null);
  const [statusCheckedAt, setStatusCheckedAt] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [showServiceDetails, setShowServiceDetails] = useState(false);
  const [statusRetry, setStatusRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!isOnline) {
      const offlineTimer = setTimeout(() => {
        if (!active) return;
        setServiceStatus("degraded");
        setSupabaseReason(undefined);
        setAuthReason(undefined);
        setGroqReason(undefined);
        setSchemaReason(undefined);
        setTasksMigrationRequired(false);
        setSchemaMigrations([]);
        setStatusPayload(null);
        setStatusCheckedAt(new Date().toISOString());
        setStatusError(false);
      }, 0);
      return () => { active = false; controller.abort(); clearTimeout(offlineTimer); };
    }
    // The first request after a server wake-up can briefly time out. The
    // shared client retries only those transient responses; migrations and
    // missing configuration remain visible immediately.
    fetchServiceStatus({ signal: controller.signal })
      .then(({ payload, checkedAt }) => {
        if (!active) return;
        setStatusPayload(payload);
        setStatusCheckedAt(checkedAt);
        setStatusError(false);
        setServiceStatus(payload.ok ? "healthy" : "degraded");
        setSupabaseReason(payload.supabaseReason);
        setAuthReason(payload.authReason);
        setGroqReason(payload.groqReason);
        setSchemaReason(payload.features?.schema?.reason);
        setTasksMigrationRequired(payload.features?.tasks?.reason === "migration_required");
        setSchemaMigrations(payload.features?.schema?.missingMigrations || []);
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setSupabaseReason("timeout");
        setAuthReason("timeout");
        setServiceStatus("degraded");
        setStatusPayload(null);
        setStatusCheckedAt(new Date().toISOString());
        setStatusError(true);
      });
    return () => { active = false; controller.abort(); };
  }, [isOnline, statusRetry]);

  function retryServiceStatus() {
    setServiceStatus("checking");
    setSupabaseReason(undefined);
    setAuthReason(undefined);
    setGroqReason(undefined);
    setSchemaReason(undefined);
    setSchemaMigrations([]);
    setStatusPayload(null);
    setStatusCheckedAt(null);
    setStatusError(false);
    setStatusRetry((value) => value + 1);
  }

  function nextPath(): string {
    return safeNextPath(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next"));
  }

  function clearAuthFeedback() {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("error")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    setError("");
    setCheckEmail(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = getSupabaseBrowser();
      const normalizedEmail = email.trim().toLowerCase();
      setEmail(normalizedEmail);

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) { setError(authErrorMessage(error, "No se pudo ingresar.")); setLoading(false); return; }
        window.location.href = nextPath();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail, password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath())}` },
        });
        if (error) { setError(authErrorMessage(error, "No se pudo crear la cuenta.")); setLoading(false); return; }
        if (data.user && !data.session) { setCheckEmail(true); setLoading(false); return; }
        window.location.href = nextPath();
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        if (error) { setError(authErrorMessage(error, "No se pudo enviar el enlace.")); setLoading(false); return; }
        setCheckEmail(true);
        setLoading(false);
      }
    } catch (err) {
      // Thrown errors (misconfigured env, network down) must not strand the
      // form on "Cargando..." with no feedback.
      setError(authErrorMessage(err, "No se pudo conectar. Intentá de nuevo."));
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
          <p className="text-muted-foreground text-sm mt-2">Gestión agropecuaria inteligente</p>
        </div>

        {checkEmail && (
          <Alert className="mb-6 border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <AlertDescription>
              <p className="font-medium text-emerald-600 dark:text-emerald-400">Revisa tu email</p>
              <p className="text-sm text-muted-foreground mt-1">{mode === "forgot" ? "Te enviamos un enlace para restablecer tu contraseña." : "Te enviamos un enlace de confirmación. Hacé clic en el enlace para activar tu cuenta."}</p>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-8 space-y-5">
            <h2 className="text-lg font-semibold">
              {mode === "login" ? "Iniciar sesión" : mode === "signup" ? "Crear cuenta" : "Restablecer contraseña"}
            </h2>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                autoComplete={mode === "signup" ? "email" : "username"}
                aria-invalid={Boolean(error || redirectError)}
                aria-describedby={error || redirectError ? "auth-feedback" : undefined}
                required
              />
            </div>

            {mode !== "forgot" && (
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  aria-invalid={Boolean(error || redirectError)}
                  aria-describedby={error || redirectError ? "auth-feedback" : undefined}
                  required
                  minLength={6}
                />
              </div>
            )}

            {(error || redirectError) && (
              <Alert variant="destructive" id="auth-feedback">
                <AlertDescription>{error || redirectError}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Cargando..." : mode === "login" ? "Entrar" : mode === "signup" ? "Crear cuenta" : "Enviar enlace"}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" && <><button type="button" onClick={() => { clearAuthFeedback(); setMode("forgot"); }} className="text-primary hover:underline font-medium">Olvidaste tu contraseña?</button><span className="mx-2">·</span></>}
            {mode === "signup" ? "¿Ya tenés cuenta?" : mode === "forgot" ? "¿Recordaste tu contraseña?" : "¿No tenés cuenta?"}{" "}
            <button type="button" onClick={() => { clearAuthFeedback(); setMode(mode === "signup" || mode === "forgot" ? "login" : "signup"); }} className="text-primary hover:underline font-medium">{mode === "signup" || mode === "forgot" ? "Iniciar sesión" : "Registrate"}</button>
          </p>
          <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            {serviceStatus === "healthy" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : serviceStatus === "degraded" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-muted-foreground/50" />}
            <span>{serviceStatusLabel(serviceStatus, supabaseReason, groqReason, authReason, schemaReason)}</span>
            {(serviceStatus === "degraded" || statusError) && <Button type="button" variant="ghost" size="sm" onClick={retryServiceStatus} className="h-6 px-1.5 text-xs text-primary hover:bg-transparent hover:underline">Reintentar</Button>}
            {statusCheckedAt && <Button type="button" variant="ghost" size="sm" onClick={() => setShowServiceDetails((current) => !current)} className="h-6 px-1.5 text-xs text-primary hover:bg-transparent hover:underline">
              {showServiceDetails ? "Ocultar diagnóstico" : "Ver diagnóstico"}
            </Button>}
          </div>
          {tasksMigrationRequired && <p className="text-center text-[11px] text-muted-foreground">La agenda requiere actualizar Supabase para activarse.</p>}
          {schemaMigrations.length > 0 && <SchemaMigrationNotice migrations={schemaMigrations} compact />}
        </form>
        {showServiceDetails && <div className="mt-4"><ServiceHealthReport data={statusPayload} loading={serviceStatus === "checking"} error={statusError} checkedAt={statusCheckedAt} isOnline={isOnline} onCheck={retryServiceStatus} compact /></div>}
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
