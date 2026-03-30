"use client";

import { SubTabBar } from "@/components/SubTabBar";
import { Package, DollarSign, BarChart3, ClipboardList } from "lucide-react";

export default function GestionLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: "/gestion/inventario", label: "Inventario", icon: Package },
    { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
    { href: "/gestion/metricas", label: "Metricas", icon: BarChart3 },
    { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
  ];
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <SubTabBar tabs={tabs} />
      {children}
    </main>
  );
}
