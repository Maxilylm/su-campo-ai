"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/PageHeader";

const FarmMap = dynamic(() => import("@/components/FarmMap"), { ssr: false });

export default function MapaPage() {
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <PageHeader title="Mapa" description="Visualiza y gestiona los padrones y secciones de tu campo" />
      <FarmMap />
    </main>
  );
}
