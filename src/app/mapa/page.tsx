"use client";

import dynamic from "next/dynamic";

const FarmMap = dynamic(() => import("@/components/FarmMap"), { ssr: false });

export default function MapaPage() {
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      <FarmMap />
    </main>
  );
}
