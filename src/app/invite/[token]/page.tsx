"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSupabaseBrowser } from "@/lib/supabase";
import { sendJsonResult } from "@/lib/mutate";
import { useFarm } from "@/contexts/FarmContext";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const router = useRouter();
  const { refreshFarm } = useFarm();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void params.then(({ token: nextToken }) => {
      if (!active) return;
      setToken(nextToken);
      void getSupabaseBrowser().auth.getUser().then(({ data }) => {
        if (!active) return;
        if (!data.user) {
          setLoading(false);
          return;
        }
        setEmail(data.user.email || "");
        setLoading(false);
        setAccepting(true);
        void accept(nextToken);
      }).catch(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
    // The token is supplied by Next's route params and remains stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function accept(inviteToken = token) {
    if (!inviteToken) return;
    setAccepting(true);
    setError("");
    const result = await sendJsonResult("/api/members/accept", "POST", { token: inviteToken });
    if (!result.ok) {
      setError(result.error || "No se pudo aceptar la invitación.");
      setAccepting(false);
      return;
    }
    setAccepted(true);
    setAccepting(false);
    // The shared farm context loads once per session, so pick up the new
    // membership before landing on the dashboard.
    await refreshFarm();
    window.setTimeout(() => router.push("/"), 900);
  }

  function goToLogin() {
    router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  async function changeUser() {
    setAccepting(true);
    setError("");
    try {
      const { error: signOutError } = await getSupabaseBrowser().auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      // Full reload: the previous user's in-memory farm state must not survive a sign-out.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
    } catch {
      setAccepting(false);
      setError("No se pudo cerrar la sesión actual. Intentá nuevamente.");
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
        <section aria-live="polite" className="rounded-xl border border-border bg-card p-6 shadow-xs sm:p-8">
          <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-primary-soft"><Users className="h-5 w-5 text-primary" aria-hidden="true" /></span>
          <h1 className="text-xl font-semibold">Invitación a un campo</h1>
          {loading && <p className="mt-2 text-sm text-muted-foreground">Verificando tu sesión…</p>}
          {!loading && accepted && <Alert className="mt-5 border-ok-line bg-ok-soft text-left"><CheckCircle2 className="h-4 w-4 text-ok" /><AlertDescription>Ya tenés acceso. Te llevamos al campo.</AlertDescription></Alert>}
          {!loading && !accepted && !email && <><p className="mt-2 text-sm text-muted-foreground">Ingresá con el email que recibió la invitación para continuar.</p><Button className="mt-6 w-full" onClick={goToLogin}>Iniciar sesión</Button></>}
          {!loading && !accepted && email && accepting && <p className="mt-2 text-sm text-muted-foreground">Activando el acceso para {email}…</p>}
          {!loading && !accepted && error && <><Alert variant="destructive" className="mt-5 text-left"><AlertDescription>{error}</AlertDescription></Alert>{error.includes("Ingresá con ese email") && <Button variant="outline" className="mt-4 w-full" onClick={() => void changeUser()} disabled={accepting}>{accepting ? "Cerrando sesión…" : "Cerrar sesión y cambiar de usuario"}</Button>}</>}
        </section>
      </div>
    </main>
  );
}
