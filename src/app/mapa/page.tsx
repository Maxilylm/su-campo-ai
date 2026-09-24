"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { CampoAIButton } from "@/components/CampoAIButton";
import { useFarm } from "@/contexts/FarmContext";
import { Skeleton } from "@/components/ui/skeleton";

const mapFallback = <Skeleton className="h-[62dvh] min-h-[22rem] w-full rounded-none lg:h-auto lg:flex-1" />;

const FarmMap = dynamic(() => import("@/components/FarmMap"), {
  ssr: false,
  loading: () => mapFallback,
});

export default function MapaPage() {
  const { farm, sections, sectionsTruncated } = useFarm();
  const mapFacts = [
    `Campo: ${farm?.name || "sin nombre"}`,
    `Ubicación: ${farm?.location || "no indicada"}`,
    `Secciones visibles: ${sections.length}${sectionsTruncated ? "+" : ""}`,
    ...sections.slice(0, 30).map((section) =>
      `${section.name}: ${section.size_hectares ?? "?"} ha${section.padron_id ? `, padrón ${section.padron_id}` : ""}`
    ),
  ];

  return (
    // Full-bleed: on desktop the map fills the viewport and the side panel scrolls on its own.
    <main className="flex w-full flex-1 flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 pt-6 sm:px-6 lg:pt-7">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold leading-tight">Mapa</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">Padrones, potreros e infraestructura del campo. Buscá un padrón o dibujá sobre la imagen satelital.</p>
        </div>
        <CampoAIButton
          title="Mapa del campo"
          facts={mapFacts}
          partial={sectionsTruncated}
          instruction="Ayudame a interpretar el mapa, ubicar padrones o infraestructura y relacionarlo con las secciones. Si propongo guardar algo, pedime confirmación antes de hacerlo."
        />
      </div>
      <Suspense fallback={mapFallback}><FarmMap /></Suspense>
    </main>
  );
}
