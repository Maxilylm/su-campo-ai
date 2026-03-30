"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Beef, Wheat } from "lucide-react";

const OP_TYPES = [
  { value: "livestock", label: "Ganaderia", desc: "Bovinos, equinos, ovinos", icons: [Beef] },
  { value: "crops", label: "Agricultura", desc: "Cultivos, cosechas", icons: [Wheat] },
  { value: "mixed", label: "Mixto", desc: "Ganaderia + Agricultura", icons: [Beef, Wheat] },
] as const;

export default function SetupPage() {
  const { refreshFarm } = useFarm();
  const router = useRouter();
  const [name, setName] = useState("");
  const [hectares, setHectares] = useState("");
  const [location, setLocation] = useState("");
  const [opType, setOpType] = useState<string>("livestock");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/farm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "Mi Campo",
          totalHectares: hectares ? Number(hectares) : null,
          location: location || null,
          operationType: opType,
        }),
      });
      if (res.ok) {
        await refreshFarm();
        router.push("/");
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.error || "Error al crear el campo. Intenta de nuevo.");
    } catch {
      setError("Error de conexion. Verifica tu internet e intenta de nuevo.");
    }
    setSubmitting(false);
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
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="farm-hectares">Hectareas totales</Label>
            <Input
              id="farm-hectares"
              type="number"
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
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo de establecimiento</Label>
            <div className="grid grid-cols-3 gap-2">
              {OP_TYPES.map((op) => (
                <button key={op.value} onClick={() => setOpType(op.value)}
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
          <Button onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting ? "Creando..." : "Crear mi campo"}
          </Button>
        </div>
      </div>
    </main>
  );
}
