"use client";

import { useEffect, useState } from "react";
import { weatherCodeLabel, sprayAdvice } from "@/lib/weather";
import { fetchWithTimeout } from "@/lib/fetch";
import { FARM_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { isOfflineSnapshotFresh, OFFLINE_WEATHER_MAX_AGE_MS, offlineWeatherSnapshotKey, parseOfflineWeatherSnapshot } from "@/lib/offline";
import { useFarm } from "@/contexts/FarmContext";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { RefreshCw, Wind, Droplets, SprayCan } from "lucide-react";

interface Daily { date: string; tmax: number; tmin: number; precip: number; code: number }
interface Weather {
  available: boolean;
  reason?: string;
  place?: { name: string; admin: string };
  current?: { temp: number; wind: number; precip: number; code: number };
  daily?: Daily[];
}

const dayName = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");

export function WeatherPanel() {
  const { farm, offlineMode, isOnline, userId } = useFarm();
  const readOnly = offlineMode || !isOnline;
  const [w, setW] = useState<Weather | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (readOnly) {
      const timer = window.setTimeout(() => {
        if (!active) return;
        let cached = null;
        try {
          cached = userId
            ? parseOfflineWeatherSnapshot(window.localStorage.getItem(offlineWeatherSnapshotKey(userId)))
            : null;
        } catch {
          cached = null;
        }
        if (cached
          && cached.farmId === farm?.id
          && cached.location === (farm?.location ?? null)
          && isOfflineSnapshotFresh(cached.savedAt, Date.now(), OFFLINE_WEATHER_MAX_AGE_MS)) {
          setW(cached.data as Weather);
          setSavedAt(cached.savedAt);
        } else {
          setW({ available: false, reason: "offline_unavailable" });
          setSavedAt(null);
        }
      }, 0);
      return () => { active = false; window.clearTimeout(timer); };
    }
    fetchWithTimeout("/api/weather", {}, 10000)
      .then((r) => (r.ok ? r.json() : { available: false, reason: "fetch_failed" }))
      .then((d) => {
        if (!active) return;
        setSavedAt(null);
        setW(d);
        if (d?.available && d?.current && userId && farm?.id) {
          const nextSavedAt = new Date().toISOString();
          setSavedAt(nextSavedAt);
          try {
            window.localStorage.setItem(offlineWeatherSnapshotKey(userId), JSON.stringify({
              data: d,
              farmId: farm?.id,
              location: farm?.location ?? null,
              savedAt: nextSavedAt,
            }));
          } catch {
            // Private browsing and storage limits must not block online weather.
          }
        }
      })
      .catch(() => active && setW({ available: false }));
    return () => { active = false; };
  }, [attempt, farm?.id, farm?.location, readOnly, userId]);

  useEffect(() => {
    const onFarmChanged = () => setAttempt((n) => n + 1);
    return subscribeToAppEvent(FARM_CHANGED_EVENT, onFarmChanged);
  }, []);

  useOfflineSnapshotRefresh(() => setAttempt((n) => n + 1), userId, readOnly);

  if (w === null) {
    return <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Cargando clima…</div>;
  }
  if (!w.available || !w.current) {
    if (w.reason === "offline_unavailable") {
      return (
        <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          No hay una copia reciente del clima. Recuperá la conexión para actualizarlo.
        </div>
      );
    }
    if (w.reason === "no_location") {
      return (
        <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Agregá la ubicación de tu campo para ver el clima y consejos de pulverización.
        </div>
      );
    }
    return (
      <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground flex items-center justify-between gap-3">
        <span>No se pudo cargar el clima en este momento.</span>
        <button onClick={() => { setW(null); setAttempt((n) => n + 1); }} disabled={readOnly} className="inline-flex items-center gap-1.5 hover:text-foreground disabled:opacity-50">
          <RefreshCw className="h-3.5 w-3.5" /> Reintentar
        </button>
      </div>
    );
  }

  const cur = weatherCodeLabel(w.current.code);
  const spray = sprayAdvice(w.current.wind, w.current.precip);

  return (
    <div className="mb-8 rounded-xl border border-border bg-card p-5">
      {readOnly && savedAt && <p role="status" className="mb-3 text-xs text-amber-700 dark:text-amber-400">Mostrando clima guardado el {new Date(savedAt).toLocaleString("es-UY")}. Actualizalo al recuperar la conexión.</p>}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-4xl leading-none">{cur.emoji}</span>
          <div>
            <p className="text-2xl font-semibold leading-tight">{Math.round(w.current.temp)}°C</p>
            <p className="text-sm text-muted-foreground">{cur.label} · {w.place?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5"><Wind className="h-4 w-4" /> {Math.round(w.current.wind)} km/h</span>
          <span className="flex items-center gap-1.5"><Droplets className="h-4 w-4" /> {w.current.precip} mm</span>
        </div>
      </div>

      <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
        spray.ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}>
        <SprayCan className="h-4 w-4 shrink-0" />
        <span><strong>{spray.ok ? "Apto para pulverizar" : "No pulverizar"}</strong> — {spray.reason}</span>
      </div>

      {w.daily && w.daily.length > 0 && (
        <div className="mt-4 grid grid-cols-7 gap-1 text-center">
          {w.daily.slice(0, 7).map((d) => {
            const wc = weatherCodeLabel(d.code);
            return (
              <div key={d.date} className="rounded-lg py-2">
                <p className="text-[11px] text-muted-foreground capitalize">{dayName(d.date)}</p>
                <p className="text-lg leading-tight" title={wc.label}>{wc.emoji}</p>
                <p className="text-xs tabular-nums">{Math.round(d.tmax)}°<span className="text-muted-foreground">/{Math.round(d.tmin)}°</span></p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
