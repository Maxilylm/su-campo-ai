"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { mergeFinancialContext } from "@/lib/finance-navigation";
import { financialPeriodStart } from "@/lib/finance-period";
import { filterFinancialTransactions } from "@/lib/reports";
import { dateInputValue } from "@/lib/date";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { FinanceImportDialog } from "@/components/FinanceImportDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, BarChart3, DollarSign, Plus,
  MoreHorizontal, Trash2, Pencil, Printer,
} from "lucide-react";

// ─── Types ──────────────────────────────────

interface Transaction {
  id: string;
  type: "ingreso" | "egreso";
  category: string;
  description: string | null;
  amount: number;
  currency: string;
  date: string;
  section_id: string | null;
  crop_id: string | null;
  cattle_id: string | null;
  inventory_movement_id: string | null;
  notes: string | null;
  sections: { name: string } | null;
  crops: { crop_type: string } | null;
  cattle: { category: string; breed: string | null } | null;
  contextOnly?: boolean;
}

interface CattleBatch {
  id: string;
  category: string;
  breed: string | null;
  count: number;
  section_id?: string | null;
}

interface Crop {
  id: string;
  crop_type: string;
  planted_hectares: number | null;
  section_id?: string | null;
}

function isCachedTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") return false;
  const transaction = value as Partial<Transaction>;
  return typeof transaction.id === "string"
    && (transaction.type === "ingreso" || transaction.type === "egreso")
    && typeof transaction.category === "string"
    && typeof transaction.amount === "number"
    && Number.isFinite(transaction.amount)
    && typeof transaction.currency === "string"
    && typeof transaction.date === "string";
}

// ─── Constants ──────────────────────────────

const PERIODS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "year", label: "Ano" },
];

const CATEGORIES = [
  { value: "venta_ganado", label: "Venta ganado" },
  { value: "venta_cosecha", label: "Venta cosecha" },
  { value: "compra_insumo", label: "Compra insumo" },
  { value: "servicio", label: "Servicio" },
  { value: "mano_obra", label: "Mano de obra" },
  { value: "transporte", label: "Transporte" },
  { value: "veterinario", label: "Veterinario" },
  { value: "maquinaria", label: "Maquinaria" },
  { value: "otro", label: "Otro" },
];

const CATEGORY_LABELS: Record<string, string> = {
  venta_ganado: "Venta ganado",
  venta_cosecha: "Venta cosecha",
  compra_insumo: "Compra insumo",
  servicio: "Servicio",
  mano_obra: "Mano de obra",
  transporte: "Transporte",
  veterinario: "Veterinario",
  maquinaria: "Maquinaria",
  otro: "Otro",
};

const CURRENCIES = ["USD", "UYU", "ARS"];

interface FinanceFormSnapshot {
  editingId: string | null;
  type: "ingreso" | "egreso";
  category: string;
  description: string;
  amount: string;
  currency: string;
  date: string;
  sectionId: string;
  cropId: string;
  cattleId: string;
  notes: string;
}

function financeFormSignature(form: FinanceFormSnapshot): string {
  return JSON.stringify(form);
}

// ─── Page Component ─────────────────────────

