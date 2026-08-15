"use client";

import { useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Button } from "@/components/ui/button";
import { RefreshCw, WifiOff } from "lucide-react";

export function ConnectionBanner() {
  const { farm, offlineMode, isOnline, lastSyncedAt, refreshFarm } = useFarm();
  const [retrying, setRetrying] = useState(false);

  if (!farm || (isOnline && !offlineMode)) return null;

  async function retry() {
    setRetrying(true);
    try {
      await refreshFarm();
    } finally {
      setRetrying(false);
    }
  }

  const title = isOnline ? "Conexión con el servidor interrumpida" : "Sin conexión";
  const detail = lastSyncedAt
    ? `Mostrando datos sincronizados el ${new Date(lastSyncedAt).toLocaleString("es-UY")}. Los cambios no se guardarán hasta recuperar la conexión.`
    : "Los cambios no se guardarán hasta recuperar la conexión.";

  return (
    <div role="status" aria-live="polite" className="border-b border-amber-300/60 bg-amber-50 px-4 py-2.5 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="mx-auto flex max-w-6xl items-center gap-3 text-sm">
        <WifiOff className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title} · modo lectura</p>
          <p className="text-xs opacity-80">{detail}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void retry()} disabled={retrying} className="shrink-0 border-amber-400/60 bg-transparent text-amber-950 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40">
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
