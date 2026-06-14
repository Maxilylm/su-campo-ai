"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Scale, TrendingUp, Plus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { computeADG, type WeightRecord } from "@/lib/weight";

interface Batch { id: string; category: string; breed: string | null; count: number; sectionName: string }
interface Record extends WeightRecord { id: string; notes: string | null }

const today = () => new Date().toISOString().slice(0, 10);

export default function PesoPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [records, setRecords] = useState<Record[]>([]);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);

  // Load batches (flattened from sections).
  useEffect(() => {
    (async () => {
      try {
        const secs = await fetch("/api/sections").then((r) => (r.ok ? r.json() : []));
        const flat: Batch[] = (Array.isArray(secs) ? secs : []).flatMap(
          (s: { name: string; cattle?: { id: string; category: string; breed: string | null; count: number }[] }) =>
            (s.cattle || []).map((c) => ({ ...c, sectionName: s.name }))
        );
        setBatches(flat);
        if (flat.length) setSelected(flat[0].id);
      } catch (e) {
        console.error("Load batches error:", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const loadRecords = useCallback(async (cattleId: string) => {
    if (!cattleId) return;
    const data = await fetch(`/api/weight?cattleId=${cattleId}`).then((r) => (r.ok ? r.json() : []));
    setRecords(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadRecords(selected); }, [selected, loadRecords]);

  async function addWeight() {
    if (!selected || !weight) return;
    setSaving(true);
    try {
      const res = await fetch("/api/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cattleId: selected, weightKg: Number(weight), date }),
      });
      if (res.ok) {
        setWeight("");
        setDate(today());
        await loadRecords(selected);
        toast.success("Pesaje registrado");
      } else {
        toast.error("No se pudo registrar el pesaje");
      }
    } catch {
      toast.error("Error de conexión");
    }
    setSaving(false);
  }

  if (!loaded) return <LoadingPage />;

  const adg = computeADG(records);
  const batch = batches.find((b) => b.id === selected);
  const chartData = records.map((r) => ({ date: r.date.slice(5), peso: r.weight_kg }));

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-6">
      <PageHeader
        breadcrumbs={[{ label: "Produccion", href: "/produccion/hacienda" }, { label: "Pesajes" }]}
        title="Pesajes y ganancia"
        description="Registrá pesos y seguí la ganancia diaria (GMD) de cada lote."
      />

      {batches.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="Sin lotes de hacienda"
          description="Registrá hacienda en Producción → Hacienda para empezar a pesar."
        />
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="batch">Lote</Label>
            <select
              id="batch"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.count} {b.category}{b.breed ? ` ${b.breed}` : ""} — {b.sectionName}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Pesajes" value={records.length} accent="blue" icon={Scale} />
            <StatCard label="Último peso" value={records.length ? `${records[records.length - 1].weight_kg} kg` : "—"} accent="emerald" icon={Scale} />
            <StatCard
              label="GMD (kg/día)"
              value={adg != null ? adg.toFixed(3) : "—"}
              accent={adg != null && adg < 0 ? "red" : "amber"}
              icon={TrendingUp}
            />
          </div>

          {records.length >= 2 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-medium mb-3">Evolución de peso — {batch?.category}</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="peso" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-medium mb-3">Registrar pesaje</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="date">Fecha</Label>
                <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weight">Peso (kg)</Label>
                <Input id="weight" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="420" className="w-32" />
              </div>
              <Button onClick={addWeight} disabled={saving || !weight}>
                <Plus className="h-4 w-4 mr-1.5" />{saving ? "Guardando…" : "Registrar"}
              </Button>
            </div>
          </div>

          {records.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-2">Historial</h2>
              <div className="space-y-1.5">
                {[...records].reverse().map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2 text-sm">
                    <span className="text-muted-foreground">{new Date(r.date + "T12:00:00").toLocaleDateString("es-AR")}</span>
                    <span className="font-medium tabular-nums">{r.weight_kg} kg</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
