"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Home, Beef, Syringe, Wheat, Package, DollarSign, BarChart3, CalendarDays,
  ClipboardList, Map, MessageSquare, MapPin, Printer, Scale,
} from "lucide-react";

const NAV: { href: string; label: string; icon: typeof Home; op?: "livestock" | "crops" }[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/produccion/hacienda", label: "Hacienda", icon: Beef, op: "livestock" },
  { href: "/produccion/sanidad", label: "Sanidad", icon: Syringe, op: "livestock" },
  { href: "/produccion/peso", label: "Pesajes", icon: Scale, op: "livestock" },
  { href: "/produccion/agricultura", label: "Agricultura", icon: Wheat, op: "crops" },
  { href: "/gestion/agenda", label: "Agenda", icon: CalendarDays },
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
  const { farm } = useFarm();
  const opType = farm?.operation_type;
  // Mirror the nav: show livestock/crops destinations only when relevant.
  const navItems = NAV.filter((n) =>
    !n.op || opType === "mixed" || !opType || n.op === opType
  );
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<NamedRow[]>([]);
  const [inventory, setInventory] = useState<NamedRow[]>([]);
  const [crops, setCrops] = useState<NamedRow[]>([]);

  // ⌘K / Ctrl+K toggles the palette; a custom event opens it (for the
  // on-screen search buttons, since the shortcut is desktop/keyboard-only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("campoai:open-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("campoai:open-palette", onOpen);
    };
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

  // The React Compiler memoizes this automatically; no manual useCallback needed.
  const go = (href: string) => { setOpen(false); router.push(href); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Buscar" description="Buscá secciones, inventario, cultivos o navegá">
      <CommandInput placeholder="Buscar o navegar… (⌘K)" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        <CommandGroup heading="Ir a">
          {navItems.map((n) => (
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
