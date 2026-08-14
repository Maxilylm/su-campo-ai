"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Alert } from "@/lib/alerts";
import { isOfflineSnapshotFresh, offlineSnapshotKey, parseOfflineSnapshot, type FarmOfflineSnapshot } from "@/lib/offline";

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
  error: string | null;
  userEmail: string;
  alerts: Alert[];
  alertsLoaded: boolean;
  alertsError: string | null;
  offlineMode: boolean;
  isOnline: boolean;
  lastSyncedAt: string | null;
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
  const [userEmail, setUserEmail] = useState("");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const alertsRef = useRef<Alert[]>([]);
  const alertsErrorRef = useRef(false);

  const setAlertsSafely = useCallback((next: Alert[]) => {
    alertsRef.current = next;
    setAlerts(next);
  }, []);

  const refreshSections = useCallback(async () => {
    const res = await fetch("/api/sections");
    if (!res.ok) throw new Error("No se pudieron cargar las secciones.");
    const nextSections = await res.json();
    setSections(nextSections);
    return nextSections as Section[];
  }, []);

  // Single source of truth for alerts — shared by the NavBar badge and the
  // home AlertsPanel so the page only fetches /api/alerts once.
  const refreshAlerts = useCallback(async () => {
    alertsErrorRef.current = false;
    setAlertsError(null);
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) throw new Error("alerts request failed");
      const d = await res.json();
      const nextAlerts = d.alerts || [];
      setAlertsSafely(nextAlerts);
      return nextAlerts as Alert[];
    } catch {
      alertsErrorRef.current = true;
      setAlertsError("No se pudieron actualizar los pendientes.");
    }
    finally { setAlertsLoaded(true); }
    return alertsRef.current;
  }, [setAlertsSafely]);

  const hydrateOfflineSnapshot = useCallback((userId: string) => {
    try {
      const snapshot = parseOfflineSnapshot(window.localStorage.getItem(offlineSnapshotKey(userId)));
      if (!snapshot || !isOfflineSnapshotFresh(snapshot.savedAt)) return;
      setFarm(snapshot.farm);
      setSections(snapshot.sections);
      setAlertsSafely(snapshot.alerts);
      setAlertsLoaded(true);
      alertsErrorRef.current = false;
      setAlertsError(null);
      setLastSyncedAt(snapshot.savedAt);
    } catch {
      // Private browsing and storage restrictions should never block login.
    }
  }, [setAlertsSafely]);

  const saveOfflineSnapshot = useCallback((snapshot: FarmOfflineSnapshot) => {
    const userId = userIdRef.current;
    if (!userId) return;
    try {
      window.localStorage.setItem(offlineSnapshotKey(userId), JSON.stringify(snapshot));
    } catch {
      // Storage is an enhancement; the online flow remains fully usable.
    }
  }, []);

  const refreshFarm = useCallback(async () => {
    try {
      const res = await fetch("/api/farm");
      if (!res.ok) throw new Error("No se pudo cargar el campo.");
      const { farm: f } = await res.json();
      if (f) {
        setFarm(f);
        setNoFarm(false);
        const nextSections = await refreshSections();
        const nextAlerts = await refreshAlerts();
        const savedAt = new Date().toISOString();
        if (!alertsErrorRef.current) {
          saveOfflineSnapshot({ farm: f, sections: nextSections, alerts: nextAlerts, savedAt });
        }
        setLastSyncedAt(savedAt);
        setOfflineMode(false);
        setError(null);
      } else {
        setNoFarm(true);
        setError(null);
      }
    } catch (e) {
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
        setAlertsSafely(snapshot.alerts);
        setAlertsLoaded(true);
        alertsErrorRef.current = false;
        setAlertsError(null);
        setLastSyncedAt(snapshot.savedAt);
        setOfflineMode(true);
        setNoFarm(false);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : "No se pudo cargar el campo.");
      }
    }
  }, [refreshSections, refreshAlerts, saveOfflineSnapshot, setAlertsSafely]);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (isOnline && offlineMode && userIdRef.current) void refreshFarm();
  }, [isOnline, offlineMode, refreshFarm]);

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
          if (event === "SIGNED_OUT") window.location.href = "/login?error=session_expired";
        });
        unsubscribe = () => authListener.subscription.unsubscribe();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          userIdRef.current = user.id;
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
    <FarmContext.Provider value={{ farm, sections, loading, noFarm, error, userEmail, alerts, alertsLoaded, alertsError, offlineMode, isOnline, lastSyncedAt, refreshFarm, refreshSections, refreshAlerts, setFarm, setNoFarm }}>
      {children}
    </FarmContext.Provider>
  );
}
