"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSupabaseBrowser } from "@/lib/supabase";
import { sendJsonResult } from "@/lib/mutate";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const router = useRouter();
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
      window.location.assign(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
    } catch {
      setAccepting(false);
      setError("No se pudo cerrar la sesión actual. Intentá nuevamente.");
    }
  }

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <Logo size="large" />
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10"><Users className="h-6 w-6 text-primary" /></span>
          <h1 className="text-xl font-semibold">Invitación a un campo</h1>
          {loading && <p className="mt-2 text-sm text-muted-foreground">Verificando tu sesión…</p>}
          {!loading && accepted && <Alert className="mt-5 border-emerald-500/30 bg-emerald-500/10 text-left"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><AlertDescription>Ya tenés acceso. Te llevamos al campo.</AlertDescription></Alert>}
          {!loading && !accepted && !email && <><p className="mt-2 text-sm text-muted-foreground">Ingresá con el email que recibió la invitación para continuar.</p><Button className="mt-6 w-full" onClick={goToLogin}>Iniciar sesión</Button></>}
          {!loading && !accepted && email && accepting && <p className="mt-2 text-sm text-muted-foreground">Activando el acceso para {email}…</p>}
          {!loading && !accepted && error && <><Alert variant="destructive" className="mt-5 text-left"><AlertDescription>{error}</AlertDescription></Alert>{error.includes("Ingresá con ese email") && <Button variant="outline" className="mt-4 w-full" onClick={() => void changeUser()} disabled={accepting}>{accepting ? "Cerrando sesión…" : "Cerrar sesión y cambiar de usuario"}</Button>}</>}
        </section>
      </div>
    </main>
  );
}
