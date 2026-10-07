"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { caravanaLoteLabel, parseCaravanaSummary, type CaravanaSummary } from "@/lib/caravanas";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import type { CaravanaFilters, CaravanaItem, LoteOption } from "./types";

export const PAGE_SIZE = 50;

interface ListState {
  items: CaravanaItem[];
  total: number;
}

/**
 * Loads the caravanas page: the registry summary and DICOSE (one RPC), the
 * lotes for assignment/reconciliation, and one filtered page of caravanas.
 * `migrationMissing` turns the page into the "apply 054" notice.
 */
export function useCaravanasData(filters: CaravanaFilters, page: number, enabled: boolean) {
  const [summary, setSummary] = useState<CaravanaSummary | null>(null);
  const [dicoseNumber, setDicoseNumber] = useState<string | null>(null);
  const [lotes, setLotes] = useState<LoteOption[]>([]);
  const [lotesTruncated, setLotesTruncated] = useState(false);
  const [list, setList] = useState<ListState>({ items: [], total: 0 });
  const [loaded, setLoaded] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const overviewRequest = useRef<AbortController | null>(null);
  const listRequest = useRef<AbortController | null>(null);

  const loadOverview = useCallback(async () => {
    if (!enabled) { setLoaded(true); return; }
    overviewRequest.current?.abort();
    const controller = new AbortController();
    overviewRequest.current = controller;
    try {
      const [summaryRes, cattleRes] = await Promise.all([
        fetchWithTimeout("/api/caravanas?view=summary", { cache: "no-store", signal: controller.signal }, 10000),
        fetchWithTimeout("/api/cattle", { cache: "no-store", signal: controller.signal }, 10000),
      ]);
      const summaryPayload = await summaryRes.json().catch(() => null) as { code?: string; summary?: unknown; dicoseNumber?: unknown } | null;
      if (controller.signal.aborted) return;
      if (summaryPayload?.code === "caravanas_migration_required") {
        setMigrationMissing(true);
        setLoadError(false);
        return;
      }
      if (!summaryRes.ok || !cattleRes.ok) throw new Error("caravanas overview failed");
      const cattle = await cattleRes.json() as Array<{ id: string; category: string; breed: string | null; count: number; section_id: string | null; sections?: { name?: string } | null }>;
      if (controller.signal.aborted) return;
      setMigrationMissing(false);
      setSummary(parseCaravanaSummary(summaryPayload?.summary));
      setDicoseNumber(typeof summaryPayload?.dicoseNumber === "string" ? summaryPayload.dicoseNumber : null);
      setLotes((Array.isArray(cattle) ? cattle : []).map((row) => ({
        id: row.id,
        label: caravanaLoteLabel(row) || "Lote",
        count: row.count,
        sectionId: row.section_id,
      })));
      setLotesTruncated(cattleRes.headers.get("X-CampoAI-Cattle-Truncated") === "true");
      setLoadError(false);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Caravanas overview error:", error);
        setLoadError(true);
      }
    } finally {
      if (overviewRequest.current === controller) {
        overviewRequest.current = null;
        setLoaded(true);
      }
    }
  }, [enabled]);

  const loadList = useCallback(async () => {
    if (!enabled) return;
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setListLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status: filters.status });
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.cattleId) params.set("cattleId", filters.cattleId);
    if (filters.sectionId) params.set("sectionId", filters.sectionId);
    try {
      const res = await fetchWithTimeout(`/api/caravanas?${params.toString()}`, { cache: "no-store", signal: controller.signal }, 10000);
      const payload = await res.json().catch(() => null) as { code?: string; items?: CaravanaItem[]; total?: number } | null;
      if (controller.signal.aborted) return;
      if (payload?.code === "caravanas_migration_required") { setMigrationMissing(true); return; }
      if (!res.ok) throw new Error("caravanas list failed");
      setList({ items: Array.isArray(payload?.items) ? payload.items : [], total: Number(payload?.total) || 0 });
      setLoadError(false);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Caravanas list error:", error);
        setLoadError(true);
      }
    } finally {
      if (listRequest.current === controller) {
        listRequest.current = null;
        setListLoading(false);
      }
    }
  }, [enabled, filters.cattleId, filters.q, filters.sectionId, filters.status, page]);

  useEffect(() => {
    void loadOverview();
    return () => overviewRequest.current?.abort();
  }, [loadOverview]);

  useEffect(() => {
    void loadList();
    return () => listRequest.current?.abort();
  }, [loadList]);

  const refresh = useCallback(async () => {
    await Promise.all([loadOverview(), loadList()]);
  }, [loadList, loadOverview]);
  useDataChangedRefresh(refresh, enabled);

  return {
    summary, dicoseNumber, setDicoseNumber, lotes, lotesTruncated, list, loaded, listLoading, loadError, migrationMissing, refresh,
  };
}
