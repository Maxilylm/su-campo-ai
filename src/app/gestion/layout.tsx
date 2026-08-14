"use client";

import { SubTabBar } from "@/components/SubTabBar";
import { CalendarDays, Package, DollarSign, BarChart3, ClipboardList, ClipboardCheck } from "lucide-react";

export default function GestionLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: "/gestion/agenda", label: "Agenda", icon: CalendarDays },
    { href: "/gestion/inventario", label: "Inventario", icon: Package },
    { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
    { href: "/gestion/metricas", label: "Metricas", icon: BarChart3 },
    { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
    { href: "/gestion/tareas", label: "Tareas", icon: ClipboardCheck },
  ];
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <SubTabBar tabs={tabs} />
      {children}
    </main>
  );
}
