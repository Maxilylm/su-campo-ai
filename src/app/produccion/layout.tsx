"use client";

import { SubTabBar } from "@/components/SubTabBar";
import { useFarm } from "@/contexts/FarmContext";
import { Beef, Syringe, Wheat } from "lucide-react";

export default function ProduccionLayout({ children }: { children: React.ReactNode }) {
  const { farm } = useFarm();
  const opType = farm?.operation_type || "livestock";
  const showLivestock = opType === "livestock" || opType === "mixed";
  const showCrops = opType === "crops" || opType === "mixed";
  const tabs = [
    ...(showLivestock ? [{ href: "/produccion/hacienda", label: "Hacienda", icon: Beef }] : []),
    ...(showLivestock ? [{ href: "/produccion/sanidad", label: "Sanidad", icon: Syringe }] : []),
    ...(showCrops ? [{ href: "/produccion/agricultura", label: "Agricultura", icon: Wheat }] : []),
  ];
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <SubTabBar tabs={tabs} />
      {children}
    </main>
  );
}
