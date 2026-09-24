"use client";

import { SubTabBar } from "@/components/SubTabBar";
import { CalendarCheck, Package, DollarSign, BarChart3, ClipboardList, ClipboardCheck, CalendarDays, Settings } from "lucide-react";

export default function GestionLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: "/gestion/plan", label: "Plan del día", icon: CalendarCheck },
    { href: "/gestion/inventario", label: "Inventario", icon: Package },
    { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
    { href: "/gestion/metricas", label: "Métricas", icon: BarChart3 },
    { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
    { href: "/gestion/agenda", label: "Agenda", icon: CalendarDays },
    { href: "/gestion/tareas", label: "Tareas", icon: ClipboardCheck },
    { href: "/gestion/campo", label: "Mi campo", icon: Settings },
  ];
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
      {/* The sidebar lists these pages on desktop; the tabs serve phones. */}
      <SubTabBar tabs={tabs} className="lg:hidden" />
      {children}
    </main>
  );
}
