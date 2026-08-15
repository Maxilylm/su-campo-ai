"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";

interface Batch { id: string; category: string; breed: string | null; count: number; sectionName: string }
interface Record extends WeightRecord { id: string; cattle_id?: string; notes: string | null }

const today = () => dateInputValue();

function toCachedBatch(value: unknown): Batch | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { id?: unknown; category?: unknown; breed?: unknown; count?: unknown; sections?: { name?: unknown } | null };
  if (typeof row.id !== "string" || typeof row.category !== "string" || typeof row.count !== "number" || !Number.isFinite(row.count)) return null;
  return {
    id: row.id,
    category: row.category,
    breed: typeof row.breed === "string" ? row.breed : null,
    count: row.count,
    sectionName: row.sections && typeof row.sections.name === "string" ? row.sections.name : "Sin sección",
  };
}

function isCachedWeightRecord(value: unknown): value is Record & { cattle_id: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Record> & { cattle_id?: unknown };
  return typeof row.id === "string"
    && typeof row.cattle_id === "string"
    && typeof row.date === "string"
    && typeof row.weight_kg === "number"
    && Number.isFinite(row.weight_kg);
}

function PesoPageContent() {
  const { readOnly, userId } = useFarm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [records, setRecords] = useState<Record[]>([]);
  const [recordsTruncated, setRecordsTruncated] = useState(false);
  const [offlineWeightSavedAt, setOfflineWeightSavedAt] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [focusRegistration, setFocusRegistration] = useState(false);
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null);
  const batchesRequestId = useRef(0);
  const batchesRequestRef = useRef<AbortController | null>(null);
  const recordsRequestId = useRef(0);
  const recordsRequestRef = useRef<AbortController | null>(null);
  const weightAttempt = useRef<{ key: string; signature: string } | null>(null);
  const navigationTargetRef = useRef<{ cattleId: string; weightId: string }>({
    cattleId: typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("cattleId") || "",
    weightId: typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("weightId") || "",
  });
  const handledNavigationQueryRef = useRef<string | null>(null);

  // Load every batch directly so unassigned cattle can still be weighed.
  useEffect(() => { setDate(today()); }, []);

  const loadBatches = useCallback(async () => {
    const currentRequest = ++batchesRequestId.current;
    batchesRequestRef.current?.abort();
    setLoadError(false);
    setLoaded(false);

    if (readOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
      if (!snapshot || !isOfflineSnapshotFresh(snapshot.savedAt)) {
        setBatches([]);
        setOfflineWeightSavedAt(null);
        setLoadError(true);
        setLoaded(true);
        return null;
      }
      const flat = snapshot.cattle.map(toCachedBatch).filter((batch): batch is Batch => Boolean(batch));
      setBatches(flat);
      setOfflineWeightSavedAt(snapshot.weightRecords ? snapshot.savedAt : null);
      const { cattleId: requestedCattleId, weightId: requestedWeightId } = navigationTargetRef.current;
      let requestedBatch = requestedCattleId ? flat.find((batch) => batch.id === requestedCattleId) : null;
      if (!requestedBatch && requestedWeightId && Array.isArray(snapshot.weightRecords)) {
        const requestedWeight = snapshot.weightRecords.filter(isCachedWeightRecord).find((record) => record.id === requestedWeightId);
        requestedBatch = requestedWeight ? flat.find((batch) => batch.id === requestedWeight.cattle_id) : null;
      }
      if (currentRequest !== batchesRequestId.current) return null;
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
      setLoadError(false);
      setLoaded(true);
      return flat;
    }

    const controller = new AbortController();
    batchesRequestRef.current = controller;
    setOfflineWeightSavedAt(null);
    try {
      const cattleRes = await fetchWithTimeout("/api/cattle", { cache: "no-store", signal: controller.signal }, 8000);
      if (!cattleRes.ok) throw new Error("cattle request failed");
      const cattleRows = await cattleRes.json();
      if (currentRequest !== batchesRequestId.current || controller.signal.aborted) return null;
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
        const weightRes = await fetchWithTimeout(`/api/weight?recordId=${encodeURIComponent(requestedWeightId)}`, { cache: "no-store", signal: controller.signal }, 8000);
        if (weightRes.ok) {
          const requestedWeight = await weightRes.json() as { cattle_id?: string };
          requestedBatch = requestedWeight.cattle_id ? flat.find((batch) => batch.id === requestedWeight.cattle_id) : null;
        }
      }
      if (currentRequest !== batchesRequestId.current || controller.signal.aborted) return null;
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
      if (controller.signal.aborted) return null;
      console.error("Load batches error:", e);
      setLoadError(true);
      return null;
    } finally {
      if (currentRequest === batchesRequestId.current) {
        setLoaded(true);
        if (batchesRequestRef.current === controller) batchesRequestRef.current = null;
      }
    }
  }, [navigationQuery, readOnly, router, userId]);

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
    return () => {
      batchesRequestId.current += 1;
      batchesRequestRef.current?.abort();
    };
  }, [loadBatches, navigationQuery]);

  const loadRecords = useCallback(async (cattleId: string) => {
    const currentRequest = ++recordsRequestId.current;
    recordsRequestRef.current?.abort();
    setRecords([]);
    setRecordsTruncated(false);
    if (!cattleId) return;
    if (readOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
      const cachedRecords = snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.weightRecords)
        ? snapshot.weightRecords.filter(isCachedWeightRecord).filter((record) => record.cattle_id === cattleId).sort((left, right) => left.date.localeCompare(right.date))
        : null;
      if (cachedRecords) {
        setRecords(cachedRecords);
        setRecordsTruncated(snapshot?.weightTruncated === true);
        setOfflineWeightSavedAt(snapshot?.savedAt ?? null);
        setLoadError(false);
      } else {
        setOfflineWeightSavedAt(null);
        setLoadError(true);
      }
      return;
    }
    const controller = new AbortController();
    recordsRequestRef.current = controller;
    try {
      const res = await fetchWithTimeout(`/api/weight?cattleId=${cattleId}`, { cache: "no-store", signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("weight request failed");
      const data = await res.json();
      if (currentRequest === recordsRequestId.current && !controller.signal.aborted) {
        setRecords(Array.isArray(data) ? data : []);
        setRecordsTruncated(res.headers.get("X-CampoAI-Weight-Truncated") === "true");
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (currentRequest === recordsRequestId.current) {
        console.error("Load weight records error:", e);
        setLoadError(true);
      }
    } finally {
      if (currentRequest === recordsRequestId.current && recordsRequestRef.current === controller) recordsRequestRef.current = null;
    }
  }, [readOnly, userId]);

  const retryLoading = useCallback(async () => {
    const flat = await loadBatches();
    if (!flat) return;
    const nextSelected = selected && flat.some((batch) => batch.id === selected) ? selected : flat[0]?.id || "";
    if (nextSelected) {
      setSelected(nextSelected);
      await loadRecords(nextSelected);
    }
  }, [loadBatches, loadRecords, selected]);

  useEffect(() => {
    void loadRecords(selected);
    return () => {
      recordsRequestId.current += 1;
      recordsRequestRef.current?.abort();
    };
  }, [selected, loadRecords]);

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
  if (loadError) return <LoadErrorState title={readOnly ? "No hay una copia local de Pesajes" : "No se pudieron cargar los pesajes"} description={readOnly ? "Sincronizá Pesajes desde Mi campo cuando recuperes la conexión para consultarlos offline." : undefined} onRetry={() => void retryLoading()} />;
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

      {offlineWeightSavedAt && (
        <Alert role="status" className="mb-6">
          <AlertDescription>Mostrando pesajes sincronizados el {new Date(offlineWeightSavedAt).toLocaleString("es-UY")}. Las modificaciones se habilitarán al recuperar la conexión.</AlertDescription>
        </Alert>
      )}

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
            <StatCard label="Pesajes" value={recordsTruncated ? `${records.length}+` : records.length} accent="blue" icon={Scale} />
            <StatCard label="Último peso" value={records.length ? `${records[records.length - 1].weight_kg} kg` : "—"} accent="emerald" icon={Scale} />
            <StatCard
              label="GMD (kg/día)"
              value={adg != null ? adg.toFixed(3) : "—"}
              accent={adg != null && adg < 0 ? "red" : "amber"}
              icon={TrendingUp}
            />
          </div>

          {recordsTruncated && (
            <Alert>
              <AlertDescription>
                {readOnly ? "La copia offline contiene hasta 500 pesajes recientes de todo el campo; este lote puede tener registros anteriores no incluidos." : "Se muestran los 500 pesajes más recientes de este lote."} Para consultar el historial completo, descargá Pesajes CSV: <a href="/api/export?format=csv&table=weight_records" className="font-medium text-primary underline-offset-2 hover:underline">Descargar Pesajes CSV</a>
              </AlertDescription>
            </Alert>
          )}

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
