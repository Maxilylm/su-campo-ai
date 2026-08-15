"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Scale, TrendingUp, Plus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { computeADG, type WeightRecord } from "@/lib/weight";
import { fetchWithTimeout } from "@/lib/fetch";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { dateInputValue } from "@/lib/date";
import { useFarm } from "@/contexts/FarmContext";

interface Batch { id: string; category: string; breed: string | null; count: number; sectionName: string }
interface Record extends WeightRecord { id: string; notes: string | null }

const today = () => dateInputValue();

function PesoPageContent() {
  const { readOnly } = useFarm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [records, setRecords] = useState<Record[]>([]);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [focusRegistration, setFocusRegistration] = useState(false);
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null);
  const recordsRequestId = useRef(0);
  const weightAttempt = useRef<{ key: string; signature: string } | null>(null);
  const navigationTargetRef = useRef<{ cattleId: string; weightId: string }>({
    cattleId: typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("cattleId") || "",
    weightId: typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("weightId") || "",
  });
  const handledNavigationQueryRef = useRef<string | null>(null);

  // Load every batch directly so unassigned cattle can still be weighed.
  useEffect(() => { setDate(today()); }, []);

  const loadBatches = useCallback(async () => {
    setLoadError(false);
    setLoaded(false);
    try {
      const cattleRes = await fetchWithTimeout("/api/cattle", {}, 8000);
      if (!cattleRes.ok) throw new Error("cattle request failed");
      const cattleRows = await cattleRes.json();
      const flat: Batch[] = (Array.isArray(cattleRows) ? cattleRows : []).map(
        (c: { id: string; category: string; breed: string | null; count: number; sections?: { name?: string } | null }) => ({
          id: c.id,
          category: c.category,
          breed: c.breed,
          count: c.count,
          sectionName: c.sections?.name || "Sin sección",
        })
      );
      setBatches(flat);
      const { cattleId: requestedCattleId, weightId: requestedWeightId } = navigationTargetRef.current;
      let requestedBatch = requestedCattleId ? flat.find((batch) => batch.id === requestedCattleId) : null;
      if (!requestedBatch && requestedWeightId) {
        const weightRes = await fetchWithTimeout(`/api/weight?recordId=${encodeURIComponent(requestedWeightId)}`, {}, 8000);
        if (weightRes.ok) {
          const requestedWeight = await weightRes.json() as { cattle_id?: string };
          requestedBatch = requestedWeight.cattle_id ? flat.find((batch) => batch.id === requestedWeight.cattle_id) : null;
        }
      }
      if (requestedBatch) {
        setSelected(requestedBatch.id);
        if (requestedWeightId) setFocusedRecordId(requestedWeightId);
        setFocusRegistration(!requestedWeightId);
      } else if (flat.length) {
        setSelected(flat[0].id);
      }
      if (navigationQuery && (requestedCattleId || requestedWeightId)) {
        handledNavigationQueryRef.current = "";
        router.replace(window.location.pathname, { scroll: false });
      }
      return flat;
    } catch (e) {
      console.error("Load batches error:", e);
      setLoadError(true);
      return null;
    } finally {
      setLoaded(true);
    }
  }, [navigationQuery, router]);

  useEffect(() => {
    if (handledNavigationQueryRef.current === navigationQuery) return;
    if (navigationQuery) {
      const params = new URLSearchParams(navigationQuery);
      navigationTargetRef.current = { cattleId: params.get("cattleId") || "", weightId: params.get("weightId") || "" };
      handledNavigationQueryRef.current = navigationQuery;
    } else {
      handledNavigationQueryRef.current = "";
    }
    void loadBatches();
  }, [loadBatches, navigationQuery]);

  const loadRecords = useCallback(async (cattleId: string) => {
    const currentRequest = ++recordsRequestId.current;
    setRecords([]);
    if (!cattleId) return;
    try {
      const res = await fetchWithTimeout(`/api/weight?cattleId=${cattleId}`, {}, 8000);
      if (!res.ok) throw new Error("weight request failed");
      const data = await res.json();
      if (currentRequest === recordsRequestId.current) setRecords(Array.isArray(data) ? data : []);
    } catch (e) {
      if (currentRequest === recordsRequestId.current) {
        console.error("Load weight records error:", e);
        setLoadError(true);
      }
    }
  }, []);

  const retryLoading = useCallback(async () => {
    const flat = await loadBatches();
    if (!flat) return;
    const nextSelected = selected && flat.some((batch) => batch.id === selected) ? selected : flat[0]?.id || "";
    if (nextSelected) {
      setSelected(nextSelected);
      await loadRecords(nextSelected);
    }
  }, [loadBatches, loadRecords, selected]);

  useEffect(() => { loadRecords(selected); }, [selected, loadRecords]);

  useEffect(() => {
    if (!focusRegistration) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("weight-registration")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setFocusRegistration(false), 4000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusRegistration]);

  useEffect(() => {
    if (!focusedRecordId || !records.some((record) => record.id === focusedRecordId)) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`weight-record-${focusedRecordId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setFocusedRecordId(null), 4000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusedRecordId, records]);

  async function addWeight() {
    if (readOnly || !selected || !weight) return;
    setSaving(true);
    const signature = JSON.stringify({ cattleId: selected, weightKg: Number(weight), date });
    if (!weightAttempt.current || weightAttempt.current.signature !== signature) {
      weightAttempt.current = { key: createIdempotencyKey(), signature };
    }
    const result = await sendJsonResult("/api/weight", "POST", {
      cattleId: selected,
      weightKg: Number(weight),
      date,
    }, { idempotencyKey: weightAttempt.current.key });
    if (result.ok) {
      weightAttempt.current = null;
      setWeight("");
      setDate(today());
      await loadRecords(selected);
      toast.success("Pesaje registrado");
    } else {
      toast.error(result.error || "No se pudo registrar el pesaje");
    }
    setSaving(false);
  }

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title="No se pudieron cargar los pesajes" onRetry={() => void retryLoading()} />;
  // NOTE: produccion/layout already provides the <main> landmark — use a div here
  // to avoid nesting two <main> elements.

  const adg = computeADG(records);
  const batch = batches.find((b) => b.id === selected);
  const chartData = records.map((r) => ({ date: r.date.slice(5), peso: r.weight_kg }));

  return (
    <>
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

          <div id="weight-registration" className={`rounded-xl border bg-card p-4 ${focusRegistration ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
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
              <Button onClick={addWeight} disabled={readOnly || saving || !weight}>
                <Plus className="h-4 w-4 mr-1.5" />{saving ? "Guardando…" : "Registrar"}
              </Button>
            </div>
          </div>

          {records.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-2">Historial</h2>
              <div className="space-y-1.5">
                {[...records].reverse().map((r) => (
                  <div id={`weight-record-${r.id}`} key={r.id} className={`flex items-center justify-between rounded-lg border bg-card px-4 py-2 text-sm transition-colors ${focusedRecordId === r.id ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
                    <span className="text-muted-foreground">{new Date(r.date + "T12:00:00").toLocaleDateString("es-AR")}</span>
                    <span className="font-medium tabular-nums">{r.weight_kg} kg</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function PesoPage() {
  return <Suspense fallback={<LoadingPage />}><PesoPageContent /></Suspense>;
}
