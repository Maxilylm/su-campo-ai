"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import {
  Bell, Beef, CalendarCheck, CalendarDays, ChevronsUpDown, ClipboardCheck, ClipboardList, DollarSign, Download,
  Home, LogOut, Map, Menu, MessageSquare, Monitor, Moon, Package, Printer, Scale, Search, Settings, Sun,
  Syringe, TrendingUp, Wheat, type LucideIcon,
} from "lucide-react";
import { useFarm } from "@/contexts/FarmContext";
import { CommandPalette } from "@/components/CommandPalette";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { LogoMark } from "@/components/Logo";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { downloadAuthenticatedFile } from "@/lib/download";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const openPalette = () => window.dispatchEvent(new Event("campoai:open-palette"));

const EXPORT_LINKS: { url: string; label: string }[] = [
  { url: "/api/export", label: "Respaldo completo (JSON)" },
  { url: "/api/export?format=csv&table=cattle", label: "Hacienda (CSV)" },
  { url: "/api/export?format=csv&table=health_events", label: "Sanidad (CSV)" },
  { url: "/api/export?format=csv&table=inventory_items", label: "Inventario (CSV)" },
  { url: "/api/export?format=csv&table=financial_transactions", label: "Finanzas (CSV)" },
  { url: "/api/export?format=csv&table=weight_records", label: "Pesajes (CSV)" },
  { url: "/api/calendar", label: "Calendario de pendientes (.ics)" },
];

async function downloadExport(url: string) {
  try {
    const result = await downloadAuthenticatedFile(url, "campoai-export");
    if (!result.ok) toast.error("No se pudo descargar", { description: result.error });
  } catch {
    toast.error("No se pudo descargar", { description: "Revisá tu conexión e intentá nuevamente." });
  }
}

async function signOut() {
  // Loaded on demand so the Supabase client isn't in every page's bundle.
  const { getSupabaseBrowser } = await import("@/lib/supabase");
  // Local scope: the default (global) would sign the user out on every device.
  await getSupabaseBrowser().auth.signOut({ scope: "local" });
  // Full reload so no in-memory farm data survives the sign-out.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
}

const isPathActive = (pathname: string, href: string) =>
  pathname === href || (href !== "/" && pathname.startsWith(href));

