"use client";

import { useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Button } from "@/components/ui/button";
import { RefreshCw, WifiOff } from "lucide-react";

export function ConnectionBanner() {
  const { farm, offlineMode, isOnline, lastSyncedAt, offlineSyncWarnings, offlineSnapshotStale, refreshFarm } = useFarm();
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
  const detail = [
    lastSyncedAt ? `Mostrando datos sincronizados el ${new Date(lastSyncedAt).toLocaleString("es-UY")}.` : null,
    offlineSnapshotStale ? "La copia puede no incluir cambios recientes; sincronizala al recuperar la conexión." : null,
    offlineSyncWarnings.length > 0 ? "La última sincronización fue parcial; algunos módulos conservan la copia anterior." : null,
    "Los cambios no se guardarán hasta recuperar la conexión.",
  ].filter(Boolean).join(" ");

  return (
    <div role="status" aria-live="polite" className="border-b border-warn-line bg-warn-soft px-4 py-2.5 text-foreground sm:px-6">
      <div className="mx-auto flex max-w-6xl items-start gap-3 text-sm sm:items-center">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warn sm:mt-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium"><span className="text-warn">{title}</span> · modo lectura</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
          {offlineSyncWarnings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {offlineSyncWarnings.slice(0, 3).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
              {offlineSyncWarnings.length > 3 && <li>Hay {offlineSyncWarnings.length - 3} avisos más en Mi campo.</li>}
            </ul>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void retry()} disabled={retrying || !isOnline} title={!isOnline ? "Se reintentará automáticamente al recuperar la conexión" : undefined} className="shrink-0 border-warn-line">
          <RefreshCw className={retrying ? "animate-spin" : ""} aria-hidden="true" />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
