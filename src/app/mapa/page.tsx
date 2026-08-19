"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/PageHeader";
import { CampoAIButton } from "@/components/CampoAIButton";
import { useFarm } from "@/contexts/FarmContext";
import { Skeleton } from "@/components/ui/skeleton";

const FarmMap = dynamic(() => import("@/components/FarmMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[70dvh] w-full rounded-xl" />,
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
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <PageHeader
        title="Mapa"
        description="Visualiza y gestiona los padrones y secciones de tu campo"
        actions={(
          <CampoAIButton
            title="Mapa del campo"
            facts={mapFacts}
            partial={sectionsTruncated}
            instruction="Ayudame a interpretar el mapa, ubicar padrones o infraestructura y relacionarlo con las secciones. Si propongo guardar algo, pedime confirmación antes de hacerlo."
          />
        )}
      />
      <Suspense fallback={<Skeleton className="h-[70dvh] w-full rounded-xl" />}><FarmMap /></Suspense>
    </main>
  );
}
