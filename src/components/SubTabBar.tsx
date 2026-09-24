"use client";

import { usePathname } from "next/navigation";
import { type LucideIcon } from "lucide-react";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  icon?: LucideIcon;
}

export function SubTabBar({ tabs, className }: { tabs: Tab[]; className?: string }) {
  const pathname = usePathname();
  const navigate = useOfflineAwareNavigation();

  return (
    <nav aria-label="Secciones" className={cn("-mx-1 mb-6 flex gap-5 overflow-x-auto border-b border-border px-1", className)}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <button
            type="button"
            key={tab.href}
            onClick={() => navigate(tab.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-sm transition-colors outline-none focus-visible:text-foreground",
              active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.icon && <tab.icon className="h-4 w-4" aria-hidden="true" />}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
