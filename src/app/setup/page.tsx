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
import { ThemeToggle } from "@/components/ThemeToggle";

const OP_TYPES = [
  { value: "livestock", label: "Ganadería", desc: "Bovinos, equinos, ovinos", icons: [Beef] },
  { value: "crops", label: "Agricultura", desc: "Cultivos y cosechas", icons: [Wheat] },
  { value: "mixed", label: "Mixto", desc: "Ganadería y agricultura", icons: [Beef, Wheat] },
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
        setError(result.error || "No se pudo crear el campo. Revisá los datos e intentá de nuevo.");
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
        setError(result.error || "No se pudo cargar el ejemplo. Intentá de nuevo.");
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
    <main className="relative flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <Logo size="large" />
          <p className="mt-3 text-sm text-muted-foreground">Contanos cómo es tu campo y te armamos el tablero.</p>
        </div>
        <div className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-xs sm:p-8">
          <h1 className="text-xl font-semibold">Configurá tu campo</h1>
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
          <div className="grid gap-5 sm:grid-cols-[1fr_1.4fr]">
            <div className="space-y-2">
              <Label htmlFor="farm-hectares">Hectáreas totales</Label>
              <Input
                id="farm-hectares"
                type="text"
                inputMode="decimal"
                value={hectares}
                onChange={(e) => setHectares(e.target.value)}
                placeholder="500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="farm-location">Ubicación</Label>
              <Input
                id="farm-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ej: Paysandú, Uruguay"
                maxLength={200}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label id="setup-op-type-label">Tipo de establecimiento</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-labelledby="setup-op-type-label">
              {OP_TYPES.map((op) => {
                const selected = opType === op.value;
                return (
                  <button type="button" key={op.value} aria-pressed={selected} onClick={() => setOpType(op.value)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-start sm:gap-2 ${
                      selected ? "border-primary bg-primary-soft shadow-[inset_0_0_0_1px_var(--primary)]" : "border-border bg-card hover:bg-accent"
                    }`}>
                    <span className="flex items-center gap-1">
                      {op.icons.map((Icon, i) => (
                        <Icon key={i} className={`h-5 w-5 ${selected ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
                      ))}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-foreground">{op.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{op.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleSubmit} disabled={submitting || !isOnline} title={!isOnline ? "Necesitás conexión para crear el campo" : undefined} className="w-full">
            {submitting ? "Creando…" : "Crear mi campo"}
          </Button>
        </div>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">o</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <Button
          variant="outline"
          onClick={loadSample}
          disabled={submitting || !isOnline}
          title={!isOnline ? "Necesitás conexión para cargar los datos de ejemplo" : undefined}
          className="w-full"
        >
          Probar con datos de ejemplo
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Carga un campo de demostración con hacienda, cultivos, inventario y finanzas para explorar.
        </p>
        {!isOnline && <p role="status" className="mt-3 text-center text-xs text-warn">Conectate a internet para crear el campo o cargar los datos de ejemplo.</p>}
        <div className="mt-8">
          <ServiceHealthCard />
        </div>
      </div>
    </main>
  );
}
