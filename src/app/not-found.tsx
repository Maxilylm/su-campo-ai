import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex-1 flex items-center justify-center px-4 min-h-[70dvh]">
      <div className="w-full max-w-md text-center flex flex-col items-center gap-5">
        <Logo size="large" />
        <div className="space-y-2">
          <p className="text-5xl font-bold tracking-tight text-primary">404</p>
          <h1 className="text-xl font-semibold tracking-tight">Página no encontrada</h1>
          <p className="text-muted-foreground text-sm">
            La página que buscás no existe o fue movida.
          </p>
        </div>
        <Button asChild>
          <Link href="/">Volver al inicio</Link>
        </Button>
      </div>
    </main>
  );
}
