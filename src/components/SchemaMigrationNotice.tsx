"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SchemaMigrationNoticeProps {
  migrations: string[];
  compact?: boolean;
}

export function SchemaMigrationNotice({ migrations, compact = false }: SchemaMigrationNoticeProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const uniqueMigrations = Array.from(new Set(migrations));

  if (uniqueMigrations.length === 0) return null;

  async function copyMigrations() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(uniqueMigrations.join("\n"));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className={compact ? "mt-2 text-center" : "mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3"} role="status" aria-live="polite">
      <div className={compact ? "text-[11px] text-muted-foreground" : "flex flex-wrap items-center justify-between gap-2"}>
        <p className={compact ? "" : "text-sm font-medium text-amber-700 dark:text-amber-300"}>
          {compact ? "Supabase necesita actualizarse" : "Migraciones de Supabase pendientes"}
        </p>
        <Button type="button" variant={compact ? "ghost" : "outline"} size="sm" onClick={() => void copyMigrations()} className={compact ? "h-6 px-1.5 text-[11px] text-primary hover:bg-transparent hover:underline" : "h-7 text-xs"}>
          {copyState === "copied" ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
          {copyState === "copied" ? "Copiadas" : "Copiar migraciones"}
        </Button>
      </div>
      {!compact && <p className="mt-1 text-xs text-muted-foreground">Aplicálas en el SQL Editor de Supabase para habilitar todas las protecciones.</p>}
      <div className={compact ? "mt-1 flex flex-wrap justify-center gap-1 text-[11px] text-muted-foreground" : "mt-2 grid gap-1"}>
        {uniqueMigrations.map((migration) => <code key={migration} className="break-all rounded bg-muted px-1.5 py-0.5 text-[11px]">{migration}</code>)}
      </div>
      {copyState === "error" && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">No se pudo copiar; seleccioná la lista manualmente.</p>}
    </div>
  );
}
