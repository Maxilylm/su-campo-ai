"use client";

import { usePathname, useRouter } from "next/navigation";

interface Tab { href: string; label: string; }

export function SubTabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex gap-1 border-b border-zinc-800 mb-6 pb-2 overflow-x-auto">
      {tabs.map((tab) => (
        <button key={tab.href} onClick={() => router.push(tab.href)}
          className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
            pathname === tab.href ? "bg-emerald-600 text-white font-semibold" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          }`}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
