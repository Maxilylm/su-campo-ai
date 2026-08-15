"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import type { ServiceStatusPayload } from "@/lib/service-status";
import { fetchServiceStatus } from "@/lib/service-status-client";
import { shouldRefreshAfterForeground } from "@/lib/use-data-changed-refresh";
import { ServiceHealthReport } from "@/components/ServiceHealthReport";

export function ServiceHealthCard() {
  const { isOnline } = useFarm();
  const [data, setData] = useState<ServiceStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const foregroundCheckedAt = useRef(0);

  const check = useCallback(async () => {
    const currentRequest = ++requestId.current;
    requestRef.current?.abort();
    if (!isOnline) {
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const { payload, checkedAt } = await fetchServiceStatus({ signal: controller.signal });
      if (currentRequest !== requestId.current || controller.signal.aborted) return;
      setData(payload);
      setCheckedAt(checkedAt);
    } catch {
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      setError(true);
      setData(null);
      setCheckedAt(new Date().toISOString());
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        if (requestRef.current === controller) requestRef.current = null;
      }
    }
  }, [isOnline]);

  useEffect(() => {
    foregroundCheckedAt.current = Date.now();
    void check();
    return () => {
      requestId.current += 1;
      requestRef.current?.abort();
    };
  }, [check]);

  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState !== "visible" || !isOnline) return;
      if (!shouldRefreshAfterForeground(foregroundCheckedAt.current)) return;
      foregroundCheckedAt.current = Date.now();
      void check();
    };
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [check, isOnline]);

  return <ServiceHealthReport data={data} loading={loading} error={error} checkedAt={checkedAt} isOnline={isOnline} onCheck={() => void check()} />;
}
