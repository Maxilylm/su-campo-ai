"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { getSupabaseBrowser } from "@/lib/supabase";

const OP_LABELS: Record<string, string> = {
  livestock: "🐄 Ganadería",
  crops: "🌾 Agricultura",
  mixed: "🐄🌾 Mixto",
};

export function NavBar() {
  const { farm, userEmail, refreshFarm, setFarm, setNoFarm } = useFarm();
  const pathname = usePathname();
  const router = useRouter();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  if (!farm) return null;

  const opType = farm.operation_type;
  const showLivestock = opType === "livestock" || opType === "mixed";
  const showCrops = opType === "crops" || opType === "mixed";

  const produccionItems = [
    ...(showLivestock ? [{ href: "/produccion/hacienda", label: "🐄 Hacienda" }] : []),
    ...(showLivestock ? [{ href: "/produccion/sanidad", label: "💉 Sanidad" }] : []),
    ...(showCrops ? [{ href: "/produccion/agricultura", label: "🌾 Agricultura" }] : []),
  ];

  const gestionItems = [
    { href: "/gestion/inventario", label: "📦 Inventario" },
    { href: "/gestion/finanzas", label: "💰 Finanzas" },
    { href: "/gestion/metricas", label: "📊 Métricas" },
    { href: "/gestion/registro", label: "📋 Registro" },
  ];

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href));
  const isGroupActive = (items: { href: string }[]) => items.some((i) => isActive(i.href));

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function NavLink({ href, label }: { href: string; label: string }) {
    return (
      <button
        onClick={() => { router.push(href); setOpenDropdown(null); }}
        className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
          isActive(href) ? "bg-emerald-600 text-white font-semibold" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        }`}
      >
        {label}
      </button>
    );
  }

  function Dropdown({ name, items }: { name: string; items: { href: string; label: string }[] }) {
    const active = isGroupActive(items);
    return (
      <div className="relative" onMouseEnter={() => setOpenDropdown(name)} onMouseLeave={() => setOpenDropdown(null)}>
        <button className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
          active ? "bg-emerald-600/20 text-emerald-400 font-semibold" : "text-zinc-400 hover:text-zinc-100"
        }`}>
          {name} ▾
        </button>
        {openDropdown === name && (
          <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg p-1 min-w-[180px] shadow-xl z-50">
            {items.map((item) => (
              <button key={item.href} onClick={() => { router.push(item.href); setOpenDropdown(null); }}
                className={`block w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive(item.href) ? "bg-emerald-600/10 text-emerald-400" : "text-zinc-300 hover:bg-zinc-700"
                }`}>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Desktop */}
      <nav className="hidden sm:flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/")} className="text-emerald-400 font-bold text-lg">🌿 CampoAI</button>
          <div className="flex items-center gap-1">
            <NavLink href="/" label="Inicio" />
            <Dropdown name="Producción" items={produccionItems} />
            <Dropdown name="Gestión" items={gestionItems} />
            <NavLink href="/mapa" label="Mapa" />
            <NavLink href="/chat" label="Chat AI" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs truncate max-w-[150px]">{farm.name}</span>
          <span className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded text-xs">{OP_LABELS[opType]}</span>
          <button onClick={refreshFarm} className="text-zinc-500 hover:text-zinc-300 text-xs">↻</button>
          <button onClick={handleLogout} className="text-zinc-500 hover:text-zinc-300 text-xs">Salir</button>
        </div>
      </nav>

      {/* Mobile bottom bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800 flex justify-around py-2 z-50">
        {[
          { href: "/", icon: "🏠", label: "Inicio" },
          { href: produccionItems[0]?.href || "/produccion/hacienda", icon: "🐄", label: "Producción" },
          { href: "/gestion/inventario", icon: "📊", label: "Gestión" },
          { href: "/mapa", icon: "🗺️", label: "Mapa" },
          { href: "/chat", icon: "💬", label: "Chat" },
        ].map((item) => (
          <button key={item.href} onClick={() => router.push(item.href)}
            className={`flex flex-col items-center gap-0.5 text-xs ${isActive(item.href) ? "text-emerald-400" : "text-zinc-500"}`}>
            <span className="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
