"use client";

import { SubTabBar } from "@/components/SubTabBar";

export default function GestionLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: "/gestion/inventario", label: "📦 Inventario" },
    { href: "/gestion/finanzas", label: "💰 Finanzas" },
    { href: "/gestion/metricas", label: "📊 Métricas" },
    { href: "/gestion/registro", label: "📋 Registro" },
  ];
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      <SubTabBar tabs={tabs} />
      {children}
    </main>
  );
}
