"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import type { Alert } from "@/lib/alerts";

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
  userEmail: string;
  alerts: Alert[];
  alertsLoaded: boolean;
  refreshFarm: () => Promise<void>;
  refreshSections: () => Promise<void>;
  refreshAlerts: () => Promise<void>;
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
  const [farm, setFarm] = useState<Farm | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [noFarm, setNoFarm] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);

  const refreshSections = useCallback(async () => {
    const res = await fetch("/api/sections");
    if (res.ok) setSections(await res.json());
  }, []);

  // Single source of truth for alerts — shared by the NavBar badge and the
  // home AlertsPanel so the page only fetches /api/alerts once.
  const refreshAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) { const d = await res.json(); setAlerts(d.alerts || []); }
    } catch { /* keep prior alerts */ }
    finally { setAlertsLoaded(true); }
  }, []);

  const refreshFarm = useCallback(async () => {
    const res = await fetch("/api/farm");
    if (res.ok) {
      const { farm: f } = await res.json();
      if (f) { setFarm(f); setNoFarm(false); await refreshSections(); await refreshAlerts(); }
      else { setNoFarm(true); }
    }
  }, [refreshSections, refreshAlerts]);

  useEffect(() => {
    async function init() {
      const { getSupabaseBrowser } = await import("@/lib/supabase");
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);
      await refreshFarm();
      setLoading(false);
    }
    init();
  }, [refreshFarm]);

  return (
    <FarmContext.Provider value={{ farm, sections, loading, noFarm, userEmail, alerts, alertsLoaded, refreshFarm, refreshSections, refreshAlerts, setFarm, setNoFarm }}>
      {children}
    </FarmContext.Provider>
  );
}
