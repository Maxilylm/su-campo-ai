"use client";

import { useEffect, useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { notifyFarmChanged, sendJsonResult } from "@/lib/mutate";
import { Save, Trash2 } from "lucide-react";
import { ServiceHealthCard } from "@/components/ServiceHealthCard";
import { DataIntegrityCard } from "@/components/DataIntegrityCard";
import { InstallAppCard } from "@/components/InstallAppCard";
import { OfflineSyncControl } from "@/components/OfflineSyncControl";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { clearOfflineSnapshots } from "@/lib/offline";
import { useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { FarmMembersCard } from "@/components/FarmMembersCard";

const OP_TYPES = [
  { value: "livestock", label: "Ganadería", desc: "Bovinos, equinos, ovinos" },
  { value: "crops", label: "Agricultura", desc: "Cultivos y cosechas" },
  { value: "mixed", label: "Mixto", desc: "Ganadería + agricultura" },
] as const;

export default function CampoPage() {
  const replace = useOfflineAwareReplace();
  const { farm, userId, loading, error, lastSyncedAt, refreshFarm, readOnly, clearOfflineSnapshotStale } = useFarm();
  const [name, setName] = useState("");
  const [hectares, setHectares] = useState("");
  const [location, setLocation] = useState("");
  const [operationType, setOperationType] = useState<"livestock" | "crops" | "mixed">("livestock");
  const [saving, setSaving] = useState(false);
  const [copiesCleared, setCopiesCleared] = useState(false);
  const [offlineSyncedAt, setOfflineSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !farm) replace("/setup");
  }, [farm, loading, replace]);

  useEffect(() => {
    if (!farm) return;
    setName(farm.name);
    setHectares(farm.total_hectares == null ? "" : String(farm.total_hectares));
    setLocation(farm.location || "");
    setOperationType(farm.operation_type);
  }, [farm]);

  async function save() {
    if (readOnly || !name.trim()) return;
    setSaving(true);
    try {
      const result = await sendJsonResult("/api/farm", "PUT", {
        name,
        totalHectares: hectares || null,
        location: location || null,
        operationType,
      });
      if (!result.ok) {
        toast.error(result.error || "No se pudo actualizar el campo.");
        return;
      }
      await refreshFarm();
      notifyFarmChanged();
      toast.success("Datos del campo actualizados");
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    } finally {
      setSaving(false);
    }
  }

  function clearOfflineCopies() {
    if (!userId) return;
    try {
      clearOfflineSnapshots(window.localStorage, userId);
      clearOfflineSnapshotStale();
      setCopiesCleared(true);
      setOfflineSyncedAt(null);
      toast.success("Copias locales eliminadas", { description: "Los datos de Supabase no fueron modificados." });
    } catch {
      toast.error("No se pudieron eliminar las copias locales.");
    }
  }

  if (loading) return <LoadingPage />;
  if (!farm) return error ? <LoadErrorState title={readOnly ? "Campo no disponible sin conexión" : "No se pudo cargar el campo"} description={readOnly ? "Conectate a internet para sincronizar los datos del campo." : undefined} onRetry={readOnly ? undefined : refreshFarm} /> : <LoadingPage />;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Mi campo"
        description="Datos generales que usa CampoAI para personalizar el panel y el clima."
        actions={<Button onClick={save} disabled={readOnly || saving || !name.trim()}><Save aria-hidden="true" />{saving ? "Guardando…" : "Guardar cambios"}</Button>}
      />

      <div className="space-y-10">
        <section aria-labelledby="campo-general-title">
          <div className="mb-3">
            <h2 id="campo-general-title" className="text-base font-semibold">Datos generales</h2>
            <p className="text-sm text-muted-foreground">Esta información es privada de tu campo.</p>
          </div>
          <div className="grid gap-5 rounded-lg border border-border bg-card p-4 sm:p-5">
            <div className="grid gap-2"><Label htmlFor="campo-name">Nombre del campo</Label><Input id="campo-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="campo-hectares">Hectáreas totales</Label><Input id="campo-hectares" type="text" inputMode="decimal" value={hectares} onChange={(event) => setHectares(event.target.value)} placeholder="500" /></div>
              <div className="grid gap-2"><Label htmlFor="campo-location">Ubicación</Label><Input id="campo-location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={200} placeholder="Ej: Paysandú, Uruguay" /></div>
            </div>
            <div className="grid gap-2">
              <Label id="campo-op-type-label">Tipo de establecimiento</Label>
              <div className="grid gap-2 sm:grid-cols-3" role="group" aria-labelledby="campo-op-type-label">
                {OP_TYPES.map((option) => {
                  const selected = operationType === option.value;
                  return (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={selected}
                      onClick={() => setOperationType(option.value)}
                      className={`rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${selected ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-border bg-card hover:bg-accent"}`}
                    >
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{option.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Si cambiás la ubicación, el clima vuelve a buscar el pronóstico para el nuevo lugar.</p>
          </div>
        </section>
  
        <FarmMembersCard />
  
        <ServiceHealthCard />
  
        <DataIntegrityCard />
  
        <InstallAppCard />
  
        <section aria-labelledby="campo-device-title">
          <div className="mb-3">
            <h2 id="campo-device-title" className="text-base font-semibold">Datos guardados en este dispositivo</h2>
            <p className="text-sm text-muted-foreground">CampoAI guarda copias privadas para consultar sin conexión. Nunca reemplazan los datos de Supabase.</p>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3.5">
              <div className="text-sm">
                <p className="font-medium">Última sincronización del panel</p>
                <p className="text-xs text-muted-foreground">{copiesCleared ? "Copias eliminadas de este dispositivo." : offlineSyncedAt || lastSyncedAt ? new Date(offlineSyncedAt || lastSyncedAt || "").toLocaleString("es-UY") : "Todavía no hay una copia local."}</p>
              </div>
              <ConfirmDialog
                trigger={<Button variant="outline" size="sm" disabled={!userId}><Trash2 aria-hidden="true" />Borrar copias locales</Button>}
                title="¿Borrar copias locales?"
                description="Se eliminarán del dispositivo el panel, agenda, finanzas, inventario, métricas, pesajes, actividad, clima, mapa e índice de búsqueda offline. Los datos guardados en Supabase no se modifican."
                confirmLabel="Borrar copias"
                onConfirm={clearOfflineCopies}
              />
            </div>
            <OfflineSyncControl onSynced={setOfflineSyncedAt} />
          </div>
        </section>
      </div>
    </div>
  );
}
