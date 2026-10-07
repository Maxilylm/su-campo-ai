"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { StatStrip } from "@/components/StatCard";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { SchemaMigrationNotice } from "@/components/SchemaMigrationNotice";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/produccion/Notice";
import { CaravanasImportDialog } from "@/components/produccion/caravanas/CaravanasImportDialog";
import { CaravanaFormSheet } from "@/components/produccion/caravanas/CaravanaFormSheet";
import { AssignCaravanasDialog } from "@/components/produccion/caravanas/AssignCaravanasDialog";
import { CaravanasTable } from "@/components/produccion/caravanas/CaravanasTable";
import { ReconciliationPanel } from "@/components/produccion/caravanas/ReconciliationPanel";
import { EstablishmentCard } from "@/components/produccion/caravanas/EstablishmentCard";
import { PAGE_SIZE, useCaravanasData } from "@/components/produccion/caravanas/useCaravanasData";
import { EMPTY_FILTERS, type CaravanaFilters, type CaravanaItem } from "@/components/produccion/caravanas/types";
import { CARAVANAS_MIGRATION_FILE, categoryLabel, sexLabel } from "@/lib/caravanas";
import { sendJsonResult } from "@/lib/mutate";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function CaravanasPage() {
  const { sections: farmSections, readOnly, offlineMode, isOnline } = useFarm();
  const online = !offlineMode && isOnline;
  const [filters, setFilters] = useState<CaravanaFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebounced(filters.q, 300);
  const queryFilters = useMemo(() => ({ ...filters, q: debouncedQuery }), [debouncedQuery, filters]);
  const data = useCaravanasData(queryFilters, page, online);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<CaravanaItem | null>(null);
  const sections = useMemo(() => farmSections.map((section) => ({ id: section.id, name: section.name })), [farmSections]);
  const totalPages = Math.max(1, Math.ceil(data.list.total / PAGE_SIZE));

  // After deleting or reassigning the last rows of the last page, step back
  // (adjusting state while rendering, as React recommends over an effect).
  if (page > totalPages && !data.listLoading && data.list.total > 0) setPage(totalPages);

  function changeFilters(patch: Partial<CaravanaFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function togglePage(select: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of data.list.items) {
        if (select) next.add(item.id); else next.delete(item.id);
      }
      return next;
    });
  }

  async function deleteIds(ids: string[]) {
    const result = await sendJsonResult("/api/caravanas", "DELETE", { ids });
    if (!result.ok) {
      toast.error(result.error || "No se pudieron eliminar las caravanas.");
      return;
    }
    toast.success(ids.length === 1 ? "Caravana eliminada" : `${ids.length.toLocaleString("es-UY")} caravanas eliminadas`);
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  if (!online) {
    return (
      <div className="space-y-6">
        <PageHeader title="Caravanas" description="Registro individual de animales por caravana oficial (SNIG)." />
        <Notice tone="offline">Las caravanas necesitan conexión. Volvé a esta página cuando recuperes internet.</Notice>
      </div>
    );
  }
  if (!data.loaded) return <LoadingPage />;
  if (data.migrationMissing) {
    return (
      <div className="space-y-6">
        <PageHeader title="Caravanas" description="Registro individual de animales por caravana oficial (SNIG)." />
        <Notice tone="warn" title="Falta activar las caravanas en la base de datos">
          Quien administra CampoAI tiene que aplicar la migración de caravanas en Supabase. El resto de la app sigue funcionando.
        </Notice>
        <SchemaMigrationNotice migrations={[CARAVANAS_MIGRATION_FILE]} />
      </div>
    );
  }
  if (data.loadError && !data.summary) return <LoadErrorState title="No se pudieron cargar las caravanas" onRetry={() => void data.refresh()} />;

  const summary = data.summary;
  const inactive = summary ? (summary.byStatus.vendido || 0) + (summary.byStatus.muerto || 0) + (summary.byStatus.faltante || 0) : 0;
  const selectedIds = [...selected];
  const topCategories = summary
    ? Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, n]) => `${categoryLabel(key)} ${n.toLocaleString("es-UY")}`).join(" · ")
    : "";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Caravanas"
        description="Cada animal por su caravana oficial del SNIG. Asignalos a lotes o potreros cuando quieras, conciliá cabezas y exportá el listado para declaraciones y guías."
        actions={
          <>
            <AuthenticatedDownloadLink
              href="/api/caravanas?format=csv"
              filename="campoai-caravanas-snig.csv"
              className={buttonVariants({ variant: "outline" })}
            >
              <Download className="h-4 w-4" aria-hidden="true" />Exportar CSV
            </AuthenticatedDownloadLink>
            <CaravanasImportDialog open={importOpen} onOpenChange={setImportOpen} lotes={data.lotes} sections={sections} readOnly={readOnly} onImported={data.refresh} />
            <Button onClick={() => { setEditing(null); setFormOpen(true); }} disabled={readOnly}><Plus className="h-4 w-4" aria-hidden="true" />Caravana</Button>
          </>
        }
      />

      {data.loadError && <Notice tone="warn">No se pudo actualizar la lista. Revisá tu conexión; los datos pueden estar desactualizados.</Notice>}

      {summary && summary.total > 0 && (
        <StatStrip
          items={[
            { label: "Activas", value: summary.active.toLocaleString("es-UY"), unit: "cab.", hint: topCategories || undefined },
            { label: "Sin lote", value: summary.withoutLote.toLocaleString("es-UY"), hint: summary.unassigned > 0 ? `${summary.unassigned.toLocaleString("es-UY")} sin potrero tampoco` : undefined },
            { label: "Machos / hembras", value: `${(summary.bySex.macho || 0).toLocaleString("es-UY")} / ${(summary.bySex.hembra || 0).toLocaleString("es-UY")}`, hint: summary.bySex.sin_dato ? `${summary.bySex.sin_dato.toLocaleString("es-UY")} ${sexLabel("sin_dato").toLowerCase()}` : undefined },
            { label: "Bajas", value: inactive.toLocaleString("es-UY"), hint: inactive > 0 ? "vendidas, muertas o faltantes" : undefined, tone: (summary.byStatus.faltante || 0) > 0 ? "warn" : undefined },
          ]}
        />
      )}

      <EstablishmentCard key={data.dicoseNumber || ""} dicoseNumber={data.dicoseNumber} readOnly={readOnly} onSaved={data.setDicoseNumber} />

      {summary && summary.active > 0 && (
        <ReconciliationPanel
          lotes={data.lotes}
          byCattle={summary.byCattle}
          lotesTruncated={data.lotesTruncated}
          activeLoteId={filters.cattleId}
          onSelectLote={(id) => changeFilters({ cattleId: id })}
        />
      )}

      {selectedIds.length > 0 && !readOnly && (
        <div role="region" aria-label="Acciones sobre las caravanas seleccionadas" className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
          <span className="px-2 text-sm"><span className="figure font-semibold">{selectedIds.length.toLocaleString("es-UY")}</span> {selectedIds.length === 1 ? "seleccionada" : "seleccionadas"}</span>
          <Button onClick={() => setAssignOpen(true)}>Asignar a lote / potrero</Button>
          <ConfirmDialog
            trigger={<Button variant="outline"><Trash2 className="h-4 w-4" aria-hidden="true" />Eliminar</Button>}
            title={`Eliminar ${selectedIds.length.toLocaleString("es-UY")} ${selectedIds.length === 1 ? "caravana" : "caravanas"}`}
            description="Se borran del registro de CampoAI (no del SNIG). Para ventas o muertes, mejor cambiá el estado con Asignar."
            onConfirm={() => deleteIds(selectedIds)}
          />
          <Button variant="ghost" onClick={() => setSelected(new Set())}><X className="h-4 w-4" aria-hidden="true" />Limpiar</Button>
        </div>
      )}

      <CaravanasTable
        items={data.list.items}
        total={data.list.total}
        totalRegistered={summary?.total ?? data.list.total}
        filters={filters}
        onFiltersChange={changeFilters}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        loading={data.listLoading}
        lotes={data.lotes}
        sections={sections}
        selected={selected}
        onToggle={toggle}
        onTogglePage={togglePage}
        readOnly={readOnly}
        onImportHint={() => setImportOpen(true)}
        onEdit={(item) => { setEditing(item); setFormOpen(true); }}
        onDelete={deleteIds}
      />

      <AssignCaravanasDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        ids={selectedIds}
        lotes={data.lotes}
        sections={sections}
        onDone={() => setSelected(new Set())}
      />
      <CaravanaFormSheet
        open={formOpen}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}
        editing={editing}
        lotes={data.lotes}
        sections={sections}
        readOnly={readOnly}
      />
    </div>
  );
}
