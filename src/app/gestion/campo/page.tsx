"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { notifyFarmChanged, sendJsonResult } from "@/lib/mutate";
import { Save, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { ServiceHealthCard } from "@/components/ServiceHealthCard";
import { DataIntegrityCard } from "@/components/DataIntegrityCard";
import { InstallAppCard } from "@/components/InstallAppCard";
import { OfflineSyncControl } from "@/components/OfflineSyncControl";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { offlineSnapshotKeys } from "@/lib/offline";

const OP_TYPES = [
  { value: "livestock", label: "Ganadería", desc: "Bovinos, equinos, ovinos" },
  { value: "crops", label: "Agricultura", desc: "Cultivos y cosechas" },
  { value: "mixed", label: "Mixto", desc: "Ganadería + agricultura" },
] as const;

export default function CampoPage() {
  const router = useRouter();
  const { farm, userId, loading, error, lastSyncedAt, refreshFarm, readOnly } = useFarm();
  const [name, setName] = useState("");
  const [hectares, setHectares] = useState("");
  const [location, setLocation] = useState("");
  const [operationType, setOperationType] = useState<"livestock" | "crops" | "mixed">("livestock");
  const [saving, setSaving] = useState(false);
  const [copiesCleared, setCopiesCleared] = useState(false);
  const [offlineSyncedAt, setOfflineSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !farm) router.replace("/setup");
  }, [farm, loading, router]);

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
      offlineSnapshotKeys(userId).forEach((key) => window.localStorage.removeItem(key));
      setCopiesCleared(true);
      setOfflineSyncedAt(null);
      toast.success("Copias locales eliminadas", { description: "Los datos de Supabase no fueron modificados." });
    } catch {
      toast.error("No se pudieron eliminar las copias locales.");
    }
  }

  if (loading) return <LoadingPage />;
  if (!farm) return error ? <LoadErrorState title="No se pudo cargar el campo" onRetry={refreshFarm} /> : <LoadingPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Gestión", href: "/gestion/inventario" }, { label: "Mi campo" }]}
        title="Mi campo"
        description="Actualizá los datos generales que usa CampoAI para personalizar el panel y el clima."
        actions={<Button onClick={save} disabled={readOnly || saving || !name.trim()}><Save className="mr-1.5 h-4 w-4" />{saving ? "Guardando…" : "Guardar cambios"}</Button>}
      />

      <section className="max-w-2xl rounded-xl border border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-lg bg-primary/10 p-2"><Settings className="h-5 w-5 text-primary" /></span>
          <div><h2 className="font-medium">Datos generales</h2><p className="text-sm text-muted-foreground">Esta información es privada de tu campo.</p></div>
        </div>
        <div className="grid gap-5">
          <div className="grid gap-2"><Label htmlFor="campo-name">Nombre del campo</Label><Input id="campo-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></div>
          <div className="grid gap-2"><Label htmlFor="campo-hectares">Hectáreas totales</Label><Input id="campo-hectares" type="number" min="0" step="0.01" value={hectares} onChange={(event) => setHectares(event.target.value)} placeholder="500" /></div>
          <div className="grid gap-2"><Label htmlFor="campo-location">Ubicación</Label><Input id="campo-location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={200} placeholder="Ej: Paysandú, Uruguay" /></div>
          <div className="grid gap-2"><Label>Tipo de establecimiento</Label><div className="grid gap-2 sm:grid-cols-3">{OP_TYPES.map((option) => <button type="button" key={option.value} aria-pressed={operationType === option.value} onClick={() => setOperationType(option.value)} className={`rounded-xl border-2 p-3 text-left transition-colors ${operationType === option.value ? "border-primary bg-primary/10" : "border-border bg-muted hover:border-muted-foreground/30"}`}><span className="block text-sm font-semibold">{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.desc}</span></button>)}</div></div>
          <Alert><AlertDescription>Si cambiás la ubicación, el módulo de clima volverá a buscar el pronóstico para el nuevo lugar.</AlertDescription></Alert>
        </div>
      </section>

      <ServiceHealthCard />

      <DataIntegrityCard />

      <InstallAppCard />

      <section className="max-w-2xl rounded-xl border border-border bg-card p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="rounded-lg bg-primary/10 p-2"><ShieldCheck className="h-5 w-5 text-primary" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Datos guardados en este dispositivo</h2>
            <p className="text-sm text-muted-foreground">CampoAI guarda copias privadas para lectura offline. Nunca reemplazan los datos de Supabase.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5">
          <div className="text-sm">
            <p className="font-medium">Última sincronización del panel</p>
            <p className="text-xs text-muted-foreground">{copiesCleared ? "Copias eliminadas de este dispositivo." : offlineSyncedAt || lastSyncedAt ? new Date(offlineSyncedAt || lastSyncedAt || "").toLocaleString("es-UY") : "Todavía no hay una copia local."}</p>
          </div>
          <ConfirmDialog
            trigger={<Button variant="outline" size="sm" disabled={!userId}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Borrar copias locales</Button>}
            title="¿Borrar copias locales?"
            description="Se eliminarán del dispositivo el panel, la agenda, la actividad y el índice de búsqueda offline. Los datos guardados en Supabase no se modifican."
            confirmLabel="Borrar copias"
            onConfirm={clearOfflineCopies}
          />
        </div>
        <div className="mt-3">
          <OfflineSyncControl onSynced={setOfflineSyncedAt} />
        </div>
      </section>
    </div>
  );
}
