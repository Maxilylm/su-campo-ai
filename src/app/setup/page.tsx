"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";

const OP_TYPES = [
  { value: "livestock", icon: "🐄", label: "Ganadería", desc: "Bovinos, equinos, ovinos" },
  { value: "crops", icon: "🌾", label: "Agricultura", desc: "Cultivos, cosechas" },
  { value: "mixed", icon: "🐄🌾", label: "Mixto", desc: "Ganadería + Agricultura" },
] as const;

export default function SetupPage() {
  const { refreshFarm } = useFarm();
  const router = useRouter();
  const [name, setName] = useState("");
  const [hectares, setHectares] = useState("");
  const [location, setLocation] = useState("");
  const [opType, setOpType] = useState<string>("livestock");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
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
    if (res.ok) { await refreshFarm(); router.push("/"); }
    setSubmitting(false);
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🌿</div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-emerald-400">Campo</span>AI
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Configurá tu campo para empezar</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-5">
          <Input label="Nombre del campo" value={name} onChange={setName} placeholder="Ej: Estancia La Gloria" />
          <Input label="Hectáreas totales" value={hectares} onChange={setHectares} placeholder="500" type="number" />
          <Input label="Ubicación" value={location} onChange={setLocation} placeholder="Ej: Paysandú, Uruguay" />
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Tipo de establecimiento</label>
            <div className="grid grid-cols-3 gap-2">
              {OP_TYPES.map((op) => (
                <button key={op.value} onClick={() => setOpType(op.value)}
                  className={`rounded-xl border-2 p-3 text-center transition-colors ${
                    opType === op.value ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
                  }`}>
                  <div className="text-2xl mb-1">{op.icon}</div>
                  <div className="text-sm font-semibold text-zinc-100">{op.label}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{op.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-colors text-sm">
            {submitting ? "Creando..." : "Crear mi campo"}
          </button>
        </div>
      </div>
    </main>
  );
}
