"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Beef, Wheat } from "lucide-react";
import { createIdempotencyKey, notifyFarmChanged, sendJsonResult } from "@/lib/mutate";
import { validateFarmProfileInput } from "@/lib/farm-input";
import { ServiceHealthCard } from "@/components/ServiceHealthCard";

const OP_TYPES = [
  { value: "livestock", label: "Ganaderia", desc: "Bovinos, equinos, ovinos", icons: [Beef] },
  { value: "crops", label: "Agricultura", desc: "Cultivos, cosechas", icons: [Wheat] },
  { value: "mixed", label: "Mixto", desc: "Ganaderia + Agricultura", icons: [Beef, Wheat] },
] as const;

export default function SetupPage() {
  const { refreshFarm, isOnline } = useFarm();
  const router = useRouter();
  const [name, setName] = useState("");
  const [hectares, setHectares] = useState("");
  const [location, setLocation] = useState("");
  const [opType, setOpType] = useState<string>("livestock");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const sampleRequestId = useRef<string | null>(null);

  async function handleSubmit() {
    setError("");
    const validated = validateFarmProfileInput({ name, totalHectares: hectares, location, operationType: opType }, "create");
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setSubmitting(true);
    try {
      const result = await sendJsonResult("/api/farm", "POST", validated.value);
      if (!result.ok) {
        setError(result.error || "Error al crear el campo. Intenta de nuevo.");
        return;
      }
      await refreshFarm();
      notifyFarmChanged();
      router.push("/");
    } catch {
      setError("El campo pudo haberse creado, pero no se pudo actualizar la pantalla. Revisá la conexión e intentá nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadSample() {
    setSubmitting(true);
    setError("");
    sampleRequestId.current ||= createIdempotencyKey();
    try {
      const result = await sendJsonResult("/api/sample-data", "POST", undefined, { idempotencyKey: sampleRequestId.current, timeoutMs: 30000 });
      if (!result.ok) {
        setError(result.error || "No se pudo cargar el ejemplo. Intenta de nuevo.");
        return;
      }
      await refreshFarm();
      sampleRequestId.current = null;
      notifyFarmChanged();
      router.push("/");
    } catch {
      setError("Los datos de ejemplo pudieron haberse creado, pero no se pudo actualizar la pantalla. Revisá la conexión e intentá nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8 flex flex-col items-center gap-3">
          <Logo size="large" />
          <p className="text-muted-foreground text-sm">Configura tu campo para empezar</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="farm-name">Nombre del campo</Label>
            <Input
              id="farm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Estancia La Gloria"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="farm-hectares">Hectareas totales</Label>
            <Input
              id="farm-hectares"
              type="number"
              min="0"
              step="0.01"
              value={hectares}
              onChange={(e) => setHectares(e.target.value)}
              placeholder="500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="farm-location">Ubicacion</Label>
            <Input
              id="farm-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ej: Paysandu, Uruguay"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo de establecimiento</Label>
            <div className="grid grid-cols-3 gap-2">
              {OP_TYPES.map((op) => (
                <button type="button" key={op.value} aria-pressed={opType === op.value} onClick={() => setOpType(op.value)}
                  className={`rounded-xl border-2 p-3 text-center transition-colors ${
                    opType === op.value ? "border-primary bg-primary/10" : "border-border bg-muted hover:border-muted-foreground/30"
                  }`}>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    {op.icons.map((Icon, i) => (
                      <Icon key={i} className="h-6 w-6 text-foreground" />
                    ))}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{op.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{op.desc}</div>
                </button>
              ))}
            </div>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleSubmit} disabled={submitting || !isOnline} title={!isOnline ? "Necesitás conexión para crear el campo" : undefined} className="w-full">
            {submitting ? "Creando..." : "Crear mi campo"}
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">o</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <Button
          variant="outline"
          onClick={loadSample}
          disabled={submitting || !isOnline}
          title={!isOnline ? "Necesitás conexión para cargar los datos de ejemplo" : undefined}
          className="w-full mt-4"
        >
          Probar con datos de ejemplo
        </Button>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Carga un campo demo con hacienda, cultivos, inventario y finanzas para explorar.
        </p>
        {!isOnline && <p role="status" className="mt-3 text-center text-xs text-amber-700 dark:text-amber-300">Conectate a internet para crear el campo o cargar los datos de ejemplo.</p>}
        <div className="mt-6">
          <ServiceHealthCard />
        </div>
      </div>
    </main>
  );
}