function useNavigation() {
  const { farm } = useFarm();
  const opType = farm?.operation_type;
  const livestock = opType === "livestock" || opType === "mixed";
  const crops = opType === "crops" || opType === "mixed";
  const primary: NavItem[] = [
    { href: "/", label: "Hoy", icon: Home },
    { href: "/pendientes", label: "Pendientes", icon: Bell },
    { href: "/gestion/plan", label: "Plan del día", icon: CalendarCheck },
    { href: "/mapa", label: "Mapa", icon: Map },
    { href: "/chat", label: "CampoAI", icon: MessageSquare },
  ];
  const production: NavItem[] = [
    ...(livestock ? [
      { href: "/produccion/hacienda", label: "Hacienda", icon: Beef },
      { href: "/produccion/sanidad", label: "Sanidad", icon: Syringe },
      { href: "/produccion/peso", label: "Pesajes", icon: Scale },
    ] : []),
    ...(crops ? [{ href: "/produccion/agricultura", label: "Agricultura", icon: Wheat }] : []),
  ];
  const management: NavItem[] = [
    { href: "/gestion/tareas", label: "Tareas", icon: ClipboardCheck },
    { href: "/gestion/agenda", label: "Agenda", icon: CalendarDays },
    { href: "/gestion/inventario", label: "Inventario", icon: Package },
    { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
    { href: "/gestion/metricas", label: "Métricas", icon: TrendingUp },
    { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
    { href: "/reportes", label: "Reportes", icon: Printer },
  ];
  return { primary, production, management };
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn("figure ml-auto rounded-full bg-bad-soft px-1.5 py-0.5 text-[11px] font-semibold text-bad", className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavGroup({ label, items, pathname, alertCount, onNavigate }: {
  label?: string; items: NavItem[]; pathname: string; alertCount: number; onNavigate: (href: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {label && <p className="px-2.5 pb-1 pt-4 text-xs font-medium text-muted-foreground">{label}</p>}
      {items.map((item) => {
        const active = isPathActive(pathname, item.href);
        return (
          <button
            type="button"
            key={item.href}
            onClick={() => onNavigate(item.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            <span className="truncate">{item.label}</span>
            {item.href === "/pendientes" && <CountBadge count={alertCount} />}
          </button>
        );
      })}
    </div>
  );
}

function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { farm, userEmail, offlineMode, isOnline } = useFarm();
  const { theme, setTheme } = useTheme();
  const navigate = useOfflineAwareNavigation();
  const exportsDisabled = offlineMode || !isOnline;
  const initial = (userEmail || "U")[0].toUpperCase();
  const themes = [
    { value: "light", label: "Claro", icon: Sun },
    { value: "dark", label: "Oscuro", icon: Moon },
    { value: "system", label: "Automático", icon: Monitor },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-2.5 rounded-md text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "h-9 w-9 justify-center" : "w-full px-2 py-1.5",
        )}
        aria-label="Cuenta y ajustes"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initial}</span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{farm?.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-64">
        <DropdownMenuItem onClick={() => navigate("/gestion/campo")}>
          <Settings className="mr-2 h-4 w-4" /> Mi campo y equipo
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Tema</DropdownMenuLabel>
        {themes.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)} aria-checked={theme === option.value} role="menuitemradio">
            <option.icon className="mr-2 h-4 w-4" /> {option.label}
            {theme === option.value && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Descargar{exportsDisabled ? " (requiere conexión)" : ""}
        </DropdownMenuLabel>
        {EXPORT_LINKS.map((item) => (
          <DropdownMenuItem key={item.url} disabled={exportsDisabled} onClick={() => { void downloadExport(item.url); }}>
            <Download className="mr-2 h-4 w-4" /> {item.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => { void signOut(); }} className="text-bad focus:text-bad">
          <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConnectionStatus() {
  const { offlineMode, isOnline, accessRole } = useFarm();
  const offline = offlineMode || !isOnline;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5" title={offline ? "Mostrando la última copia sincronizada" : undefined}>
        <span className={cn("h-1.5 w-1.5 rounded-full", offline ? "bg-warn" : "bg-ok")} aria-hidden="true" />
        {offline ? "Sin conexión · solo lectura" : "Conectado"}
      </span>
      {accessRole === "viewer" && <span role="status" className="text-info">Acceso de consulta</span>}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate: (href: string) => void }) {
  const pathname = usePathname();
  const { alerts } = useFarm();
  const { primary, production, management } = useNavigation();
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <button type="button" onClick={() => onNavigate("/")} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <LogoMark />
        <span className="condensed text-[15px] font-semibold tracking-tight">CampoAI</span>
      </button>
      <button
        type="button"
        onClick={openPalette}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        Buscar o ir a…
        <kbd className="ml-auto rounded border border-border px-1.5 text-[11px] font-medium">⌘K</kbd>
      </button>
      <nav aria-label="Principal" className="-mx-0.5 flex-1 overflow-y-auto px-0.5">
        <NavGroup items={primary} pathname={pathname} alertCount={alerts.length} onNavigate={onNavigate} />
        <NavGroup label="Producción" items={production} pathname={pathname} alertCount={0} onNavigate={onNavigate} />
        <NavGroup label="Gestión" items={management} pathname={pathname} alertCount={0} onNavigate={onNavigate} />
      </nav>
      <div className="space-y-2 border-t border-border pt-3">
        <ConnectionStatus />
        <AccountMenu />
      </div>
    </div>
  );
}

const TAB_ITEMS: NavItem[] = [
  { href: "/", label: "Hoy", icon: Home },
  { href: "/gestion/plan", label: "Plan", icon: CalendarCheck },
  { href: "/mapa", label: "Mapa", icon: Map },
  { href: "/chat", label: "CampoAI", icon: MessageSquare },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { farm, alerts, accessRole } = useFarm();
  const pathname = usePathname();
  const navigate = useOfflineAwareNavigation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Sign-in, setup and invitation pages render without app chrome.
  if (!farm) return <>{children}</>;

  const go = (href: string) => { setMenuOpen(false); navigate(href); };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <CommandPalette />
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-sidebar lg:block">
        <SidebarContent onNavigate={go} />
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="no-print sticky top-0 z-40 flex items-center gap-1 border-b border-border bg-background/90 px-3 py-2 backdrop-blur lg:hidden">
          <button type="button" onClick={() => go("/")} className="mr-auto flex min-w-0 items-center gap-2 rounded-md p-1" aria-label="Ir a Hoy">
            <LogoMark />
            <span className="condensed truncate text-[15px] font-semibold">{farm.name}</span>
          </button>
          {accessRole === "viewer" && <span role="status" className="mr-1 rounded-md bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-info">Consulta</span>}
          <button type="button" onClick={openPalette} aria-label="Buscar" className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => go("/pendientes")}
            aria-label={`Pendientes${alerts.length ? `: ${alerts.length}` : ""}`}
            className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <Bell className="h-5 w-5" />
            {alerts.length > 0 && (
              <span className="figure absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-destructive-foreground">
                {alerts.length > 9 ? "9+" : alerts.length}
              </span>
            )}
          </button>
          <AccountMenu compact />
        </header>

        <ConnectionBanner />
        <main className="flex flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</main>

        <nav
          aria-label="Accesos rápidos"
          className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          {TAB_ITEMS.map((item) => {
            const active = isPathActive(pathname, item.href);
            return (
              <button
                type="button"
                key={item.href}
                onClick={() => go(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 py-2 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </button>
            );
          })}
          <button type="button" onClick={() => setMenuOpen(true)} className="flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground">
            <Menu className="h-5 w-5" />
            Más
          </button>
        </nav>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[18rem] bg-sidebar p-0">
          <SheetTitle className="sr-only">Menú</SheetTitle>
          <SidebarContent onNavigate={go} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
