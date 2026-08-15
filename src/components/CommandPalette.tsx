"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Home, Beef, Syringe, Wheat, Package, DollarSign, BarChart3,
  ClipboardList, ClipboardCheck, CalendarDays, Map, MessageSquare, MapPin, Printer, Scale, Bell, Settings, Stethoscope,
} from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { isOfflineSnapshotFresh, mergeOfflineEntitySnapshot, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";

const NAV: { href: string; label: string; icon: typeof Home; op?: "livestock" | "crops" }[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/pendientes", label: "Pendientes", icon: Bell },
  { href: "/produccion/hacienda", label: "Hacienda", icon: Beef, op: "livestock" },
  { href: "/produccion/sanidad", label: "Sanidad", icon: Syringe, op: "livestock" },
  { href: "/produccion/peso", label: "Pesajes", icon: Scale, op: "livestock" },
  { href: "/produccion/agricultura", label: "Agricultura", icon: Wheat, op: "crops" },
  { href: "/gestion/inventario", label: "Inventario", icon: Package },
  { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
  { href: "/gestion/metricas", label: "Métricas", icon: BarChart3 },
  { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
  { href: "/gestion/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/gestion/tareas", label: "Tareas", icon: ClipboardCheck },
  { href: "/gestion/campo", label: "Mi campo", icon: Settings },
  { href: "/reportes", label: "Reportes", icon: Printer },
  { href: "/mapa", label: "Mapa", icon: Map },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

interface NamedRow {
  id: string;
  name?: string;
  title?: string;
  crop_type?: string;
  category?: string;
  vaccine_name?: string;
  type?: string;
  description?: string;
  breed?: string | null;
  count?: number;
  due_date?: string | null;
  next_due?: string | null;
  priority?: string;
  status?: string;
  resolved?: boolean | null;
  section_id?: string | null;
  sections?: { name: string } | null;
}

export function CommandPalette() {
  const router = useRouter();
  const { farm, userId, offlineMode, isOnline } = useFarm();
  const readOnly = offlineMode || !isOnline;
  const opType = farm?.operation_type;
  const showLivestock = !opType || opType === "livestock" || opType === "mixed";
  const showCrops = !opType || opType === "crops" || opType === "mixed";
  // Mirror the nav: show livestock/crops destinations only when relevant.
  const navItems = NAV.filter((n) =>
    !n.op || opType === "mixed" || !opType || n.op === opType
  );
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<NamedRow[]>([]);
  const [inventory, setInventory] = useState<NamedRow[]>([]);
  const [crops, setCrops] = useState<NamedRow[]>([]);
  const [cattle, setCattle] = useState<NamedRow[]>([]);
  const [tasks, setTasks] = useState<NamedRow[]>([]);
  const [healthEvents, setHealthEvents] = useState<NamedRow[]>([]);
  const [vaccinations, setVaccinations] = useState<NamedRow[]>([]);
  const [entitiesLoaded, setEntitiesLoaded] = useState(false);
  const [entitiesCached, setEntitiesCached] = useState(false);

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

  // Mutations can happen from another page while the palette stays mounted in
  // the shared NavBar. Invalidate the lazy index so a later search never
  // presents an entity that was deleted or hides one that was just created.
  useEffect(() => {
    const invalidateEntities = () => {
      setEntitiesLoaded(false);
      setEntitiesCached(false);
    };
    return subscribeToAppEvent(DATA_CHANGED_EVENT, invalidateEntities);
  }, []);

  // Rehydrate the local entity index after a reload while offline. The async
  // boundary keeps storage work out of the render path and leaves navigation
  // available even when no searchable snapshot exists yet.
  useEffect(() => {
    if (!open || entitiesLoaded || !readOnly || !userId) return;
    let active = true;
    const hydrate = async () => {
      await Promise.resolve();
      let cached = null;
      try {
        cached = parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)));
      } catch {
        cached = null;
      }
      if (!active) return;
      if (cached && isOfflineSnapshotFresh(cached.savedAt)) {
        setSections(cached.sections as NamedRow[]);
        setInventory(cached.inventory as NamedRow[]);
        setCrops(cached.crops as NamedRow[]);
        setCattle(cached.cattle as NamedRow[]);
        setTasks(cached.tasks as NamedRow[]);
        setHealthEvents(cached.healthEvents as NamedRow[]);
        setVaccinations(cached.vaccinations as NamedRow[]);
        setEntitiesCached(true);
      } else {
        setEntitiesCached(false);
      }
      setEntitiesLoaded(true);
    };
    void hydrate();
    return () => { active = false; };
  }, [entitiesLoaded, open, readOnly, userId]);

  // Lazy-load searchable entities the first time the palette opens.
  useEffect(() => {
    if (!open || entitiesLoaded || readOnly) return;
    let active = true;
    const grab = (url: string) => fetchWithTimeout(url, {}, 8000)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => Array.isArray(d) ? d as NamedRow[] : [])
      .catch(() => [] as NamedRow[]);
    const grabTasks = () => fetchWithTimeout("/api/tasks", {}, 8000)
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((d) => Array.isArray(d.tasks) ? d.tasks as NamedRow[] : [])
      .catch(() => [] as NamedRow[]);
    const healthPromise = showLivestock ? grab("/api/health") : Promise.resolve([] as NamedRow[]);
    const vaccinationsPromise = showLivestock ? grab("/api/vaccinations") : Promise.resolve([] as NamedRow[]);
    Promise.all([grab("/api/sections"), grab("/api/inventory"), grab("/api/crops"), grab("/api/cattle"), grabTasks(), healthPromise, vaccinationsPromise])
      .then(([nextSections, nextInventory, nextCrops, nextCattle, nextTasks, nextHealthEvents, nextVaccinations]) => {
        if (!active) return;
        setSections(nextSections);
        setInventory(nextInventory);
        setCrops(nextCrops);
        setCattle(nextCattle);
        setTasks(nextTasks);
        setHealthEvents(nextHealthEvents);
        setVaccinations(nextVaccinations);
        setEntitiesCached(false);
        if (userId) {
          try {
            const previous = parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)));
            const merged = mergeOfflineEntitySnapshot(previous, {
              sections: nextSections,
              inventory: nextInventory,
              crops: nextCrops,
              cattle: nextCattle,
              tasks: nextTasks,
              healthEvents: nextHealthEvents,
              vaccinations: nextVaccinations,
            }, new Date().toISOString());
            window.localStorage.setItem(offlineEntitySnapshotKey(userId), JSON.stringify(merged));
          } catch {
            // Storage is optional; online search remains fully usable.
          }
        }
      })
      .finally(() => { if (active) setEntitiesLoaded(true); });
    return () => { active = false; };
  }, [open, entitiesLoaded, readOnly, showLivestock, userId]);

  // The React Compiler memoizes this automatically; no manual useCallback needed.
  const go = (href: string) => { setOpen(false); router.push(href); };
  const openTasks = tasks.filter((task) => task.status !== "completed");
  const pendingHealthEvents = healthEvents.filter((event) => !event.resolved);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Buscar" description="Buscá secciones, inventario, cultivos o navegá">
      <CommandInput placeholder="Buscar o navegar… (⌘K)" />
      <CommandList>
        <CommandEmpty>{readOnly && !entitiesCached ? "Búsqueda de entidades no disponible sin conexión." : entitiesLoaded ? "Sin resultados." : "Actualizando datos…"}</CommandEmpty>
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
              <CommandItem key={s.id} value={`seccion ${s.name}`} onSelect={() => go(`/produccion/hacienda?sectionId=${encodeURIComponent(s.id)}`)}>
                <MapPin className="mr-2 h-4 w-4" /> {s.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {inventory.length > 0 && (
          <CommandGroup heading="Inventario">
            {inventory.map((i) => (
              <CommandItem key={i.id} value={`inventario ${i.name}`} onSelect={() => go(`/gestion/inventario?itemId=${encodeURIComponent(i.id)}`)}>
                <Package className="mr-2 h-4 w-4" /> {i.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {showCrops && crops.length > 0 && (
          <CommandGroup heading="Cultivos">
            {crops.map((c) => (
              <CommandItem key={c.id} value={`cultivo ${c.crop_type}`} onSelect={() => go(`/produccion/agricultura?cropId=${encodeURIComponent(c.id)}`)}>
                <Wheat className="mr-2 h-4 w-4" /> {c.crop_type}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {showLivestock && cattle.length > 0 && (
          <CommandGroup heading="Hacienda">
            {cattle.map((c) => (
              <CommandItem key={c.id} value={`hacienda ${c.category} ${c.breed || ""} ${c.sections?.name || ""}`} onSelect={() => go(`/produccion/hacienda?cattleId=${encodeURIComponent(c.id)}`)}>
                <Beef className="mr-2 h-4 w-4" /> {c.count ?? 0} {c.category}{c.breed ? ` · ${c.breed}` : ""}{c.sections?.name ? ` · ${c.sections.name}` : ""}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {openTasks.length > 0 && (
          <CommandGroup heading="Tareas">
            {openTasks.map((task) => (
              <CommandItem
                key={task.id}
                value={`tarea ${task.title || ""} ${task.due_date || ""} ${task.priority || ""}`}
                onSelect={() => go(`/gestion/tareas?taskId=${encodeURIComponent(task.id)}`)}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                <span className="min-w-0 truncate">{task.title || "Tarea sin título"}</span>
                {task.due_date && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{task.due_date}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {showLivestock && pendingHealthEvents.length > 0 && (
          <CommandGroup heading="Sanidad">
            {pendingHealthEvents.map((event) => (
              <CommandItem
                key={event.id}
                value={`sanidad ${event.type || ""} ${event.description || ""} ${event.sections?.name || ""}`}
                onSelect={() => go(`/produccion/sanidad?healthId=${encodeURIComponent(event.id)}`)}
              >
                <Stethoscope className="mr-2 h-4 w-4" />
                <span className="min-w-0 truncate">{event.description || event.type || "Evento sanitario"}</span>
                {event.sections?.name && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{event.sections.name}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {showLivestock && vaccinations.length > 0 && (
          <CommandGroup heading="Vacunaciones">
            {vaccinations.map((vaccination) => (
              <CommandItem
                key={vaccination.id}
                value={`vacunacion ${vaccination.vaccine_name || ""} ${vaccination.next_due || ""} ${vaccination.sections?.name || ""}`}
                onSelect={() => go(`/produccion/sanidad?vaccinationId=${encodeURIComponent(vaccination.id)}`)}
              >
                <Syringe className="mr-2 h-4 w-4" />
                <span className="min-w-0 truncate">{vaccination.vaccine_name || "Vacunación"}</span>
                {vaccination.next_due && <span className="ml-auto shrink-0 text-xs text-muted-foreground">Próxima: {vaccination.next_due.slice(0, 10)}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
