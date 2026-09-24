"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70dvh] flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <Logo size="large" />
        </div>
        <div className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-xs sm:p-8">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bad-soft text-bad">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">Algo salió mal</h1>
              <p className="text-sm text-muted-foreground">
                Ocurrió un error inesperado y no se pudo mostrar esta pantalla. Reintentá; si sigue pasando, volvé al inicio.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Reintentar</Button>
            {/* A full reload is the safest recovery from an error boundary. */}
            {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
            <Button variant="outline" onClick={() => (window.location.href = "/")}>
              Ir al inicio
            </Button>
          </div>
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">Referencia: {error.digest}</p>
          )}
        </div>
      </div>
    </main>
  );
}
