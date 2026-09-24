"use client";

import { SubTabBar } from "@/components/SubTabBar";
import { useFarm } from "@/contexts/FarmContext";
import { Beef, Syringe, Wheat, Scale } from "lucide-react";

export default function ProduccionLayout({ children }: { children: React.ReactNode }) {
  const { farm } = useFarm();
  const opType = farm?.operation_type || "livestock";
  const showLivestock = opType === "livestock" || opType === "mixed";
  const showCrops = opType === "crops" || opType === "mixed";
  const tabs = [
    ...(showLivestock ? [{ href: "/produccion/hacienda", label: "Hacienda", icon: Beef }] : []),
    ...(showLivestock ? [{ href: "/produccion/sanidad", label: "Sanidad", icon: Syringe }] : []),
    ...(showLivestock ? [{ href: "/produccion/peso", label: "Pesajes", icon: Scale }] : []),
    ...(showCrops ? [{ href: "/produccion/agricultura", label: "Agricultura", icon: Wheat }] : []),
  ];
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
      {/* The sidebar lists these pages on desktop; the tabs serve phones. */}
      <SubTabBar tabs={tabs} className="lg:hidden" />
      {children}
    </main>
  );
}
