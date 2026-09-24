"use client";

import { Suspense, useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Printer } from "lucide-react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { CampoAIButton } from "@/components/CampoAIButton";
import { FinanceImportDialog } from "@/components/FinanceImportDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Notice } from "@/components/gestion/Notice";
import { SegmentedControl } from "@/components/gestion/SegmentedControl";
import { FinanceSummary } from "@/components/gestion/FinanceSummary";
import { FinanceCostUnits } from "@/components/gestion/FinanceCostUnits";
import { FinanceTransactionList } from "@/components/gestion/FinanceTransactionList";
import { FinanceTransactionSheet } from "@/components/gestion/FinanceTransactionSheet";
import { useFinanceData } from "@/components/gestion/useFinanceData";
import {
  FINANCE_CATEGORIES, FINANCE_CURRENCIES, FINANCE_PERIODS, emptyFinanceForm, financeFormSignature,
  type FinanceFormState, type FinancePeriod, type Transaction,
} from "@/components/gestion/finance-types";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { filterFinancialTransactions } from "@/lib/reports";
import { costPerUnitRows, financeTotalsByCurrency } from "@/lib/finance-summary";
import { dateInputValue } from "@/lib/date";
import { useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { parseLocalizedNumber } from "@/lib/number";

function FinanzasPageContent() {
  const { sections, userId, readOnly, offlineMode, isOnline } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const [period, setPeriod] = useState<FinancePeriod>("30d");
  const {
    transactions, transactionsTruncated, loaded, loadError, offlineFinancialSavedAt,
    cattle, crops, relatedDataError, loadTransactions,
  } = useFinanceData({ userId, offlineReadOnly, period, navigationQuery });
  const [sectionFilter, setSectionFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FinanceFormState>(() => emptyFinanceForm(""));
  const [focusedTransactionId, setFocusedTransactionId] = useState<string | null>(null);
  const handledNavigationQueryRef = useRef<string | null>(null);
  const transactionAttempt = useRef<{ key: string; signature: string } | null>(null);
  const formBaselineRef = useRef<string | null>(null);

  const updateForm = (patch: Partial<FinanceFormState>) => setForm((current) => ({ ...current, ...patch }));

  function openSheetWith(next: FinanceFormState) {
    setForm(next);
    formBaselineRef.current = financeFormSignature(next);
    setSheetOpen(true);
  }

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    if (params.get("new") === "1") {
      const requestedType = params.get("type");
      const requestedCategory = params.get("category");
      openSheetWith({
        editingId: null,
        type: requestedType === "ingreso" ? "ingreso" : "egreso",
        category: FINANCE_CATEGORIES.some((category) => category.value === requestedCategory) ? requestedCategory! : "otro",
        description: params.get("description") || "",
        amount: "",
        currency: FINANCE_CURRENCIES.includes(params.get("currency") || "") ? params.get("currency")! : "USD",
        date: params.get("date") || dateInputValue(),
        sectionId: params.get("sectionId") || "",
        cropId: params.get("cropId") || "",
        cattleId: params.get("cattleId") || "",
        notes: "",
      });
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
    setForm(emptyFinanceForm(dateInputValue()));
  }

  function openNewTransaction() {
    transactionAttempt.current = null;
    openSheetWith(emptyFinanceForm(dateInputValue()));
  }

  function openEditTransaction(transaction: Transaction) {
    openSheetWith({
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
    });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, financeFormSignature(form)));

  function discardFormChanges() {
    setDiscardDialogOpen(false);
    setSheetOpen(false);
    resetForm();
  }

  function requestSheetClose() {
    if (saving) return;
    if (hasUnsavedChanges(formBaselineRef.current, financeFormSignature(form))) {
      setDiscardDialogOpen(true);
      return;
    }
    setSheetOpen(false);
    resetForm();
  }

  function changeFinanceSection(value: string) {
    const nextSection = value === "none" ? "" : value;
    const patch: Partial<FinanceFormState> = { sectionId: nextSection };
    const crop = crops.find((option) => option.id === form.cropId);
    const cattleBatch = cattle.find((option) => option.id === form.cattleId);
    if (nextSection && crop?.section_id && crop.section_id !== nextSection) patch.cropId = "";
    if (nextSection && cattleBatch?.section_id && cattleBatch.section_id !== nextSection) patch.cattleId = "";
    updateForm(patch);
  }

  function changeFinanceCrop(value: string) {
    const nextCrop = value === "none" ? "" : value;
    const crop = crops.find((option) => option.id === nextCrop);
    updateForm(crop?.section_id ? { cropId: nextCrop, sectionId: crop.section_id } : { cropId: nextCrop });
  }

  function changeFinanceCattle(value: string) {
    const nextCattle = value === "none" ? "" : value;
    const cattleBatch = cattle.find((option) => option.id === nextCattle);
    updateForm(cattleBatch?.section_id ? { cattleId: nextCattle, sectionId: cattleBatch.section_id } : { cattleId: nextCattle });
  }

  async function saveTransaction() {
    const { editingId } = form;
    if (readOnly || !form.amount || parseLocalizedNumber(form.amount) <= 0) return;
    setSaving(true);
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        type: form.type,
        category: form.category,
        description: form.description || null,
        amount: parseLocalizedNumber(form.amount),
        currency: form.currency,
        date: form.date || null,
        sectionId: form.sectionId || null,
        cropId: form.cropId || null,
        cattleId: form.cattleId || null,
        notes: form.notes || null,
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
        toast.success(editingId ? "Movimiento actualizado" : "Movimiento guardado");
        setSheetOpen(false);
        resetForm();
        await loadTransactions();
      } else {
        toast.error(result.error || (editingId ? "No se pudo actualizar el movimiento. Revisá los datos e intentá de nuevo." : "No se pudo guardar el movimiento. Revisá los datos e intentá de nuevo."));
      }
    } catch {
      toast.error(editingId ? "No se pudo actualizar el movimiento. Revisá tu conexión e intentá de nuevo." : "No se pudo guardar el movimiento. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTransaction(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/financial", "DELETE", { id });
    if (result.ok) { toast.success("Movimiento eliminado"); await loadTransactions(); }
    else toast.error(result.error || "No se pudo eliminar el movimiento. Intentá de nuevo.");
  }

  function clearFilters() {
    setSectionFilter("all");
    setCurrencyFilter("all");
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

  const totalsByCurrency = financeTotalsByCurrency(summaryTransactions);
  const costUnits = costPerUnitRows(summaryTransactions, cattle, crops);

  const financeAIFacts = [
    `Período: ${period}`,
    `Filtros: sección ${sectionFilter === "all" ? "todas" : sectionFilter}, moneda ${currencyFilter === "all" ? "todas" : currencyFilter}`,
    `Movimientos visibles: ${visibleTransactions.length}${transactionsTruncated ? "+" : ""}`,
    ...Object.entries(totalsByCurrency).map(([currency, totals]) => `Resultado ${currency}: ingresos ${totals.income}, egresos ${totals.expenses}, neto ${totals.income - totals.expenses}`),
    ...visibleTransactions.slice(0, 20).map((transaction) => `${transaction.date}: ${transaction.type} ${transaction.currency} ${transaction.amount} — ${transaction.description || transaction.category}`),
  ];

  if (!loaded) return <LoadingPage />;
  if (loadError) {
    return (
      <LoadErrorState
        title={offlineReadOnly ? "No hay una copia local de Finanzas" : "No se pudo cargar Finanzas"}
        description={offlineReadOnly ? "Sincronizá Finanzas desde Mi campo cuando recuperes la conexión para consultar movimientos sin conexión." : undefined}
        onRetry={offlineReadOnly ? undefined : loadTransactions}
      />
    );
  }

  const saveDisabled = readOnly || !form.amount || parseLocalizedNumber(form.amount) <= 0 || saving;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Finanzas"
        description="Ingresos, egresos y cuánto cuesta cada lote o cultivo."
        actions={
          <>
            <CampoAIButton
              title="Finanzas"
              facts={financeAIFacts}
              partial={transactionsTruncated || relatedDataError}
              instruction="No mezcles monedas y ayudame a detectar desvíos, costos o próximos pasos financieros respaldados por estos movimientos."
              disabled={transactions.length === 0}
            />
            <Button variant="ghost" asChild><Link href="/reportes"><Printer className="h-4 w-4" aria-hidden="true" />Reportes</Link></Button>
            <FinanceImportDialog sections={sections} crops={crops} cattle={cattle} readOnly={readOnly} onImported={loadTransactions} />
            <Button onClick={openNewTransaction} disabled={readOnly}><Plus className="h-4 w-4" aria-hidden="true" />Nuevo movimiento</Button>
          </>
        }
      />

      {(relatedDataError || offlineFinancialSavedAt || transactionsTruncated || transactions.some((transaction) => transaction.contextOnly)) && (
        <div className="space-y-3">
          {relatedDataError && <Notice tone="warn">No se pudieron cargar algunas referencias de hacienda o cultivos. Podés registrar el movimiento sin asignarlas.</Notice>}
          {offlineFinancialSavedAt && (
            <Notice title="Finanzas en modo lectura">
              Mostrando Finanzas sincronizadas el {new Date(offlineFinancialSavedAt).toLocaleString("es-UY")}. Las modificaciones se habilitan al recuperar la conexión.
            </Notice>
          )}
          {transactionsTruncated && (
            <Notice>
              Se muestran los 500 movimientos más recientes del período. Para ver el conjunto completo,{" "}
              <AuthenticatedDownloadLink href="/api/export?format=csv&table=financial_transactions" filename="campoai-finanzas.csv" className="font-medium text-primary underline-offset-2 hover:underline">descargá Finanzas (CSV)</AuthenticatedDownloadLink>.
            </Notice>
          )}
          {transactions.some((transaction) => transaction.contextOnly) && (
            <Notice>También se muestra el movimiento abierto desde el Registro, aunque queda fuera del período elegido.</Notice>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl label="Período" options={FINANCE_PERIODS} value={period} onChange={setPeriod} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger size="sm" className="w-[11.5rem]" aria-label="Filtrar por sección"><SelectValue placeholder="Sección" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las secciones</SelectItem>
              {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
              <SelectItem value="unassigned">Sin asignar</SelectItem>
            </SelectContent>
          </Select>
          <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
            <SelectTrigger size="sm" className="w-[11.5rem]" aria-label="Filtrar por moneda"><SelectValue placeholder="Moneda" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las monedas</SelectItem>
              {availableCurrencies.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasActiveFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>}
        </div>
      </div>

      <FinanceSummary totalsByCurrency={totalsByCurrency} />

      <FinanceCostUnits rows={costUnits} />

      <FinanceTransactionList
        transactions={visibleTransactions}
        totalCount={transactions.length}
        hasActiveFilters={hasActiveFilters}
        focusedTransactionId={focusedTransactionId}
        onNew={openNewTransaction}
        onClearFilters={clearFilters}
        onEdit={openEditTransaction}
        onDelete={deleteTransaction}
      />

      <FinanceTransactionSheet
        open={sheetOpen}
        onOpen={() => setSheetOpen(true)}
        onRequestClose={requestSheetClose}
        form={form}
        onChange={updateForm}
        onSectionChange={changeFinanceSection}
        onCropChange={changeFinanceCrop}
        onCattleChange={changeFinanceCattle}
        onSave={saveTransaction}
        saveDisabled={saveDisabled}
        saving={saving}
        sections={sections}
        crops={crops}
        cattle={cattle}
      />
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
