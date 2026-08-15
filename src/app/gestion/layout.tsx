"use client";

import { SubTabBar } from "@/components/SubTabBar";
import { Package, DollarSign, BarChart3, ClipboardList, ClipboardCheck, CalendarDays, Settings } from "lucide-react";

export default function GestionLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: "/gestion/inventario", label: "Inventario", icon: Package },
    { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
    { href: "/gestion/metricas", label: "Metricas", icon: BarChart3 },
    { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
    { href: "/gestion/agenda", label: "Agenda", icon: CalendarDays },
    { href: "/gestion/tareas", label: "Tareas", icon: ClipboardCheck },
    { href: "/gestion/campo", label: "Mi campo", icon: Settings },
  ];
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <SubTabBar tabs={tabs} />
      {children}
    </main>
  );
}
