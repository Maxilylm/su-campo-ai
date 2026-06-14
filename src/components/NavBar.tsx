"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { getSupabaseBrowser } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Home, Beef, Syringe, Wheat, Package, DollarSign,
  BarChart3, ClipboardList, Map, MessageSquare, LogOut,
  ChevronDown, Bell, Download, Printer, Scale, Menu, Layers,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: typeof Home };

// Shared export targets (used by both the desktop account menu and the mobile menu).
const EXPORT_LINKS = [
  { url: "/api/export", label: "Respaldo completo (JSON)" },
  { url: "/api/export?format=csv&table=cattle", label: "Hacienda (CSV)" },
  { url: "/api/export?format=csv&table=health_events", label: "Sanidad (CSV)" },
  { url: "/api/export?format=csv&table=inventory_items", label: "Inventario (CSV)" },
  { url: "/api/export?format=csv&table=financial_transactions", label: "Finanzas (CSV)" },
];

// Trigger a download of an authenticated same-origin endpoint (cookies are sent;
// the route sets Content-Disposition: attachment).
function downloadExport(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const isPathActive = (pathname: string, href: string) =>
  pathname === href || (href !== "/" && pathname.startsWith(href));

function NavLink({
  href, label, icon: Icon, pathname, onNavigate,
}: { href: string; label: string; icon?: typeof Home; pathname: string; onNavigate: (href: string) => void }) {
  return (
    <Button
      variant={isPathActive(pathname, href) ? "secondary" : "ghost"}
      size="sm"
      onClick={() => onNavigate(href)}
      className="gap-1.5"
    >
      {Icon && <Icon className="h-4 w-4" />}
      {label}
    </Button>
  );
}

function NavDropdown({
  name, items, pathname, onNavigate,
}: { name: string; items: NavItem[]; pathname: string; onNavigate: (href: string) => void }) {
  const active = items.some((i) => isPathActive(pathname, i.href));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={active ? "secondary" : "ghost"} size="sm" className="gap-1">
          {name}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.href}
            onClick={() => onNavigate(item.href)}
            className={isPathActive(pathname, item.href) ? "bg-accent" : ""}
          >
            <item.icon className="mr-2 h-4 w-4" />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NavBar() {
  const { farm, userEmail } = useFarm();
  const pathname = usePathname();
  const router = useRouter();
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    if (!farm) return;
    let active = true;
    fetch("/api/alerts")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => active && setAlertCount(d.count || 0))
      .catch(() => {});
    return () => { active = false; };
  }, [farm, pathname]);

  if (!farm) return null;

  const opType = farm.operation_type;
  const showLivestock = opType === "livestock" || opType === "mixed";
  const showCrops = opType === "crops" || opType === "mixed";

  const produccionItems = [
    ...(showLivestock ? [{ href: "/produccion/hacienda", label: "Hacienda", icon: Beef }] : []),
    ...(showLivestock ? [{ href: "/produccion/sanidad", label: "Sanidad", icon: Syringe }] : []),
    ...(showLivestock ? [{ href: "/produccion/peso", label: "Pesajes", icon: Scale }] : []),
    ...(showCrops ? [{ href: "/produccion/agricultura", label: "Agricultura", icon: Wheat }] : []),
  ];

  const gestionItems = [
    { href: "/gestion/inventario", label: "Inventario", icon: Package },
    { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
    { href: "/gestion/metricas", label: "Metricas", icon: BarChart3 },
    { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
    { href: "/reportes", label: "Reportes", icon: Printer },
  ];

  // Flat list for the mobile menu — every page reachable in one place.
  const mobileNav: NavItem[] = [
    { href: "/", label: "Inicio", icon: Home },
    ...produccionItems,
    ...gestionItems,
    { href: "/mapa", label: "Mapa", icon: Map },
    { href: "/chat", label: "Chat", icon: MessageSquare },
  ];

  const isActive = (href: string) => isPathActive(pathname, href);
  const go = (href: string) => router.push(href);

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const initial = (userEmail || "U")[0].toUpperCase();

  return (
    <>
      <CommandPalette />
      {/* Desktop */}
      <nav className="hidden sm:flex items-center justify-between border-b border-border bg-background px-4 py-2">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/")} className="hover:opacity-80 transition-opacity">
            <Logo />
          </button>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-0.5">
            <NavLink href="/" label="Inicio" icon={Home} pathname={pathname} onNavigate={go} />
            <NavDropdown name="Produccion" items={produccionItems} pathname={pathname} onNavigate={go} />
            <NavDropdown name="Gestion" items={gestionItems} pathname={pathname} onNavigate={go} />
            <NavLink href="/mapa" label="Mapa" icon={Map} pathname={pathname} onNavigate={go} />
            <NavLink href="/chat" label="Chat" icon={MessageSquare} pathname={pathname} onNavigate={go} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="max-w-[120px] truncate">{farm.name}</span>
          </div>
          <button
            onClick={() => router.push("/")}
            className="relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
            aria-label={`Pendientes${alertCount ? `: ${alertCount}` : ""}`}
          >
            <Bell className="h-4 w-4 text-muted-foreground" />
            {alertCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </button>
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs bg-muted">{initial}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{farm.name}</p>
                <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
              </div>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Exportar</div>
              {EXPORT_LINKS.map((e) => (
                <DropdownMenuItem key={e.url} onClick={() => downloadExport(e.url)}>
                  <Download className="mr-2 h-4 w-4" /> {e.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Salir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      {/* Mobile top bar — logo, alerts, and a full menu (everything reachable on mobile) */}
      <nav className="sm:hidden sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background px-4 py-2">
        <button onClick={() => router.push("/")} className="hover:opacity-80 transition-opacity" aria-label="Inicio">
          <Logo />
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => router.push("/")}
            className="relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent transition-colors"
            aria-label={`Pendientes${alertCount ? `: ${alertCount}` : ""}`}
          >
            <Bell className="h-5 w-5 text-muted-foreground" />
            {alertCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </button>
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Menú">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 max-h-[80dvh] overflow-y-auto">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium truncate">{farm.name}</p>
                <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
              </div>
              <DropdownMenuSeparator />
              {mobileNav.map((item) => (
                <DropdownMenuItem key={item.href} onClick={() => go(item.href)} className={isActive(item.href) ? "bg-accent" : ""}>
                  <item.icon className="mr-2 h-4 w-4" /> {item.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Exportar</div>
              {EXPORT_LINKS.map((e) => (
                <DropdownMenuItem key={e.url} onClick={() => downloadExport(e.url)}>
                  <Download className="mr-2 h-4 w-4" /> {e.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Salir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      {/* Mobile bottom bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border flex justify-around py-2 z-50">
        {[
          { href: "/", icon: Home, label: "Inicio" },
          { href: produccionItems[0]?.href || "/produccion/hacienda", icon: Beef, label: "Produccion" },
          { href: "/gestion/inventario", icon: Layers, label: "Gestion" },
          { href: "/mapa", icon: Map, label: "Mapa" },
          { href: "/chat", icon: MessageSquare, label: "Chat" },
        ].map((item) => (
          <button
            key={item.href}
            onClick={() => router.push(item.href)}
            className={`flex flex-col items-center gap-0.5 text-xs transition-colors ${
              isActive(item.href) ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
