"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Alert } from "@/lib/alerts";
import { clearOfflineSnapshotStale as clearStoredOfflineSnapshotStale, clearOfflineSnapshots, isOfflineSnapshotFresh, isOfflineSnapshotStale, markOfflineSnapshotStale, mergeOfflineFarmSnapshot, offlineSnapshotKey, offlineSnapshotKeys, offlineSnapshotStaleAt, offlineSnapshotStaleKey, parseOfflineSnapshot, type FarmOfflineSnapshot } from "@/lib/offline";
import { DATA_CHANGED_EVENT, OFFLINE_SYNC_EVENT, SECTIONS_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { subscribeToAuthExpired } from "@/lib/auth-session";
import { loginRedirectFor } from "@/lib/navigation";
import { clearAuthenticatedShellCache } from "@/lib/service-worker";

export interface Farm {
  id: string;
  name: string;
  total_hectares: number | null;
  location: string | null;
  operation_type: "livestock" | "crops" | "mixed";
}

export interface Section {
  id: string;
  name: string;
  size_hectares: number | null;
  capacity: number | null;
  color: string;
  water_status: string;
  pasture_status: string;
  notes: string | null;
  padron_id: string | null;
}

interface FarmContextValue {
  farm: Farm | null;
  sections: Section[];
  loading: boolean;
  noFarm: boolean;
  userId: string | null;
  error: string | null;
  userEmail: string;
  alerts: Alert[];
  alertsLoaded: boolean;
  alertsError: string | null;
  alertsTruncated: boolean;
  sectionsTruncated: boolean;
  sectionsError: string | null;
  offlineMode: boolean;
  isOnline: boolean;
  readOnly: boolean;
  lastSyncedAt: string | null;
  offlineSyncWarnings: string[];
  offlineSnapshotStale: boolean;
  clearOfflineSnapshotStale: () => void;
  refreshFarm: () => Promise<void>;
  refreshSections: () => Promise<Section[]>;
  refreshAlerts: () => Promise<Alert[]>;
  setFarm: (farm: Farm | null) => void;
  setNoFarm: (v: boolean) => void;
}

const FarmContext = createContext<FarmContextValue | null>(null);

export function useFarm() {
  const ctx = useContext(FarmContext);
  if (!ctx) throw new Error("useFarm must be used within FarmProvider");
  return ctx;
}

export function FarmProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [farm, setFarm] = useState<Farm | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [noFarm, setNoFarm] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsTruncated, setAlertsTruncated] = useState(false);
  const [sectionsTruncated, setSectionsTruncated] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [offlineSyncWarnings, setOfflineSyncWarnings] = useState<string[]>([]);
  const [offlineSnapshotStale, setOfflineSnapshotStale] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const alertsRef = useRef<Alert[]>([]);
  const alertsTruncatedRef = useRef(false);
  const alertsErrorRef = useRef(false);
  const sectionsRequestId = useRef(0);
  const sectionsRequestRef = useRef<AbortController | null>(null);
  const sectionsTruncatedRef = useRef(false);
  const alertsRequestId = useRef(0);
  const alertsRequestRef = useRef<AbortController | null>(null);
  const farmRequestId = useRef(0);
  const farmRequestRef = useRef<AbortController | null>(null);
  const foregroundRefreshAt = useRef(0);
  const authRedirectingRef = useRef(false);

  const setAlertsSafely = useCallback((next: Alert[]) => {
    alertsRef.current = next;
    setAlerts(next);
  }, []);

  const setAlertsTruncatedSafely = useCallback((next: boolean) => {
    alertsTruncatedRef.current = next;
    setAlertsTruncated(next);
  }, []);

  const refreshSections = useCallback(async () => {
    const currentRequest = ++sectionsRequestId.current;
    sectionsRequestRef.current?.abort();
    const controller = new AbortController();
    sectionsRequestRef.current = controller;
    setSectionsError(null);
    try {
      const res = await fetchWithTimeout("/api/sections", { signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("No se pudieron cargar las secciones.");
      const nextSections = await res.json();
      if (currentRequest === sectionsRequestId.current) {
        setSections(nextSections);
        const truncated = res.headers.get("X-CampoAI-Sections-Truncated") === "true";
        sectionsTruncatedRef.current = truncated;
        setSectionsTruncated(truncated);
      }
      return nextSections as Section[];
    } catch (error) {
      if (!controller.signal.aborted && currentRequest === sectionsRequestId.current) {
        setSectionsError(error instanceof Error ? error.message : "No se pudieron actualizar las secciones.");
      }
      throw error;
    } finally {
      if (sectionsRequestRef.current === controller) sectionsRequestRef.current = null;
    }
  }, []);

  // Single source of truth for alerts — shared by the NavBar badge and the
  // home AlertsPanel so the page only fetches /api/alerts once.
  const refreshAlerts = useCallback(async () => {
    const currentRequest = ++alertsRequestId.current;
    alertsRequestRef.current?.abort();
    const controller = new AbortController();
    alertsRequestRef.current = controller;
    alertsErrorRef.current = false;
    setAlertsError(null);
    try {
      const res = await fetchWithTimeout("/api/alerts", { signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("alerts request failed");
      const d = await res.json();
      const nextAlerts = d.alerts || [];
      if (currentRequest !== alertsRequestId.current) return alertsRef.current;
      setAlertsSafely(nextAlerts);
      setAlertsTruncatedSafely(d.alertsTruncated === true);
      return nextAlerts as Alert[];
    } catch {
      if (controller.signal.aborted) return alertsRef.current;
      if (currentRequest === alertsRequestId.current) {
        alertsErrorRef.current = true;
        setAlertsError("No se pudieron actualizar los pendientes.");
      }
    }
    finally {
      if (alertsRequestRef.current === controller) alertsRequestRef.current = null;
      if (currentRequest === alertsRequestId.current) setAlertsLoaded(true);
    }
    return alertsRef.current;
  }, [setAlertsSafely, setAlertsTruncatedSafely]);

  const hydrateOfflineSnapshot = useCallback((userId: string) => {
    try {
      const snapshot = parseOfflineSnapshot(window.localStorage.getItem(offlineSnapshotKey(userId)));
      if (!snapshot || !isOfflineSnapshotFresh(snapshot.savedAt)) {
        setOfflineSyncWarnings([]);
        setOfflineSnapshotStale(false);
        return;
      }
      setSectionsError(null);
      const alertsAreStale = snapshot.alertsSyncedAt === null;
      setFarm(snapshot.farm);
      setSections(snapshot.sections);
      sectionsTruncatedRef.current = snapshot.sectionsTruncated === true;
      setSectionsTruncated(sectionsTruncatedRef.current);
      setAlertsSafely(snapshot.alerts);
      setAlertsLoaded(true);
      setAlertsTruncatedSafely(snapshot.alertsTruncated === true);
      setOfflineSyncWarnings(snapshot.syncWarnings ?? []);
      alertsErrorRef.current = alertsAreStale;
      setAlertsError(alertsAreStale ? "Los pendientes pueden estar desactualizados." : null);
      setLastSyncedAt(snapshot.savedAt);
      const staleAt = offlineSnapshotStaleAt(window.localStorage, userId);
      setOfflineSnapshotStale(staleAt !== null && Date.parse(staleAt) > Date.parse(snapshot.savedAt));
    } catch {
      setOfflineSnapshotStale(false);
      // Private browsing and storage restrictions should never block login.
    }
  }, [setAlertsSafely, setAlertsTruncatedSafely]);

  const clearOfflineState = useCallback((message: string) => {
    setFarm(null);
    setSections([]);
    sectionsTruncatedRef.current = false;
    setSectionsTruncated(false);
    setAlertsSafely([]);
    setAlertsLoaded(false);
    alertsErrorRef.current = true;
    setAlertsError(message);
    setAlertsTruncatedSafely(false);
    setLastSyncedAt(null);
    setOfflineSyncWarnings([]);
    setOfflineSnapshotStale(false);
    setOfflineMode(true);
    setNoFarm(false);
    setError(message);
  }, [setAlertsSafely, setAlertsTruncatedSafely]);

  const handleAuthExpired = useCallback(() => {
    if (pathname === "/login" || pathname.startsWith("/auth") || authRedirectingRef.current) return;
    authRedirectingRef.current = true;
    farmRequestId.current += 1;
    sectionsRequestId.current += 1;
    alertsRequestId.current += 1;
    farmRequestRef.current?.abort();
    sectionsRequestRef.current?.abort();
    alertsRequestRef.current?.abort();
    userIdRef.current = null;
    setFarm(null);
    setSections([]);
    sectionsTruncatedRef.current = false;
    setSectionsTruncated(false);
    setSectionsError(null);
    setAlertsSafely([]);
    setAlertsLoaded(false);
    alertsErrorRef.current = false;
    setAlertsError(null);
    setAlertsTruncatedSafely(false);
    setUserId(null);
    setUserEmail("");
    setLastSyncedAt(null);
    setOfflineSyncWarnings([]);
    setOfflineSnapshotStale(false);
    setOfflineMode(false);
    setNoFarm(false);
    setError(null);
    window.location.assign(loginRedirectFor(pathname, window.location.search, "session_expired"));
  }, [pathname, setAlertsSafely, setAlertsTruncatedSafely]);

  useEffect(() => subscribeToAuthExpired(handleAuthExpired), [handleAuthExpired]);

  const clearOfflineSnapshotStale = useCallback(() => {
    const userId = userIdRef.current;
    if (!userId) return;
    try {
      clearStoredOfflineSnapshotStale(window.localStorage, userId);
    } catch {
      // Storage is optional; the in-memory status still reflects the sync.
    }
    setOfflineSnapshotStale(false);
  }, []);

  const saveOfflineSnapshot = useCallback((snapshot: FarmOfflineSnapshot) => {
    const userId = userIdRef.current;
    if (!userId) return;
    try {
      const key = offlineSnapshotKey(userId);
      const previous = parseOfflineSnapshot(window.localStorage.getItem(key));
      window.localStorage.setItem(key, JSON.stringify(mergeOfflineFarmSnapshot(previous, snapshot)));
    } catch {
      // Storage is an enhancement; the online flow remains fully usable.
    }
  }, []);

  const refreshFarm = useCallback(async () => {
    const currentRequest = ++farmRequestId.current;
    farmRequestRef.current?.abort();
    sectionsRequestId.current += 1;
    sectionsRequestRef.current?.abort();
    alertsRequestId.current += 1;
    alertsRequestRef.current?.abort();
    const controller = new AbortController();
    farmRequestRef.current = controller;
    try {
      const res = await fetchWithTimeout("/api/farm", { signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("No se pudo cargar el campo.");
      const { farm: f } = await res.json();
      if (currentRequest !== farmRequestId.current) return;
      if (f) {
        setFarm(f);
        setNoFarm(false);
        // These datasets are independent once the farm has been resolved.
        // Fetch them together so dashboard hydration and the offline snapshot
        // are not delayed by two sequential round trips to Supabase.
        const sectionsPromise = refreshSections();
        const sectionsVersion = sectionsRequestId.current;
        const alertsPromise = refreshAlerts();
        const alertsVersion = alertsRequestId.current;
        const [sectionsResult, alertsResult] = await Promise.allSettled([sectionsPromise, alertsPromise]);
        if (
          currentRequest !== farmRequestId.current
          || sectionsVersion !== sectionsRequestId.current
          || alertsVersion !== alertsRequestId.current
        ) return;

        // The farm record is the critical dependency. A transient sections
        // failure must not make a healthy session look offline or turn the
        // whole dashboard read-only; the dedicated sections consumers can
        // retry independently on their next refresh.
        if (sectionsResult.status !== "fulfilled") {
          setOfflineMode(false);
          setError(null);
          return;
        }

        const nextSections = sectionsResult.value;
        const nextAlerts = alertsResult.status === "fulfilled" ? alertsResult.value : alertsRef.current;
        const savedAt = new Date().toISOString();
        // Keep the farm and sections fresh even when the independent alerts
        // request failed. The snapshot records that alerts are stale so the
        // offline UI can disclose the partial sync instead of hiding it.
        saveOfflineSnapshot({
          farm: f,
          sections: nextSections,
          sectionsTruncated: sectionsTruncatedRef.current,
          alerts: nextAlerts,
          savedAt,
          alertsSyncedAt: alertsErrorRef.current || alertsResult.status !== "fulfilled" ? null : savedAt,
          alertsTruncated: alertsTruncatedRef.current,
        });
        setLastSyncedAt(savedAt);
        setOfflineMode(false);
        setError(null);
      } else {
        setFarm(null);
        setSections([]);
        sectionsTruncatedRef.current = false;
        setSectionsTruncated(false);
        setAlertsSafely([]);
        setAlertsLoaded(false);
        alertsErrorRef.current = false;
        setAlertsError(null);
        setAlertsTruncatedSafely(false);
        setLastSyncedAt(null);
        setOfflineSyncWarnings([]);
        setOfflineSnapshotStale(false);
        setOfflineMode(false);
        const activeUserId = userIdRef.current;
        if (activeUserId) {
          try {
            clearOfflineSnapshots(window.localStorage, activeUserId);
          } catch {
            // Storage is optional; the server response remains authoritative.
          }
        }
        setNoFarm(true);
        setSectionsError(null);
        setError(null);
      }
    } catch (e) {
      if (currentRequest !== farmRequestId.current || controller.signal.aborted) return;
      const userId = userIdRef.current;
      let snapshot: FarmOfflineSnapshot | null = null;
      try {
        snapshot = userId
          ? parseOfflineSnapshot(window.localStorage.getItem(offlineSnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }

      if (snapshot && isOfflineSnapshotFresh(snapshot.savedAt)) {
        setFarm(snapshot.farm);
        setSections(snapshot.sections);
        sectionsTruncatedRef.current = snapshot.sectionsTruncated === true;
        setSectionsTruncated(sectionsTruncatedRef.current);
        setAlertsSafely(snapshot.alerts);
        setAlertsLoaded(true);
        setAlertsTruncatedSafely(snapshot.alertsTruncated === true);
        setOfflineSyncWarnings(snapshot.syncWarnings ?? []);
        const alertsAreStale = snapshot.alertsSyncedAt === null;
        alertsErrorRef.current = alertsAreStale;
        setAlertsError(alertsAreStale ? "Los pendientes pueden estar desactualizados." : null);
        setLastSyncedAt(snapshot.savedAt);
        const staleAt = userId ? offlineSnapshotStaleAt(window.localStorage, userId) : null;
        setOfflineSnapshotStale(staleAt !== null && Date.parse(staleAt) > Date.parse(snapshot.savedAt));
        setOfflineMode(true);
        setNoFarm(false);
        setError(null);
      } else {
        setOfflineSnapshotStale(false);
        // Even without a usable local copy, enter read-only recovery mode so
        // an online event or foreground retry can recover from a transient
        // Supabase outage without requiring a full page reload.
        setOfflineMode(true);
        setError(e instanceof Error ? e.message : "No se pudo cargar el campo.");
      }
    } finally {
      if (farmRequestRef.current === controller) farmRequestRef.current = null;
    }
  }, [refreshSections, refreshAlerts, saveOfflineSnapshot, setAlertsSafely, setAlertsTruncatedSafely]);

  useEffect(() => () => {
    farmRequestId.current += 1;
    sectionsRequestId.current += 1;
    alertsRequestId.current += 1;
    farmRequestRef.current?.abort();
    sectionsRequestRef.current?.abort();
    alertsRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  // localStorage emits this event only in other tabs. If one tab deletes the
  // offline bundle while another tab is already offline, invalidate its
  // in-memory farm instead of continuing to display data that was deleted.
  useEffect(() => {
    if (!userId || !offlineMode) return;
    const keys = new Set(offlineSnapshotKeys(userId));
    const onStorage = (event: StorageEvent) => {
      if (!event.key || !keys.has(event.key)) return;
      if (event.key === offlineSnapshotStaleKey(userId)) {
        try {
          const snapshot = parseOfflineSnapshot(window.localStorage.getItem(offlineSnapshotKey(userId)));
          setOfflineSnapshotStale(Boolean(snapshot && isOfflineSnapshotStale(window.localStorage, userId, snapshot.savedAt)));
        } catch {
          setOfflineSnapshotStale(event.newValue !== null);
        }
      } else if (event.key === offlineSnapshotKey(userId) && event.newValue === null) {
        clearOfflineState("La copia offline fue eliminada desde otra pestaña. Sincronizá una nueva copia al recuperar la conexión.");
      } else if (event.key === offlineSnapshotKey(userId) && event.newValue) {
        hydrateOfflineSnapshot(userId);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [clearOfflineState, hydrateOfflineSnapshot, offlineMode, userId]);

  useEffect(() => {
    if (isOnline && offlineMode && userIdRef.current) void refreshFarm();
  }, [isOnline, offlineMode, refreshFarm]);

  // Load the latest warning metadata when a connection drops or another tab
  // finishes an explicit offline sync. The server-backed dashboard data may
  // still be usable, but the banner must disclose partial cached datasets.
  useEffect(() => {
    const activeUserId = userIdRef.current;
    if (!activeUserId) return;
    if (!isOnline) hydrateOfflineSnapshot(activeUserId);
    return subscribeToAppEvent(OFFLINE_SYNC_EVENT, () => hydrateOfflineSnapshot(activeUserId));
  }, [hydrateOfflineSnapshot, isOnline, userId]);

  // A tab can remain technically online while Supabase recovers in the
  // background. Retry quickly after an unhealthy snapshot, but refresh a
  // healthy foreground tab only every few minutes to avoid request bursts.
  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || !userIdRef.current) return;
      const minimumInterval = offlineMode || error ? 15_000 : 300_000;
      if (Date.now() - foregroundRefreshAt.current < minimumInterval) return;
      foregroundRefreshAt.current = Date.now();
      void refreshFarm();
    };
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [error, offlineMode, refreshFarm]);

  // Mutating pages can stay mounted after a save. Refresh the complete shared
  // snapshot so the dashboard and offline fallback never retain stale farm,
  // section, or alert data. One listener handles both event types because
  // section mutations emit DATA_CHANGED_EVENT first and SECTIONS_CHANGED_EVENT
  // second.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDataChanged = () => {
      if (!navigator.onLine || offlineMode || !userIdRef.current) return;
      try {
        markOfflineSnapshotStale(window.localStorage, userIdRef.current);
        setOfflineSnapshotStale(true);
      } catch {
        // Storage is optional; the online dashboard remains usable.
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void refreshFarm(); }, 250);
    };
    const unsubscribeData = subscribeToAppEvent(DATA_CHANGED_EVENT, onDataChanged);
    const unsubscribeSections = subscribeToAppEvent(SECTIONS_CHANGED_EVENT, onDataChanged);
    return () => {
      unsubscribeData();
      unsubscribeSections();
      if (timer) clearTimeout(timer);
    };
  }, [offlineMode, refreshFarm]);

  useEffect(() => {
    let unsubscribe = () => {};
    async function init() {
      // Login and the OAuth callback do not need farm data. Avoid duplicate
      // auth/API requests there and keep the login screen independent of DB health.
      if (pathname === "/login" || pathname.startsWith("/auth")) {
        setLoading(false);
        return;
      }

      // finally-guarded so a thrown error (misconfigured env, network down)
      // can't strand every page on the loading state.
      try {
        const { getSupabaseBrowser } = await import("@/lib/supabase");
        const supabase = getSupabaseBrowser();
        const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
          // A voluntary logout is not an expired session. Expiration detected
          // by an API 401 already goes through handleAuthExpired, which keeps
          // the more helpful session-expired message.
          if (event === "SIGNED_OUT") {
            clearAuthenticatedShellCache();
            window.location.href = "/login";
          }
        });
        unsubscribe = () => authListener.subscription.unsubscribe();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          userIdRef.current = user.id;
          setUserId(user.id);
          if (user.email) setUserEmail(user.email);
          hydrateOfflineSnapshot(user.id);
        }
        await refreshFarm();
      } catch { setError("No se pudo inicializar la sesión del campo."); }
      finally { setLoading(false); }
    }
    init();
    return () => unsubscribe();
  }, [pathname, hydrateOfflineSnapshot, refreshFarm]);

  return (
    <FarmContext.Provider value={{ farm, sections, loading, noFarm, userId, error, userEmail, alerts, alertsLoaded, alertsError, alertsTruncated, sectionsTruncated, sectionsError, offlineMode, isOnline, readOnly: offlineMode || !isOnline, lastSyncedAt, offlineSyncWarnings, offlineSnapshotStale, clearOfflineSnapshotStale, refreshFarm, refreshSections, refreshAlerts, setFarm, setNoFarm }}>
      {children}
    </FarmContext.Provider>
  );
}
