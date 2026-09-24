import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-[70dvh] flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <Logo size="large" />
        </div>
        <div className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-xs sm:p-8">
          <div className="space-y-1">
            <p className="figure text-5xl font-semibold text-muted-foreground">404</p>
            <h1 className="pt-2 text-xl font-semibold">Página no encontrada</h1>
            <p className="text-sm text-muted-foreground">
              La página que buscás no existe o cambió de lugar. Volvé al inicio o buscala desde el menú.
            </p>
          </div>
          <Button asChild>
            <Link href="/">Volver al inicio</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
