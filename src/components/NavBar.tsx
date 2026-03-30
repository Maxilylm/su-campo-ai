"use client";

import { usePathname, useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { getSupabaseBrowser } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  ChevronDown,
} from "lucide-react";

export function NavBar() {
  const { farm, userEmail } = useFarm();
  const pathname = usePathname();
  const router = useRouter();

  if (!farm) return null;

  const opType = farm.operation_type;
  const showLivestock = opType === "livestock" || opType === "mixed";
  const showCrops = opType === "crops" || opType === "mixed";

  const produccionItems = [
    ...(showLivestock ? [{ href: "/produccion/hacienda", label: "Hacienda", icon: Beef }] : []),
    ...(showLivestock ? [{ href: "/produccion/sanidad", label: "Sanidad", icon: Syringe }] : []),
    ...(showCrops ? [{ href: "/produccion/agricultura", label: "Agricultura", icon: Wheat }] : []),
  ];

  const gestionItems = [
    { href: "/gestion/inventario", label: "Inventario", icon: Package },
    { href: "/gestion/finanzas", label: "Finanzas", icon: DollarSign },
    { href: "/gestion/metricas", label: "Metricas", icon: BarChart3 },
    { href: "/gestion/registro", label: "Registro", icon: ClipboardList },
  ];

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href));
  const isGroupActive = (items: { href: string }[]) => items.some((i) => isActive(i.href));

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const initial = (userEmail || "U")[0].toUpperCase();

  function NavLink({ href, label, icon: Icon }: { href: string; label: string; icon?: typeof Home }) {
    return (
      <Button
        variant={isActive(href) ? "secondary" : "ghost"}
        size="sm"
        onClick={() => router.push(href)}
        className="gap-1.5"
      >
        {Icon && <Icon className="h-4 w-4" />}
        {label}
      </Button>
    );
  }

  function NavDropdown({ name, items }: { name: string; items: { href: string; label: string; icon: typeof Home }[] }) {
    const active = isGroupActive(items);
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
              onClick={() => router.push(item.href)}
              className={isActive(item.href) ? "bg-accent" : ""}
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      {/* Desktop */}
      <nav className="hidden sm:flex items-center justify-between border-b border-border bg-background px-4 py-2">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/")} className="hover:opacity-80 transition-opacity">
            <Logo />
          </button>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-0.5">
            <NavLink href="/" label="Inicio" icon={Home} />
            <NavDropdown name="Produccion" items={produccionItems} />
            <NavDropdown name="Gestion" items={gestionItems} />
            <NavLink href="/mapa" label="Mapa" icon={Map} />
            <NavLink href="/chat" label="Chat" icon={MessageSquare} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="max-w-[120px] truncate">{farm.name}</span>
          </div>
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
          { href: "/gestion/inventario", icon: BarChart3, label: "Gestion" },
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
