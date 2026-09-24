"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const VALID_TYPES = ["email", "signup", "magiclink", "recovery", "email_change", "invite"] as const;

const LINK_ERROR = "El enlace es inválido o venció. Pedí uno nuevo desde la pantalla de ingreso.";

function isValidType(value: string | null): value is (typeof VALID_TYPES)[number] {
  return VALID_TYPES.includes((value || "") as (typeof VALID_TYPES)[number]);
}

/** Only same-origin absolute paths are accepted; "//host" is a protocol-relative URL. */
function safeNext(value: string | null, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

function ConfirmCard() {
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const paramsValid = Boolean(tokenHash) && isValidType(type);
  const destination = safeNext(params.get("next"), type === "recovery" ? "/reset-password" : "/");

  // DESIGN CONSTRAINT — do not "improve" this into a useEffect.
  // Verification must happen ONLY when the person clicks the button, never
  // automatically on page load. Corporate mail scanners and link previewers
  // prefetch every URL in an email; if verifyOtp ran on mount, the scanner would
  // consume the one-time token before the recipient ever opened the message and
  // the real user would land on an "invalid or expired link" error. The click is
  // the whole point of this page.
  async function confirm() {
    if (!tokenHash || !isValidType(type)) return;
    setVerifying(true);
    setError("");
    try {
      const { error: verifyError } = await getSupabaseBrowser().auth.verifyOtp({
        token_hash: tokenHash,
        type: type as EmailOtpType,
      });
      if (verifyError) {
        setError(LINK_ERROR);
        setVerifying(false);
        return;
      }
      // Full navigation (not router.push) so the proxy sees the session cookies
      // Supabase just wrote and stops redirecting to /login.
      window.location.href = destination;
    } catch {
      setError(LINK_ERROR);
      setVerifying(false);
    }
  }

  if (!paramsValid) {
    return (
      <div className={card}>
        <h1 className="text-xl font-semibold">Confirmación de acceso</h1>
        <Alert variant="destructive"><AlertDescription>{LINK_ERROR}</AlertDescription></Alert>
        <Button asChild variant="outline" className="w-full"><Link href="/login">Ir a la pantalla de ingreso</Link></Button>
      </div>
    );
  }

  return (
    <div className={card}>
      <div>
        <h1 className="text-xl font-semibold">Confirmá tu acceso</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Falta un solo paso: tocá el botón para confirmar que fuiste vos quien pidió este enlace.
          Lo hacemos con un clic tuyo para que los filtros de correo no lo usen antes de que llegues.
        </p>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button type="button" className="w-full" onClick={() => void confirm()} disabled={verifying}>
        {verifying ? "Confirmando…" : type === "email" || type === "signup" ? "Confirmar" : "Continuar"}
      </Button>
      {error && (
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:underline">Volver a iniciar sesión</Link>
        </p>
      )}
    </div>
  );
}

const card = "space-y-5 rounded-xl border border-border bg-card p-6 shadow-xs sm:p-8";

export default function ConfirmPage() {
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
        <Suspense fallback={<div className={card} aria-busy="true"><p className="text-sm text-muted-foreground">Cargando…</p></div>}>
          <ConfirmCard />
        </Suspense>
      </div>
    </main>
  );
}
