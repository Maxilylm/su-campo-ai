"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { AlertsPanel } from "@/components/AlertsPanel";
import { WeatherPanel } from "@/components/WeatherPanel";
import { InsightsCard } from "@/components/InsightsCard";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Beef, LayoutGrid, Ruler, Tractor, MapPin, WifiOff } from "lucide-react";
import type { Section } from "@/contexts/FarmContext";

type CattleLite = { count: number };
type SectionWithCattle = Section & { cattle?: CattleLite[] };

export default function InicioPage() {
  const { farm, sections, loading, noFarm, error, userEmail, offlineMode, lastSyncedAt } = useFarm();
  const router = useRouter();

  useEffect(() => {
    if (!loading && noFarm) router.push("/setup");
  }, [loading, noFarm, router]);

  if (loading) return <LoadingPage />;
  if (error) {
    return (
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-12">
        <EmptyState
          icon={AlertTriangle}
          title="No se pudo cargar el campo"
          description={error}
          actionLabel="Reintentar"
          onAction={() => window.location.reload()}
        />
      </main>
    );
  }
  if (!farm) return null;

  const allCattle = (sections as SectionWithCattle[]).flatMap((s) => s.cattle || []);
  const totalCattle = allCattle.reduce((sum, c) => sum + c.count, 0);
  const totalHectares = sections.reduce((sum, s) => sum + (s.size_hectares || 0), 0);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Buenos dias";
    if (hour < 18) return "Buenas tardes";
    return "Buenas noches";
  })();

  const displayName = userEmail ? userEmail.split("@")[0] : "";

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <PageHeader
        title={`${greeting}${displayName ? `, ${displayName}` : ""}`}
        description={`${farm.name} — ${new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}`}
      />

      {offlineMode && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Modo lectura sin conexión</p>
            <p className="text-xs opacity-80">
              Mostrando los últimos datos sincronizados{lastSyncedAt ? ` el ${new Date(lastSyncedAt).toLocaleString("es-UY")}` : ""}. Los cambios se habilitan al recuperar la conexión.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Cabezas" value={totalCattle} accent="emerald" icon={Beef} />
        <StatCard label="Secciones" value={sections.length} accent="blue" icon={LayoutGrid} />
        <StatCard label="Hectareas" value={totalHectares} accent="amber" icon={Ruler} />
        <StatCard
          label="Operacion"
          value={farm.operation_type === "livestock" ? "Ganaderia" : farm.operation_type === "crops" ? "Agricultura" : "Mixto"}
          accent="purple"
          icon={Tractor}
        />
      </div>

      <InsightsCard />
      <AlertsPanel />
      <WeatherPanel />

      {sections.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Sin secciones"
          description="Agrega tu primera seccion en Produccion → Hacienda para empezar."
          actionLabel="Ir a Hacienda"
          onAction={() => router.push("/produccion/hacienda")}
        />
      ) : (
        <div>
          <h2 className="text-lg font-medium mb-4">Secciones</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sections.map((s) => {
              const sectionCattle = (s as SectionWithCattle).cattle || [];
              const headCount = sectionCattle.reduce((sum, c) => sum + c.count, 0);
              return (
                <div key={s.id} className="rounded-xl border border-border bg-card p-5 flex gap-4" style={{ borderLeftWidth: 4, borderLeftColor: s.color }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground text-xs">{s.size_hectares || "?"} ha</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold tabular-nums">{headCount} cabezas</span>
                      <Badge variant="outline">{s.water_status}</Badge>
                      <Badge variant="outline">{s.pasture_status}</Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
