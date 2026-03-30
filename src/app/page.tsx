"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";

export default function InicioPage() {
  const { farm, sections, loading, noFarm } = useFarm();
  const router = useRouter();

  useEffect(() => {
    if (!loading && noFarm) router.push("/setup");
  }, [loading, noFarm, router]);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🌿</div>
          <div className="text-zinc-400 text-sm">Cargando CampoAI...</div>
        </div>
      </main>
    );
  }

  if (!farm) return null;

  // sections may have cattle embedded from API
  const allCattle = sections.flatMap((s: any) => s.cattle || []);
  const totalCattle = allCattle.reduce((sum: number, c: any) => sum + c.count, 0);
  const totalHectares = sections.reduce((sum, s) => sum + (s.size_hectares || 0), 0);

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      <h2 className="text-xl font-bold mb-4">Resumen</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Cabezas" value={totalCattle} accent="emerald" />
        <StatCard label="Secciones" value={sections.length} accent="blue" />
        <StatCard label="Hectáreas" value={totalHectares} accent="amber" />
        <StatCard label="Tipo" value={farm.operation_type === "livestock" ? "Ganadería" : farm.operation_type === "crops" ? "Agricultura" : "Mixto"} accent="purple" />
      </div>
      {sections.length === 0 ? (
        <EmptyState icon="🏕️" message="Agregá tu primera sección en Producción → Hacienda" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sections.map((s) => {
            const sectionCattle = (s as any).cattle || [];
            const headCount = sectionCattle.reduce((sum: number, c: any) => sum + c.count, 0);
            return (
              <div key={s.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="font-semibold text-sm">{s.name}</span>
                  <span className="text-zinc-500 text-xs ml-auto">{s.size_hectares || "?"} ha</span>
                </div>
                <div className="text-xs text-zinc-400">
                  {headCount} cabezas · Agua: {s.water_status} · Pasto: {s.pasture_status}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
