"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { mergeFinancialContext } from "@/lib/finance-navigation";
import { financialPeriodStart } from "@/lib/finance-period";
import { dateInputValue } from "@/lib/date";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { isCachedTransaction, type FinanceCattleBatch, type FinanceCrop, type FinancePeriod, type Transaction } from "./finance-types";

function readEntitySnapshot(userId: string | null) {
  try {
    return userId ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId))) : null;
  } catch {
    return null;
  }
}

/** Transactions for the period (plus the one opened by `?transactionId=`, even
 * outside it) and the cattle/crop references, online or from the offline snapshot. */
export function useFinanceData({ userId, offlineReadOnly, period, navigationQuery }: {
  userId: string | null;
  offlineReadOnly: boolean;
  period: FinancePeriod;
  navigationQuery: string;
}) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsTruncated, setTransactionsTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [offlineFinancialSavedAt, setOfflineFinancialSavedAt] = useState<string | null>(null);
  const [cattle, setCattle] = useState<FinanceCattleBatch[]>([]);
  const [crops, setCrops] = useState<FinanceCrop[]>([]);
  const [relatedDataError, setRelatedDataError] = useState(false);
  const requestedTransactionIdRef = useRef<string | null>(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("transactionId"));
  const transactionsRequestId = useRef(0);
  const transactionsRequestRef = useRef<AbortController | null>(null);
  const cattleRequestRef = useRef<AbortController | null>(null);
  const cropsRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (navigationQuery) requestedTransactionIdRef.current = new URLSearchParams(navigationQuery).get("transactionId");
  }, [navigationQuery]);

  const loadTransactions = useCallback(async () => {
    const requestId = ++transactionsRequestId.current;
    transactionsRequestRef.current?.abort();
    const controller = new AbortController();
    transactionsRequestRef.current = controller;
    setLoadError(false);
    setTransactionsTruncated(false);
    setOfflineFinancialSavedAt(null);

    if (offlineReadOnly) {
      const snapshot = readEntitySnapshot(userId);
      const allCachedTransactions = snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.financialTransactions)
        ? snapshot.financialTransactions.filter(isCachedTransaction)
        : null;
      const cachedTransactions = allCachedTransactions
        ? (() => {
          const recentTransactions = allCachedTransactions.filter((transaction) => transaction.date >= financialPeriodStart(period, dateInputValue()));
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
      const snapshot = readEntitySnapshot(userId);
      const cachedCattle = snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.cattle)
        ? snapshot.cattle.filter((batch): batch is FinanceCattleBatch => Boolean(batch && typeof batch === "object" && typeof (batch as FinanceCattleBatch).id === "string"))
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
      const nextCattle = await res.json() as FinanceCattleBatch[];
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
      const snapshot = readEntitySnapshot(userId);
      const cachedCrops = snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.crops)
        ? snapshot.crops.filter((crop): crop is FinanceCrop => Boolean(crop && typeof crop === "object" && typeof (crop as FinanceCrop).id === "string"))
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
      const nextCrops = await res.json() as FinanceCrop[];
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

  return {
    transactions, transactionsTruncated, loaded, loadError, offlineFinancialSavedAt,
    cattle, crops, relatedDataError, loadTransactions,
  };
}
