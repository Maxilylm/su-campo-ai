"use client";

import { useEffect } from "react";
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
    <main className="flex-1 flex items-center justify-center px-4 min-h-[70dvh]">
      <div className="w-full max-w-md text-center flex flex-col items-center gap-5">
        <Logo size="large" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Algo salió mal</h1>
          <p className="text-muted-foreground text-sm">
            Ocurrió un error inesperado. Podés reintentar o volver al inicio.
          </p>
        </div>
        <div className="flex gap-3">
          <Button onClick={reset}>Reintentar</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            Ir al inicio
          </Button>
        </div>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60 font-mono">ref: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