function FinanzasPageContent() {
  const { sections, userId, readOnly, offlineMode, isOnline } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsTruncated, setTransactionsTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [offlineFinancialSavedAt, setOfflineFinancialSavedAt] = useState<string | null>(null);
  const [cattle, setCattle] = useState<CattleBatch[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [relatedDataError, setRelatedDataError] = useState(false);
  const [period, setPeriod] = useState("30d");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusedTransactionId, setFocusedTransactionId] = useState<string | null>(null);
  const requestedTransactionIdRef = useRef<string | null>(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("transactionId"));
  const handledNavigationQueryRef = useRef<string | null>(null);
  const transactionsRequestId = useRef(0);
  const transactionsRequestRef = useRef<AbortController | null>(null);
  const cattleRequestRef = useRef<AbortController | null>(null);
  const cropsRequestRef = useRef<AbortController | null>(null);
  const transactionAttempt = useRef<{ key: string; signature: string } | null>(null);
  const formBaselineRef = useRef<string | null>(null);

  useEffect(() => {
    if (navigationQuery) requestedTransactionIdRef.current = new URLSearchParams(navigationQuery).get("transactionId");
  }, [navigationQuery]);

  // Form state
  const [fType, setFType] = useState<"ingreso" | "egreso">("egreso");
  const [fCategory, setFCategory] = useState("otro");
  const [fDescription, setFDescription] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fCurrency, setFCurrency] = useState("USD");
  const [fDate, setFDate] = useState("");
  const [fSectionId, setFSectionId] = useState("");
  const [fCropId, setFCropId] = useState("");
  const [fCattleId, setFCattleId] = useState("");
  const [fNotes, setFNotes] = useState("");

  const loadTransactions = useCallback(async () => {
    const requestId = ++transactionsRequestId.current;
    transactionsRequestRef.current?.abort();
    const controller = new AbortController();
    transactionsRequestRef.current = controller;
    setLoadError(false);
    setTransactionsTruncated(false);
    setOfflineFinancialSavedAt(null);

    if (offlineReadOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
      const allCachedTransactions = snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.financialTransactions)
        ? snapshot.financialTransactions.filter(isCachedTransaction)
        : null;
      const cachedTransactions = allCachedTransactions
        ? (() => {
          const recentTransactions = allCachedTransactions.filter((transaction) => transaction.date >= financialPeriodStart(period));
          const transactionId = requestedTransactionIdRef.current;
          const exactTransactions = transactionId
            ? allCachedTransactions.filter((transaction) => transaction.id === transactionId)
            : [];
          return mergeFinancialContext(recentTransactions, exactTransactions, transactionId);
        })()
        : null;
      if (requestId === transactionsRequestId.current) {
        if (cachedTransactions) {
          setTransactions(cachedTransactions);
          setTransactionsTruncated(snapshot?.financialTruncated === true);
          setOfflineFinancialSavedAt(snapshot?.savedAt ?? null);
        } else {
          setTransactions([]);
          setLoadError(true);
        }
        setLoaded(true);
      }
      if (transactionsRequestRef.current === controller) transactionsRequestRef.current = null;
      return;
    }

    try {
      const transactionId = requestedTransactionIdRef.current;
      const recentResponse = await fetchWithTimeout(`/api/financial?period=${period}`, { signal: controller.signal }, 8000);
      if (!recentResponse.ok) throw new Error("financial request failed");
      const recentTransactionsTruncated = recentResponse.headers.get("X-CampoAI-Financial-Truncated") === "true";
      const recentTransactions = await recentResponse.json() as Transaction[];

      if (!transactionId) {
        if (requestId === transactionsRequestId.current) {
          setTransactions(recentTransactions);
          setTransactionsTruncated(recentTransactionsTruncated);
        }
        return;
      }

      const exactResponse = await fetchWithTimeout(`/api/financial?transactionId=${encodeURIComponent(transactionId)}`, { signal: controller.signal }, 8000);
      const exactTransactions = exactResponse.ok ? await exactResponse.json() as Transaction[] : [];
      if (requestId === transactionsRequestId.current) {
        setTransactions(mergeFinancialContext(recentTransactions, exactTransactions, transactionId));
        setTransactionsTruncated(recentTransactionsTruncated);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (requestId === transactionsRequestId.current) {
        console.error("Load financial error:", e);
        setLoadError(true);
      }
    } finally {
      if (requestId === transactionsRequestId.current) setLoaded(true);
      if (transactionsRequestRef.current === controller) transactionsRequestRef.current = null;
    }
  }, [offlineReadOnly, period, userId]);

  const loadCattle = useCallback(async () => {
    if (offlineReadOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
      const cachedCattle = snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.cattle)
        ? snapshot.cattle.filter((batch): batch is CattleBatch => Boolean(batch && typeof batch === "object" && typeof (batch as CattleBatch).id === "string"))
        : [];
      setCattle(cachedCattle);
      setRelatedDataError(false);
      return;
    }

    cattleRequestRef.current?.abort();
    const controller = new AbortController();
    cattleRequestRef.current = controller;
    try {
      const res = await fetchWithTimeout("/api/cattle", { cache: "no-store", signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("cattle request failed");
      const nextCattle = await res.json() as CattleBatch[];
      if (!controller.signal.aborted && cattleRequestRef.current === controller) {
        setCattle(nextCattle);
        setRelatedDataError(false);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error("Load cattle error:", e);
      setRelatedDataError(true);
    } finally {
      if (cattleRequestRef.current === controller) cattleRequestRef.current = null;
    }
  }, [offlineReadOnly, userId]);

  const loadCrops = useCallback(async () => {
    if (offlineReadOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
      const cachedCrops = snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.crops)
        ? snapshot.crops.filter((crop): crop is Crop => Boolean(crop && typeof crop === "object" && typeof (crop as Crop).id === "string"))
        : [];
      setCrops(cachedCrops);
      setRelatedDataError(false);
      return;
    }

    cropsRequestRef.current?.abort();
    const controller = new AbortController();
    cropsRequestRef.current = controller;
    try {
      const res = await fetchWithTimeout("/api/crops", { cache: "no-store", signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("crops request failed");
      const nextCrops = await res.json() as Crop[];
      if (!controller.signal.aborted && cropsRequestRef.current === controller) {
        setCrops(nextCrops);
        setRelatedDataError(false);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error("Load crops error:", e);
      setRelatedDataError(true);
    } finally {
      if (cropsRequestRef.current === controller) cropsRequestRef.current = null;
    }
  }, [offlineReadOnly, userId]);

  const refreshFinanceData = useCallback(async () => {
    await Promise.all([loadTransactions(), loadCattle(), loadCrops()]);
  }, [loadCattle, loadCrops, loadTransactions]);

  useEffect(() => {
    void loadTransactions();
    return () => {
      transactionsRequestId.current += 1;
      transactionsRequestRef.current?.abort();
    };
  }, [loadTransactions, navigationQuery]);
  useEffect(() => {
    loadCattle();
    loadCrops();
    return () => {
      cattleRequestRef.current?.abort();
      cropsRequestRef.current?.abort();
    };
  }, [loadCattle, loadCrops]);
  useDataChangedRefresh(refreshFinanceData, !offlineReadOnly);
  useOfflineSnapshotRefresh(refreshFinanceData, userId, offlineReadOnly);

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    if (params.get("new") === "1") {
      const requestedType = params.get("type");
      const requestedCategory = params.get("category");
      const nextForm: FinanceFormSnapshot = {
        editingId: null,
        type: requestedType === "ingreso" ? "ingreso" : "egreso",
        category: CATEGORIES.some((category) => category.value === requestedCategory) ? requestedCategory! : "otro",
        description: params.get("description") || "",
        amount: "",
        currency: CURRENCIES.includes(params.get("currency") || "") ? params.get("currency")! : "USD",
        date: params.get("date") || dateInputValue(),
        sectionId: params.get("sectionId") || "",
        cropId: params.get("cropId") || "",
        cattleId: params.get("cattleId") || "",
        notes: "",
      };
      setEditingId(null);
      setFType(nextForm.type);
      setFCategory(nextForm.category);
      setFDescription(nextForm.description);
      setFAmount(nextForm.amount);
      setFCurrency(nextForm.currency);
      setFDate(nextForm.date);
      setFSectionId(nextForm.sectionId);
      setFCropId(nextForm.cropId);
      setFCattleId(nextForm.cattleId);
      setFNotes(nextForm.notes);
      formBaselineRef.current = financeFormSignature(nextForm);
      setSheetOpen(true);
    }
    const transactionId = params.get("transactionId");
    if (transactionId && !transactions.some((transaction) => transaction.id === transactionId)) return;
    if (transactionId && transactions.some((transaction) => transaction.id === transactionId)) {
      setFocusedTransactionId(transactionId);
      window.requestAnimationFrame(() => {
        document.getElementById(`financial-transaction-${transactionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) replace(window.location.pathname, { scroll: false });
  }, [loaded, navigationQuery, replace, transactions]);

  useEffect(() => {
    if (!focusedTransactionId) return;
    const timer = window.setTimeout(() => setFocusedTransactionId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focusedTransactionId]);

  function resetForm() {
    transactionAttempt.current = null;
    formBaselineRef.current = null;
    setFType("egreso"); setFCategory("otro"); setFDescription("");
    setFAmount(""); setFCurrency("USD"); setFDate(dateInputValue());
    setFSectionId(""); setFCropId(""); setFCattleId(""); setFNotes("");
    setEditingId(null);
  }

  function openNewTransaction() {
    const nextForm: FinanceFormSnapshot = {
      editingId: null,
      type: "egreso",
      category: "otro",
      description: "",
      amount: "",
      currency: "USD",
      date: dateInputValue(),
      sectionId: "",
      cropId: "",
      cattleId: "",
      notes: "",
    };
    resetForm();
    formBaselineRef.current = financeFormSignature(nextForm);
    setSheetOpen(true);
  }

  function openEditTransaction(transaction: Transaction) {
    const nextForm: FinanceFormSnapshot = {
      editingId: transaction.id,
      type: transaction.type,
      category: transaction.category,
      description: transaction.description || "",
      amount: String(transaction.amount),
      currency: transaction.currency || "USD",
      date: transaction.date || "",
      sectionId: transaction.section_id || "",
      cropId: transaction.crop_id || "",
      cattleId: transaction.cattle_id || "",
      notes: transaction.notes || "",
    };
    setEditingId(nextForm.editingId);
    setFType(nextForm.type);
    setFCategory(nextForm.category);
    setFDescription(nextForm.description);
    setFAmount(nextForm.amount);
    setFCurrency(nextForm.currency);
    setFDate(nextForm.date);
    setFSectionId(nextForm.sectionId);
    setFCropId(nextForm.cropId);
    setFCattleId(nextForm.cattleId);
    setFNotes(nextForm.notes);
    formBaselineRef.current = financeFormSignature(nextForm);
    setSheetOpen(true);
  }

  function currentFormSignature(): string {
    return financeFormSignature({
      editingId,
      type: fType,
      category: fCategory,
      description: fDescription,
      amount: fAmount,
      currency: fCurrency,
      date: fDate,
      sectionId: fSectionId,
      cropId: fCropId,
      cattleId: fCattleId,
      notes: fNotes,
    });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));

  function discardFormChanges() {
    setDiscardDialogOpen(false);
    setSheetOpen(false);
    resetForm();
  }

  function requestSheetClose() {
    if (saving) return;
    if (hasUnsavedChanges(formBaselineRef.current, currentFormSignature())) {
      setDiscardDialogOpen(true);
      return;
    }
    setSheetOpen(false);
    resetForm();
  }

  function changeFinanceSection(value: string) {
    const nextSection = value === "none" ? "" : value;
    setFSectionId(nextSection);
    const crop = crops.find((option) => option.id === fCropId);
    const cattleBatch = cattle.find((option) => option.id === fCattleId);
    if (nextSection && crop?.section_id && crop.section_id !== nextSection) setFCropId("");
    if (nextSection && cattleBatch?.section_id && cattleBatch.section_id !== nextSection) setFCattleId("");
  }

  function changeFinanceCrop(value: string) {
    const nextCrop = value === "none" ? "" : value;
    setFCropId(nextCrop);
    const crop = crops.find((option) => option.id === nextCrop);
    if (crop?.section_id) setFSectionId(crop.section_id);
  }

  function changeFinanceCattle(value: string) {
    const nextCattle = value === "none" ? "" : value;
    setFCattleId(nextCattle);
    const cattleBatch = cattle.find((option) => option.id === nextCattle);
    if (cattleBatch?.section_id) setFSectionId(cattleBatch.section_id);
  }

  async function saveTransaction() {
    if (readOnly || !fAmount || Number(fAmount) <= 0) return;
    setSaving(true);
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        type: fType,
        category: fCategory,
        description: fDescription || null,
        amount: Number(fAmount),
        currency: fCurrency,
        date: fDate || null,
        sectionId: fSectionId || null,
        cropId: fCropId || null,
        cattleId: fCattleId || null,
        notes: fNotes || null,
      };
      const creating = !editingId;
      const signature = JSON.stringify(payload);
      if (creating && (!transactionAttempt.current || transactionAttempt.current.signature !== signature)) {
        transactionAttempt.current = { key: createIdempotencyKey(), signature };
      }
      const result = await sendJsonResult("/api/financial", creating ? "POST" : "PUT", payload, creating && transactionAttempt.current
        ? { idempotencyKey: transactionAttempt.current.key }
        : undefined);
      if (result.ok) {
        if (creating) transactionAttempt.current = null;
        toast.success(editingId ? "Transaccion actualizada" : "Transaccion guardada");
        setSheetOpen(false);
        resetForm();
        await loadTransactions();
      } else {
        toast.error(result.error || (editingId ? "No se pudo actualizar la transaccion" : "No se pudo guardar la transaccion"));
      }
    } catch {
      toast.error(editingId ? "No se pudo actualizar la transaccion" : "No se pudo guardar la transaccion");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTransaction(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/financial", "DELETE", { id });
    if (result.ok) { toast.success("Transaccion eliminada"); await loadTransactions(); }
    else toast.error(result.error || "No se pudo eliminar la transaccion");
  }

  // ─── Derived data ─────────────────────────

  const availableCurrencies = useMemo(
    () => Array.from(new Set(transactions.map((transaction) => transaction.currency || "USD"))).sort(),
    [transactions],
  );
  const visibleTransactions = filterFinancialTransactions(transactions, sectionFilter, currencyFilter);
  const periodTransactions = transactions.filter((transaction) => !transaction.contextOnly);
  const summaryTransactions = filterFinancialTransactions(periodTransactions, sectionFilter, currencyFilter);
  const hasActiveFilters = sectionFilter !== "all" || currencyFilter !== "all";

  useEffect(() => {
    if (currencyFilter !== "all" && !availableCurrencies.includes(currencyFilter)) setCurrencyFilter("all");
  }, [availableCurrencies, currencyFilter]);

  const income = summaryTransactions
    .filter((t) => t.type === "ingreso")
    .reduce((s, t) => s + t.amount, 0);
  const expenses = summaryTransactions
    .filter((t) => t.type === "egreso")
    .reduce((s, t) => s + t.amount, 0);
  const result = income - expenses;
  const totalsByCurrency = summaryTransactions.reduce<Record<string, { income: number; expenses: number }>>((totals, tx) => {
    const slot = totals[tx.currency] || { income: 0, expenses: 0 };
    if (tx.type === "ingreso") slot.income += tx.amount;
    else slot.expenses += tx.amount;
    totals[tx.currency] = slot;
    return totals;
  }, {});

 // Cost-per-unit: cattle
  const cattleCosts = cattle.flatMap((batch) => {
    const byCurrency = new Map<string, number>();
    summaryTransactions
      .filter((t) => t.type === "egreso" && t.cattle_id === batch.id)
      .forEach((t) => byCurrency.set(t.currency, (byCurrency.get(t.currency) || 0) + t.amount));
    return Array.from(byCurrency, ([currency, totalCost]) => ({
      label: `${batch.category}${batch.breed ? ` (${batch.breed})` : ""}`,
      totalCost,
      perUnit: batch.count > 0 ? totalCost / batch.count : 0,
      unit: "cabeza",
      count: batch.count,
      currency,
    }));
  });

 // Cost-per-unit: crops
  const cropCosts = crops.flatMap((crop) => {
    const byCurrency = new Map<string, number>();
      summaryTransactions
      .filter((t) => t.type === "egreso" && t.crop_id === crop.id)
      .forEach((t) => byCurrency.set(t.currency, (byCurrency.get(t.currency) || 0) + t.amount));
    return Array.from(byCurrency, ([currency, totalCost]) => ({
      label: crop.crop_type,
      totalCost,
      perUnit: crop.planted_hectares && crop.planted_hectares > 0
        ? totalCost / crop.planted_hectares
        : 0,
      unit: "ha",
      count: crop.planted_hectares || 0,
      currency,
    }));
  });

  const allCostUnits = [...cattleCosts, ...cropCosts];

  if (!loaded) return <LoadingPage />;
  if (loadError) {
    return (
      <LoadErrorState
        title={offlineReadOnly ? "No hay una copia local de Finanzas" : "No se pudo cargar Finanzas"}
        description={offlineReadOnly ? "Sincronizá Finanzas desde Mi campo cuando recuperes la conexión para consultar movimientos offline." : undefined}
        onRetry={offlineReadOnly ? undefined : loadTransactions}
      />
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Gestion", href: "/gestion/inventario" }, { label: "Finanzas" }]}
        title="Finanzas"
        description="Ingresos, egresos y analisis de costos"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link href="/reportes"><Printer className="h-4 w-4 mr-1.5" />Reportes</Link></Button>
            <FinanceImportDialog sections={sections} crops={crops} cattle={cattle} readOnly={readOnly} onImported={loadTransactions} />
            <Button onClick={openNewTransaction} disabled={readOnly}><Plus className="h-4 w-4 mr-1.5" />Nueva Transaccion</Button>
          </div>
        }
      />

      {relatedDataError && <Alert><AlertDescription>No se pudieron cargar algunas referencias de hacienda o cultivos. Podés registrar la transacción sin asignarlas.</AlertDescription></Alert>}

      {offlineFinancialSavedAt && (
        <Alert role="status">
          <AlertDescription>
            Mostrando Finanzas sincronizadas el {new Date(offlineFinancialSavedAt).toLocaleString("es-UY")}. Las modificaciones se habilitarán al recuperar la conexión.
          </AlertDescription>
        </Alert>
      )}

      {transactionsTruncated && (
        <Alert>
          <AlertDescription>
            Se muestran solo los 500 movimientos más recientes del período. Para consultar el conjunto completo, descargá Finanzas CSV: <AuthenticatedDownloadLink href="/api/export?format=csv&table=financial_transactions" filename="campoai-finanzas.csv" className="font-medium text-primary underline-offset-2 hover:underline">Descargar Finanzas CSV</AuthenticatedDownloadLink>
          </AlertDescription>
        </Alert>
      )}

      {transactions.some((transaction) => transaction.contextOnly) && (
        <Alert>
          <AlertDescription>Se muestra también el movimiento abierto desde el Registro, aunque queda fuera del período seleccionado.</AlertDescription>
        </Alert>
      )}

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            variant={period === p.value ? "secondary" : "outline"}
            size="sm"
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <span className="text-xs font-medium text-muted-foreground">Filtrar por</span>
        <Select value={sectionFilter} onValueChange={setSectionFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Sección" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las secciones</SelectItem>
            {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
            <SelectItem value="unassigned">Sin asignar</SelectItem>
          </SelectContent>
        </Select>
        <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Moneda" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las monedas</SelectItem>
            {availableCurrencies.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasActiveFilters && <Button variant="ghost" size="sm" onClick={() => { setSectionFilter("all"); setCurrencyFilter("all"); }}>Limpiar filtros</Button>}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Object.keys(totalsByCurrency).length <= 1 ? (
          <>
            <StatCard label="Ingresos" value={`${Object.keys(totalsByCurrency)[0] || "USD"} ${income.toLocaleString()}`} accent="emerald" icon={TrendingUp} />
            <StatCard label="Egresos" value={`${Object.keys(totalsByCurrency)[0] || "USD"} ${expenses.toLocaleString()}`} accent="red" icon={TrendingDown} />
            <StatCard label="Resultado" value={`${result >= 0 ? "+" : "-"}${Object.keys(totalsByCurrency)[0] || "USD"} ${Math.abs(result).toLocaleString()}`} accent="amber" icon={BarChart3} />
          </>
        ) : Object.entries(totalsByCurrency).map(([currency, totals]) => (
          <div key={currency} className="grid grid-cols-3 gap-3 sm:col-span-3">
            <StatCard label={`Ingresos (${currency})`} value={totals.income.toLocaleString()} accent="emerald" icon={TrendingUp} />
            <StatCard label={`Egresos (${currency})`} value={totals.expenses.toLocaleString()} accent="red" icon={TrendingDown} />
            <StatCard label={`Resultado (${currency})`} value={`${totals.income - totals.expenses >= 0 ? "+" : "-"}${Math.abs(totals.income - totals.expenses).toLocaleString()}`} accent="amber" icon={BarChart3} />
          </div>
        ))}
      </div>

      {/* Cost-per-unit breakdown */}
      {allCostUnits.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-4">Costo por unidad</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allCostUnits.map((item, i) => (
              <div key={i} className="rounded-xl bg-card border border-border p-5">
                <div className="text-sm font-medium mb-1">{item.label}</div>
                <div className="text-xs text-muted-foreground mb-3">
                  {item.count} {item.unit}{item.count !== 1 ? "s" : ""}
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Total</span>
                 <span className="text-sm font-mono text-red-600 dark:text-red-400">
                    {item.currency} {item.totalCost.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-xs text-muted-foreground">Por {item.unit}</span>
                 <span className="text-sm font-mono text-amber-600 dark:text-amber-400">
                    {item.currency} {item.perUnit.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transactions list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Transacciones</h2>
          <span className="text-xs text-muted-foreground">{visibleTransactions.length}{hasActiveFilters ? ` de ${transactions.length}` : ""} registros</span>
        </div>

        {visibleTransactions.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title={transactions.length === 0 ? "Sin transacciones" : "Sin movimientos para este filtro"}
            description={transactions.length === 0 ? "Registra tu primer movimiento financiero." : "Probá con otra sección o moneda para ver los movimientos disponibles."}
            actionLabel={transactions.length === 0 ? "Nueva transaccion" : "Limpiar filtros"}
            onAction={transactions.length === 0 ? openNewTransaction : () => { setSectionFilter("all"); setCurrencyFilter("all"); }}
          />
        ) : (
          <div className="space-y-2">
            {visibleTransactions.map((tx) => (
              <div
                id={`financial-transaction-${tx.id}`}
                key={tx.id}
                className={`flex items-center justify-between rounded-xl bg-card border px-4 py-3 hover:bg-accent/50 transition-colors ${focusedTransactionId === tx.id ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {tx.type === "ingreso" ? (
                    <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {tx.description || CATEGORY_LABELS[tx.category] || tx.category}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-xs">
                        {CATEGORY_LABELS[tx.category] || tx.category}
                      </Badge>
                      {tx.contextOnly && <Badge variant="outline" className="text-xs">Fuera del período</Badge>}
                      <span className="text-xs text-muted-foreground">{tx.date}</span>
                      {tx.sections?.name && tx.section_id && (
                        <Link href={`/produccion/hacienda?sectionId=${encodeURIComponent(tx.section_id)}`} className="text-xs text-primary hover:underline">
                          Sección: {tx.sections.name}
                        </Link>
                      )}
                      {tx.crops?.crop_type && tx.crop_id && (
                        <Link href={`/produccion/agricultura?cropId=${encodeURIComponent(tx.crop_id)}`} className="text-xs text-primary hover:underline">
                          Cultivo: {tx.crops.crop_type}
                        </Link>
                      )}
                      {tx.cattle && tx.cattle_id && (
                        <Link href={`/produccion/hacienda?cattleId=${encodeURIComponent(tx.cattle_id)}`} className="text-xs text-primary hover:underline">
                          Lote: {tx.cattle.category}
                        </Link>
                      )}
                      {tx.inventory_movement_id && (
                        <Link href={`/gestion/inventario?movementId=${encodeURIComponent(tx.inventory_movement_id)}`} className="text-xs text-primary hover:underline">
                          Ver stock
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-sm font-mono font-medium ${
                      tx.type === "ingreso"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {tx.type === "ingreso" ? "+" : "-"}${tx.amount.toLocaleString()} {tx.currency}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Acciones" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {tx.inventory_movement_id ? (
                        <DropdownMenuItem asChild>
                          <Link href={`/gestion/inventario?movementId=${encodeURIComponent(tx.inventory_movement_id)}`}>
                            <DollarSign className="mr-2 h-4 w-4" />Gestionar desde Inventario
                          </Link>
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuItem onClick={() => openEditTransaction(tx)}>
                            <Pencil className="mr-2 h-4 w-4" />Editar
                          </DropdownMenuItem>
                          <ConfirmDialog
                            trigger={
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" />Eliminar
                              </DropdownMenuItem>
                            }
                            title="Eliminar transaccion"
                            description="Esta accion no se puede deshacer."
                            onConfirm={() => deleteTransaction(tx.id)}
                          />
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sheet for new transaction */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (open) setSheetOpen(true); else requestSheetClose(); }}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingId ? "Editar transaccion" : "Nueva transaccion"}</SheetTitle>
            <SheetDescription>{editingId ? "Corrige el movimiento sin perder su registro histórico." : "Registra un ingreso o egreso."}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-6">
            {/* Type radio */}
            <div className="space-y-2">
              <Label>Tipo</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="txType"
                    checked={fType === "ingreso"}
                    onChange={() => setFType("ingreso")}
                    className="accent-emerald-500"
                  />
                  <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Ingreso</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="txType"
                    checked={fType === "egreso"}
                    onChange={() => setFType("egreso")}
                    className="accent-red-500"
                  />
                  <span className="text-sm text-red-600 dark:text-red-400 font-medium">Egreso</span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={fCategory} onValueChange={setFCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2"><Label>Descripcion</Label><Input value={fDescription} onChange={(e) => setFDescription(e.target.value)} placeholder="Ej: Venta de novillos" /></div>
            <div className="space-y-2"><Label>Monto</Label><Input type="number" value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="1000" /></div>

            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select value={fCurrency} onValueChange={setFCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2"><Label>Fecha</Label><Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} /></div>

            <div className="space-y-2">
              <Label>Seccion (opcional)</Label>
              <Select value={fSectionId || "none"} onValueChange={changeFinanceSection}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cultivo (opcional)</Label>
              <Select value={fCropId || "none"} onValueChange={changeFinanceCrop}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {crops.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.crop_type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Hacienda (opcional)</Label>
              <Select value={fCattleId || "none"} onValueChange={changeFinanceCattle}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {cattle.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.category}{c.breed ? ` (${c.breed})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2"><Label>Notas</Label><Input value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="Observaciones..." /></div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={requestSheetClose} disabled={saving}>Cancelar</Button>
            <Button onClick={saveTransaction} disabled={readOnly || !fAmount || Number(fAmount) <= 0 || saving}>{saving ? "Guardando..." : editingId ? "Guardar cambios" : "Guardar"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <UnsavedChangesDialog
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        onDiscard={discardFormChanges}
      />
    </div>
  );
}

export default function FinanzasPage() {
  return <Suspense fallback={<LoadingPage />}><FinanzasPageContent /></Suspense>;
}
