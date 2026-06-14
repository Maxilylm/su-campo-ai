"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Home, Beef, Syringe, Wheat, Package, DollarSign, BarChart3,
  ClipboardList, Map, MessageSquare, MapPin, Printer,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/produccion/hacienda", label: "Hacienda", icon: Beef },
  { href: "/produccion/sanidad", label: "Sanidad", icon: Syringe },
  { href: "/produccion/agricultura", label: "Agricultura", icon: Wheat },
  { href: "/gestion/inventario", label: "Inventario", icon: Package },
  { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
  { href: "/gestion/metricas", label: "Métricas", icon: BarChart3 },
  { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
  { href: "/reportes", label: "Reportes", icon: Printer },
  { href: "/mapa", label: "Mapa", icon: Map },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

interface NamedRow { id: string; name?: string; crop_type?: string }

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<NamedRow[]>([]);
  const [inventory, setInventory] = useState<NamedRow[]>([]);
  const [crops, setCrops] = useState<NamedRow[]>([]);

  // ⌘K / Ctrl+K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Lazy-load searchable entities the first time the palette opens.
  useEffect(() => {
    if (!open || sections.length || inventory.length || crops.length) return;
    const grab = (url: string, set: (r: NamedRow[]) => void) =>
      fetch(url).then((r) => (r.ok ? r.json() : [])).then((d) => set(Array.isArray(d) ? d : [])).catch(() => {});
    grab("/api/sections", setSections);
    grab("/api/inventory", setInventory);
    grab("/api/crops", setCrops);
  }, [open, sections.length, inventory.length, crops.length]);

  const go = useCallback((href: string) => { setOpen(false); router.push(href); }, [router]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Buscar" description="Buscá secciones, inventario, cultivos o navegá">
      <CommandInput placeholder="Buscar o navegar… (⌘K)" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        <CommandGroup heading="Ir a">
          {NAV.map((n) => (
            <CommandItem key={n.href} value={`ir ${n.label}`} onSelect={() => go(n.href)}>
              <n.icon className="mr-2 h-4 w-4" /> {n.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {sections.length > 0 && (
          <CommandGroup heading="Secciones">
            {sections.map((s) => (
              <CommandItem key={s.id} value={`seccion ${s.name}`} onSelect={() => go("/produccion/hacienda")}>
                <MapPin className="mr-2 h-4 w-4" /> {s.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {inventory.length > 0 && (
          <CommandGroup heading="Inventario">
            {inventory.map((i) => (
              <CommandItem key={i.id} value={`inventario ${i.name}`} onSelect={() => go("/gestion/inventario")}>
                <Package className="mr-2 h-4 w-4" /> {i.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {crops.length > 0 && (
          <CommandGroup heading="Cultivos">
            {crops.map((c) => (
              <CommandItem key={c.id} value={`cultivo ${c.crop_type}`} onSelect={() => go("/produccion/agricultura")}>
                <Wheat className="mr-2 h-4 w-4" /> {c.crop_type}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
