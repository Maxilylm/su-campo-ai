"use client";

import { usePathname } from "next/navigation";
import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";

interface Tab {
  href: string;
  label: string;
  icon?: LucideIcon;
}

export function SubTabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const navigate = useOfflineAwareNavigation();

  return (
    <div className="flex gap-1 border-b border-border mb-6 pb-2 overflow-x-auto">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Button
            key={tab.href}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            onClick={() => navigate(tab.href)}
            className="gap-1.5 shrink-0"
          >
            {tab.icon && <tab.icon className="h-4 w-4" />}
            {tab.label}
          </Button>
        );
      })}
    </div>
  );
}
