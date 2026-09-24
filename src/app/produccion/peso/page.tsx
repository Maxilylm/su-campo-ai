"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/StatCard";
import { Notice, noticeLinkClass } from "@/components/produccion/Notice";
import { WeightHistory } from "@/components/produccion/peso/WeightHistory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Scale, Plus, Sparkles } from "lucide-react";
import { computeADG, type WeightRecord } from "@/lib/weight";
import { parseLocalizedNumber } from "@/lib/number";
import { fetchWithTimeout } from "@/lib/fetch";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { calendarDateLabel, dateInputValue } from "@/lib/date";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { useOfflineAwareNavigation, useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { aiChatHandoffKey, buildWeightChatPrompt } from "@/lib/ai-handoff";
import { useFarm } from "@/contexts/FarmContext";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";

interface Batch { id: string; category: string; breed: string | null; count: number; sectionName: string }
interface Record extends WeightRecord { id: string; cattle_id?: string; notes: string | null }

const today = () => dateInputValue();

const WeightLineChart = dynamic(() => import("@/components/charts/WeightLineChart"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-lg bg-muted" />,
});

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
  const { readOnly, userId, offlineMode, isOnline } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const navigate = useOfflineAwareNavigation();
  const replace = useOfflineAwareReplace();
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
  const selectedRef = useRef("");
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

    if (offlineReadOnly) {
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
        selectedRef.current = requestedBatch.id;
        setSelected(requestedBatch.id);
        if (requestedWeightId) setFocusedRecordId(requestedWeightId);
        setFocusRegistration(!requestedWeightId);
      } else if (selectedRef.current && flat.some((batch) => batch.id === selectedRef.current)) {
        setSelected(selectedRef.current);
      } else if (flat.length) {
        selectedRef.current = flat[0].id;
        setSelected(flat[0].id);
      } else {
        selectedRef.current = "";
        setSelected("");
      }
      if (navigationQuery && (requestedCattleId || requestedWeightId) && requestedBatch) {
        handledNavigationQueryRef.current = "";
        replace(window.location.pathname, { scroll: false });
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
        selectedRef.current = requestedBatch.id;
        setSelected(requestedBatch.id);
        if (requestedWeightId) setFocusedRecordId(requestedWeightId);
        setFocusRegistration(!requestedWeightId);
      } else if (selectedRef.current && flat.some((batch) => batch.id === selectedRef.current)) {
        setSelected(selectedRef.current);
      } else if (flat.length) {
        selectedRef.current = flat[0].id;
        setSelected(flat[0].id);
      } else {
        selectedRef.current = "";
        setSelected("");
      }
      if (navigationQuery && (requestedCattleId || requestedWeightId) && requestedBatch) {
        handledNavigationQueryRef.current = "";
        replace(window.location.pathname, { scroll: false });
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
  }, [navigationQuery, offlineReadOnly, replace, userId]);

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
    if (offlineReadOnly) {
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
  }, [offlineReadOnly, userId]);

  const retryLoading = useCallback(async () => {
    const flat = await loadBatches();
    if (!flat) return;
    const nextSelected = selectedRef.current && flat.some((batch) => batch.id === selectedRef.current) ? selectedRef.current : flat[0]?.id || "";
    if (nextSelected) {
      selectedRef.current = nextSelected;
      setSelected(nextSelected);
      await loadRecords(nextSelected);
    }
  }, [loadBatches, loadRecords]);

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

  const refreshWeights = useCallback(async () => {
    const flat = await loadBatches();
    if (!flat) return;
    const nextSelected = selectedRef.current && flat.some((batch) => batch.id === selectedRef.current)
      ? selectedRef.current
      : flat[0]?.id || "";
    if (!nextSelected) return;
    selectedRef.current = nextSelected;
    setSelected(nextSelected);
    await loadRecords(nextSelected);
  }, [loadBatches, loadRecords]);

  useDataChangedRefresh(refreshWeights, !offlineReadOnly);
  useOfflineSnapshotRefresh(refreshWeights, userId, offlineReadOnly);

  async function addWeight() {
    if (readOnly || !selected || !weight) return;
    setSaving(true);
    try {
      const signature = JSON.stringify({ cattleId: selected, weightKg: parseLocalizedNumber(weight), date });
      if (!weightAttempt.current || weightAttempt.current.signature !== signature) {
        weightAttempt.current = { key: createIdempotencyKey(), signature };
      }
      const result = await sendJsonResult("/api/weight", "POST", {
        cattleId: selected,
        weightKg: parseLocalizedNumber(weight),
        date,
      }, { idempotencyKey: weightAttempt.current.key });
      if (result.ok) {
        weightAttempt.current = null;
        setWeight("");
        setDate(today());
        await loadRecords(selected);
        toast.success("Pesaje registrado");
      } else {
        toast.error(result.error || "No se pudo registrar el pesaje. Revisá el peso e intentá de nuevo.");
      }
    } catch {
      toast.error("No se pudo registrar el pesaje. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title={offlineReadOnly ? "No hay una copia local de Pesajes" : "No se pudieron cargar los pesajes"} description={offlineReadOnly ? "Sincronizá Pesajes desde Mi campo cuando recuperes la conexión para consultarlos sin conexión." : undefined} onRetry={offlineReadOnly ? undefined : () => void retryLoading()} />;
  // NOTE: produccion/layout already provides the <main> landmark — use a div here
  // to avoid nesting two <main> elements.

  const adg = computeADG(records);
  const batch = batches.find((b) => b.id === selected);
  const chartData = records.map((r) => ({ date: r.date.slice(5), peso: r.weight_kg }));
  const lastRecord = records.length ? records[records.length - 1] : null;
  const lastWeight = lastRecord ? lastRecord.weight_kg : null;

  function askCampoAI() {
    if (!userId || offlineReadOnly || !batch || records.length === 0) return;
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildWeightChatPrompt({
        title: `${batch.count} ${batch.category}${batch.breed ? ` ${batch.breed}` : ""} — ${batch.sectionName}`,
        averageDailyGain: adg,
        partial: recordsTruncated,
        facts: records
          .slice(-20)
          .map((record) => `${record.date}: ${record.weight_kg} kg${record.notes ? ` — ${record.notes}` : ""}`),
      }));
    } catch {
      // Chat remains available even when session storage is unavailable.
    }
    navigate("/chat?from=weight");
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pesajes y ganancia"
        description="Registrá pesos y seguí la ganancia diaria (GMD) de cada lote."
        actions={<Button variant="outline" onClick={askCampoAI} disabled={offlineReadOnly || records.length === 0} title={offlineReadOnly ? "Necesitás conexión para consultar a CampoAI" : records.length === 0 ? "Registrá al menos un pesaje para analizarlo" : undefined}><Sparkles className="h-4 w-4" aria-hidden="true" />Analizar con CampoAI</Button>}
      />

      {offlineWeightSavedAt && (
        <Notice tone="offline">
          Mostrando pesajes sincronizados el {new Date(offlineWeightSavedAt).toLocaleString("es-UY")}. Vas a poder registrar pesajes cuando recuperes la conexión.
        </Notice>
      )}

      {batches.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="Todavía no hay lotes para pesar"
          description="Registrá un lote en Hacienda y volvé acá para cargar sus pesajes."
          actionLabel="Ir a Hacienda"
          onAction={() => navigate("/produccion/hacienda")}
        />
      ) : (
        <>
          <div className="max-w-md space-y-2">
            <Label htmlFor="batch">Lote</Label>
            <select
              id="batch"
              value={selected}
              onChange={(e) => { selectedRef.current = e.target.value; setSelected(e.target.value); }}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.count} {b.category}{b.breed ? ` ${b.breed}` : ""} — {b.sectionName}
                </option>
              ))}
            </select>
          </div>

          <StatStrip
            items={[
              { label: "Pesajes", value: recordsTruncated ? `${records.length}+` : records.length },
              { label: "Último peso", value: lastWeight != null ? lastWeight : "—", unit: lastWeight != null ? "kg" : undefined, hint: lastRecord ? calendarDateLabel(lastRecord.date) : undefined },
              { label: "Ganancia diaria (GMD)", value: adg != null ? adg.toFixed(3) : "—", unit: adg != null ? "kg/día" : undefined, tone: adg != null && adg < 0 ? "bad" : undefined, hint: adg != null && adg < 0 ? "El lote está perdiendo peso" : undefined },
            ]}
          />

          {recordsTruncated && (
            <Notice tone="warn">
              {offlineReadOnly ? "La copia sin conexión tiene hasta 500 pesajes recientes de todo el campo; este lote puede tener registros anteriores que no se incluyen." : "Se muestran los 500 pesajes más recientes de este lote."} Para ver el historial completo, <AuthenticatedDownloadLink href="/api/export?format=csv&table=weight_records" filename="campoai-pesajes.csv" className={noticeLinkClass}>descargá los pesajes en CSV</AuthenticatedDownloadLink>.
            </Notice>
          )}

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-8">
              {records.length >= 2 && (
                <section aria-labelledby="weight-chart-title" className="rounded-lg border border-border bg-card p-4">
                  <h2 id="weight-chart-title" className="mb-3 text-base font-semibold">Evolución del peso <span className="font-normal capitalize text-muted-foreground">· {batch?.category}</span></h2>
                  <div className="h-64">
                    <WeightLineChart data={chartData} />
                  </div>
                </section>
              )}

              <WeightHistory records={records} focusedRecordId={focusedRecordId} />
            </div>

            <section
              id="weight-registration"
              aria-labelledby="weight-registration-title"
              className={`h-fit rounded-lg border bg-card p-4 transition-shadow ${focusRegistration ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
            >
              <h2 id="weight-registration-title" className="mb-3 text-base font-semibold">Registrar pesaje</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="date">Fecha</Label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weight">Peso (kg)</Label>
                  <Input id="weight" type="text" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="420" />
                </div>
              </div>
              <Button onClick={addWeight} disabled={readOnly || saving || !weight} className="mt-4 w-full">
                <Plus className="h-4 w-4" aria-hidden="true" />{saving ? "Guardando…" : "Registrar pesaje"}
              </Button>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default function PesoPage() {
  return <Suspense fallback={<LoadingPage />}><PesoPageContent /></Suspense>;
}
