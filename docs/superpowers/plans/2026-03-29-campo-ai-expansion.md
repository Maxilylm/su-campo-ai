# CampoAI Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve CampoAI from a livestock-only MVP into a configurable farm management platform with agriculture, inventory, financial, and metrics sections.

**Architecture:** Restructure the 19KB monolith `page.tsx` into grouped, route-based navigation (Producción, Gestión, Mapa, Chat). Add `FarmProvider` context for shared state. 5 new database tables, 1 altered table, new API routes, and extended AI system prompt. All new features are voice-operable through the existing Groq AI chat.

**Tech Stack:** Next.js 16.2 (App Router), React 19, Supabase (PostgreSQL + Auth), Groq API (Llama 3.3 + Whisper), Tailwind CSS 4, Recharts (new), TypeScript 5

**Design Spec:** `docs/superpowers/specs/2026-03-29-campo-ai-expansion-design.md`

**Visual Review:** After each UI task, invoke `/frontend-design` to review visual design and UX.

---

## File Structure

### New Files
```
src/
├── contexts/
│   └── FarmContext.tsx              — FarmProvider: shared farm + sections + operation_type
├── components/
│   ├── NavBar.tsx                   — Top nav (desktop dropdowns, mobile bottom bar)
│   ├── SubTabBar.tsx                — Reusable sub-tab bar for route groups
│   ├── StatCard.tsx                 — Extracted from page.tsx (shared UI)
│   ├── Input.tsx                    — Extracted from page.tsx (shared UI)
│   └── EmptyState.tsx              — Extracted from page.tsx (shared UI)
├── app/
│   ├── setup/
│   │   └── page.tsx                — Farm creation + operation type selector
│   ├── produccion/
│   │   ├── layout.tsx              — Sub-tab bar: Hacienda | Sanidad | Agricultura
│   │   ├── hacienda/page.tsx       — Extracted HaciendaTab
│   │   ├── sanidad/page.tsx        — Extracted SanidadTab
│   │   └── agricultura/page.tsx    — NEW crop management
│   ├── gestion/
│   │   ├── layout.tsx              — Sub-tab bar: Inventario | Finanzas | Métricas | Registro
│   │   ├── inventario/page.tsx     — NEW inventory management
│   │   ├── finanzas/page.tsx       — NEW financial tracking
│   │   ├── metricas/page.tsx       — NEW metrics dashboard
│   │   └── registro/page.tsx       — Extracted RegistroTab
│   ├── mapa/page.tsx               — Extracted map (imports FarmMap)
│   ├── chat/page.tsx               — Extracted ChatTab
│   └── api/
│       ├── crops/route.ts          — CRUD for crops
│       ├── crop-applications/route.ts — CRUD for crop applications
│       ├── inventory/route.ts      — CRUD for inventory items
│       ├── inventory/movements/route.ts — CRUD for inventory movements
│       ├── financial/route.ts      — CRUD for financial transactions
│       └── metrics/route.ts        — Read-only metrics aggregation
supabase/
└── 007_expansion.sql               — All new tables, triggers, RLS policies
```

### Modified Files
```
src/app/layout.tsx                  — Wrap children in FarmProvider + NavBar
src/app/page.tsx                    — Slim down to Inicio (overview dashboard)
src/app/api/farm/route.ts           — Accept operation_type in POST
src/lib/ai.ts                       — Extended system prompt + new tables in context + new operations
src/middleware.ts                    — Allow new routes
package.json                        — Add recharts dependency
```

---

## Phase 1: Foundation (Navigation Restructure + Farm Profile)

### Task 1: Database Migration — operation_type + new tables

**Files:**
- Create: `supabase/007_expansion.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 007_expansion.sql
-- CampoAI Expansion: operation types, crops, inventory, financials

-- ─── 1. Farm operation type ───────────────────────
ALTER TABLE farms ADD COLUMN IF NOT EXISTS operation_type TEXT NOT NULL DEFAULT 'livestock';

-- ─── 2. Crops ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS crops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  crop_type TEXT NOT NULL,
  variety TEXT,
  planted_hectares NUMERIC,
  planting_date DATE,
  expected_harvest DATE,
  actual_harvest DATE,
  yield_kg NUMERIC,
  yield_per_hectare NUMERIC GENERATED ALWAYS AS (yield_kg / NULLIF(planted_hectares, 0)) STORED,
  status TEXT NOT NULL DEFAULT 'planted',
  soil_type TEXT,
  irrigation_type TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crops_farm ON crops(farm_id);

CREATE TABLE IF NOT EXISTS crop_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  crop_id UUID NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  product_name TEXT,
  dose_per_hectare TEXT,
  total_applied TEXT,
  date_applied DATE,
  applied_by TEXT,
  weather_conditions TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crop_applications_crop ON crop_applications(crop_id);

-- ─── 3. Inventory ─────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC,
  cost_per_unit NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_farm ON inventory_items(farm_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC,
  total_cost NUMERIC GENERATED ALWAYS AS (quantity * COALESCE(unit_cost, 0)) STORED,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  crop_id UUID REFERENCES crops(id) ON DELETE SET NULL,
  cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_farm ON inventory_movements(farm_id);

-- Trigger: update current_stock on movement insert
CREATE OR REPLACE FUNCTION update_inventory_stock()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory_items
  SET current_stock = current_stock + NEW.quantity
  WHERE id = NEW.item_id;

  -- Update cost_per_unit on purchase
  IF NEW.type = 'compra' AND NEW.unit_cost IS NOT NULL THEN
    UPDATE inventory_items
    SET cost_per_unit = NEW.unit_cost
    WHERE id = NEW.item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_stock_update
  AFTER INSERT ON inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION update_inventory_stock();

-- ─── 4. Financial Transactions ────────────────────
CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  crop_id UUID REFERENCES crops(id) ON DELETE SET NULL,
  cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
  inventory_movement_id UUID REFERENCES inventory_movements(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_farm ON financial_transactions(farm_id);
CREATE INDEX IF NOT EXISTS idx_financial_date ON financial_transactions(farm_id, date);

-- ─── 5. RLS Policies ─────────────────────────────
-- Service role has full access (existing pattern).
-- Anon/authenticated users scoped by farm_id through their user_id → farms join.

ALTER TABLE crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;

-- Service role bypass (same pattern as existing tables)
CREATE POLICY "Service role full access on crops" ON crops FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on crop_applications" ON crop_applications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on inventory_items" ON inventory_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on inventory_movements" ON inventory_movements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on financial_transactions" ON financial_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- User access scoped by farm ownership
CREATE POLICY "Users access own crops" ON crops FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users access own crop_applications" ON crop_applications FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users access own inventory_items" ON inventory_items FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users access own inventory_movements" ON inventory_movements FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users access own financial_transactions" ON financial_transactions FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));
```

- [ ] **Step 2: Run migration against Supabase**

Run the migration in the Supabase SQL editor or via CLI. Verify all tables created:

```bash
# If using Supabase CLI:
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
# Copy the SQL and run in Supabase dashboard SQL editor
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add supabase/007_expansion.sql
git commit -m "feat: add migration for crops, inventory, financials tables"
```

---

### Task 2: Extract Shared UI Components

**Files:**
- Create: `src/components/StatCard.tsx`
- Create: `src/components/Input.tsx`
- Create: `src/components/EmptyState.tsx`
- Modify: `src/app/page.tsx` (remove these components from bottom)

- [ ] **Step 1: Create StatCard component**

```tsx
// src/components/StatCard.tsx
"use client";

const ACCENT_CLASSES: Record<string, string> = {
  emerald: "border-emerald-500/30 text-emerald-400",
  blue: "border-blue-500/30 text-blue-400",
  amber: "border-amber-500/30 text-amber-400",
  red: "border-red-500/30 text-red-400",
  purple: "border-purple-500/30 text-purple-400",
};

export function StatCard({ label, value, accent = "emerald" }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className={`rounded-xl border bg-zinc-900/50 p-3 text-center ${ACCENT_CLASSES[accent] || ACCENT_CLASSES.emerald}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-zinc-500 text-xs mt-0.5">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create Input component**

```tsx
// src/components/Input.tsx
"use client";

export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}
```

- [ ] **Step 3: Create EmptyState component**

```tsx
// src/components/EmptyState.tsx
"use client";

export function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="text-center py-12 text-zinc-600">
      <div className="text-4xl mb-2">{icon}</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}
```

- [ ] **Step 4: Remove duplicated components from page.tsx**

In `src/app/page.tsx`, find the `StatCard`, `Input`, `EmptyState`, and `Select` component definitions at the bottom of the file (around lines 1307-1367). Remove them and add imports at the top:

Replace the component definitions at the bottom of page.tsx with imports at the top. The existing `Select` component can stay inline for now since it's only used in page.tsx.

Add to the imports section of `src/app/page.tsx`:
```tsx
import { StatCard } from "@/components/StatCard";
import { Input } from "@/components/Input";
import { EmptyState } from "@/components/EmptyState";
```

- [ ] **Step 5: Verify the app still builds**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
npx next build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/components/StatCard.tsx src/components/Input.tsx src/components/EmptyState.tsx src/app/page.tsx
git commit -m "refactor: extract StatCard, Input, EmptyState into shared components"
```

---

### Task 3: Create FarmProvider Context

**Files:**
- Create: `src/contexts/FarmContext.tsx`

- [ ] **Step 1: Create the FarmProvider**

```tsx
// src/contexts/FarmContext.tsx
"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export interface Farm {
  id: string;
  name: string;
  total_hectares: number | null;
  location: string | null;
  operation_type: "livestock" | "crops" | "mixed";
}

export interface Section {
  id: string;
  name: string;
  size_hectares: number | null;
  capacity: number | null;
  color: string;
  water_status: string;
  pasture_status: string;
  notes: string | null;
  padron_id: string | null;
}

interface FarmContextValue {
  farm: Farm | null;
  sections: Section[];
  loading: boolean;
  noFarm: boolean;
  userEmail: string;
  refreshFarm: () => Promise<void>;
  refreshSections: () => Promise<void>;
  setFarm: (farm: Farm | null) => void;
  setNoFarm: (v: boolean) => void;
}

const FarmContext = createContext<FarmContextValue | null>(null);

export function useFarm() {
  const ctx = useContext(FarmContext);
  if (!ctx) throw new Error("useFarm must be used within FarmProvider");
  return ctx;
}

export function FarmProvider({ children }: { children: ReactNode }) {
  const [farm, setFarm] = useState<Farm | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [noFarm, setNoFarm] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  const refreshSections = useCallback(async () => {
    const res = await fetch("/api/sections");
    if (res.ok) {
      const data = await res.json();
      setSections(data);
    }
  }, []);

  const refreshFarm = useCallback(async () => {
    const res = await fetch("/api/farm");
    if (res.ok) {
      const { farm: f } = await res.json();
      if (f) {
        setFarm(f);
        setNoFarm(false);
        await refreshSections();
      } else {
        setNoFarm(true);
      }
    }
  }, [refreshSections]);

  useEffect(() => {
    async function init() {
      // Get user email
      const { getSupabaseBrowser } = await import("@/lib/supabase");
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);

      await refreshFarm();
      setLoading(false);
    }
    init();
  }, [refreshFarm]);

  return (
    <FarmContext.Provider
      value={{ farm, sections, loading, noFarm, userEmail, refreshFarm, refreshSections, setFarm, setNoFarm }}
    >
      {children}
    </FarmContext.Provider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/contexts/FarmContext.tsx
git commit -m "feat: add FarmProvider context for shared farm state"
```

---

### Task 4: Create NavBar Component

**Files:**
- Create: `src/components/NavBar.tsx`
- Create: `src/components/SubTabBar.tsx`

- [ ] **Step 1: Create NavBar**

```tsx
// src/components/NavBar.tsx
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

  const isActive = (href: string) => pathname.startsWith(href);
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
          isActive(href)
            ? "bg-emerald-600 text-white font-semibold"
            : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
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
        <button
          className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
            active ? "bg-emerald-600/20 text-emerald-400 font-semibold" : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {name} ▾
        </button>
        {openDropdown === name && (
          <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg p-1 min-w-[180px] shadow-xl z-50">
            {items.map((item) => (
              <button
                key={item.href}
                onClick={() => { router.push(item.href); setOpenDropdown(null); }}
                className={`block w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive(item.href)
                    ? "bg-emerald-600/10 text-emerald-400"
                    : "text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Desktop nav
  return (
    <>
      {/* Desktop */}
      <nav className="hidden sm:flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/")} className="text-emerald-400 font-bold text-lg">
            🌿 CampoAI
          </button>
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
          <button
            key={item.href}
            onClick={() => router.push(item.href)}
            className={`flex flex-col items-center gap-0.5 text-xs ${
              isActive(item.href) ? "text-emerald-400" : "text-zinc-500"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
```

- [ ] **Step 2: Create SubTabBar**

```tsx
// src/components/SubTabBar.tsx
"use client";

import { usePathname, useRouter } from "next/navigation";

interface Tab {
  href: string;
  label: string;
}

export function SubTabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex gap-1 border-b border-zinc-800 mb-6 pb-2 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.href}
          onClick={() => router.push(tab.href)}
          className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
            pathname === tab.href
              ? "bg-emerald-600 text-white font-semibold"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/components/NavBar.tsx src/components/SubTabBar.tsx
git commit -m "feat: add NavBar with dropdowns and SubTabBar components"
```

---

### Task 5: Update Root Layout + Farm API

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/api/farm/route.ts`

- [ ] **Step 1: Update layout.tsx to include FarmProvider and NavBar**

Replace the entire `src/app/layout.tsx`:

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FarmProvider } from "@/contexts/FarmContext";
import { NavBar } from "@/components/NavBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CampoAI — Gestión Agropecuaria Inteligente",
  description:
    "Sistema de gestión ganadera y agrícola con WhatsApp. Registra hacienda, cultivos, inventario y finanzas con mensajes de texto o audio.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-50">
        <FarmProvider>
          <NavBar />
          <div className="flex-1 pb-16 sm:pb-0">{children}</div>
        </FarmProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Update farm API to accept operation_type**

In `src/app/api/farm/route.ts`, modify the POST handler to accept `operationType`:

Find:
```typescript
  const { name, totalHectares, location } = await req.json();
```

Replace with:
```typescript
  const { name, totalHectares, location, operationType } = await req.json();
```

Find:
```typescript
      name: name || "Mi Campo",
      user_id: user.id,
      owner_phone: "",
      total_hectares: totalHectares || null,
      location: location || null,
```

Replace with:
```typescript
      name: name || "Mi Campo",
      user_id: user.id,
      owner_phone: "",
      total_hectares: totalHectares || null,
      location: location || null,
      operation_type: operationType || "livestock",
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/layout.tsx src/app/api/farm/route.ts
git commit -m "feat: integrate FarmProvider + NavBar into root layout, add operation_type to farm API"
```

---

### Task 6: Create Setup Page with Operation Type

**Files:**
- Create: `src/app/setup/page.tsx`

- [ ] **Step 1: Create setup page**

```tsx
// src/app/setup/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";

const OP_TYPES = [
  { value: "livestock", icon: "🐄", label: "Ganadería", desc: "Bovinos, equinos, ovinos" },
  { value: "crops", icon: "🌾", label: "Agricultura", desc: "Cultivos, cosechas" },
  { value: "mixed", icon: "🐄🌾", label: "Mixto", desc: "Ganadería + Agricultura" },
] as const;

export default function SetupPage() {
  const { refreshFarm } = useFarm();
  const router = useRouter();
  const [name, setName] = useState("");
  const [hectares, setHectares] = useState("");
  const [location, setLocation] = useState("");
  const [opType, setOpType] = useState<string>("livestock");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    const res = await fetch("/api/farm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || "Mi Campo",
        totalHectares: hectares ? Number(hectares) : null,
        location: location || null,
        operationType: opType,
      }),
    });
    if (res.ok) {
      await refreshFarm();
      router.push("/");
    }
    setSubmitting(false);
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🌿</div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-emerald-400">Campo</span>AI
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Configurá tu campo para empezar</p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-5">
          <Input label="Nombre del campo" value={name} onChange={setName} placeholder="Ej: Estancia La Gloria" />
          <Input label="Hectáreas totales" value={hectares} onChange={setHectares} placeholder="500" type="number" />
          <Input label="Ubicación" value={location} onChange={setLocation} placeholder="Ej: Paysandú, Uruguay" />

          {/* Operation type selector */}
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Tipo de establecimiento</label>
            <div className="grid grid-cols-3 gap-2">
              {OP_TYPES.map((op) => (
                <button
                  key={op.value}
                  onClick={() => setOpType(op.value)}
                  className={`rounded-xl border-2 p-3 text-center transition-colors ${
                    opType === op.value
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <div className="text-2xl mb-1">{op.icon}</div>
                  <div className="text-sm font-semibold text-zinc-100">{op.label}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{op.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-colors text-sm"
          >
            {submitting ? "Creando..." : "Crear mi campo"}
          </button>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/setup/page.tsx
git commit -m "feat: add setup page with operation type selector"
```

---

### Task 7: Refactor page.tsx into Inicio + Extract Tabs to Routes

**Files:**
- Modify: `src/app/page.tsx` — Slim down to Inicio overview
- Create: `src/app/produccion/layout.tsx`
- Create: `src/app/produccion/hacienda/page.tsx`
- Create: `src/app/produccion/sanidad/page.tsx`
- Create: `src/app/gestion/layout.tsx`
- Create: `src/app/gestion/registro/page.tsx`
- Create: `src/app/mapa/page.tsx`
- Create: `src/app/chat/page.tsx`

This is the largest task. Each extracted page needs to manage its own data loading and state.

- [ ] **Step 1: Create Producción layout**

```tsx
// src/app/produccion/layout.tsx
"use client";

import { SubTabBar } from "@/components/SubTabBar";
import { useFarm } from "@/contexts/FarmContext";

export default function ProduccionLayout({ children }: { children: React.ReactNode }) {
  const { farm } = useFarm();
  const opType = farm?.operation_type || "livestock";
  const showLivestock = opType === "livestock" || opType === "mixed";
  const showCrops = opType === "crops" || opType === "mixed";

  const tabs = [
    ...(showLivestock ? [{ href: "/produccion/hacienda", label: "🐄 Hacienda" }] : []),
    ...(showLivestock ? [{ href: "/produccion/sanidad", label: "💉 Sanidad" }] : []),
    ...(showCrops ? [{ href: "/produccion/agricultura", label: "🌾 Agricultura" }] : []),
  ];

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      <SubTabBar tabs={tabs} />
      {children}
    </main>
  );
}
```

- [ ] **Step 2: Create Gestión layout**

```tsx
// src/app/gestion/layout.tsx
"use client";

import { SubTabBar } from "@/components/SubTabBar";

export default function GestionLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: "/gestion/inventario", label: "📦 Inventario" },
    { href: "/gestion/finanzas", label: "💰 Finanzas" },
    { href: "/gestion/metricas", label: "📊 Métricas" },
    { href: "/gestion/registro", label: "📋 Registro" },
  ];

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      <SubTabBar tabs={tabs} />
      {children}
    </main>
  );
}
```

- [ ] **Step 3: Extract HaciendaTab to its own page**

Create `src/app/produccion/hacienda/page.tsx`. This page needs to:
1. Import `useFarm` for sections
2. Manage its own cattle state (fetch from `/api/cattle`)
3. Include all the section CRUD and cattle CRUD logic from the current `page.tsx` lines ~448-788
4. Include the `Select` helper component locally

The extracted component follows the same pattern as the current monolith but uses `useFarm()` for sections instead of local state:

```tsx
// src/app/produccion/hacienda/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";
import { EmptyState } from "@/components/EmptyState";

// Copy the Cattle interface, CATEGORIES, BREEDS, SECTION_COLORS, CAT_ICON constants
// from the current page.tsx lines 31-110

// Copy the entire HaciendaTab component logic from current page.tsx lines 448-788
// Changes needed:
// - Replace `sections` prop with `const { sections, refreshSections } = useFarm();`
// - Replace `loadData()` calls with `refreshSections()` + local cattle refetch
// - The component becomes the default export

export default function HaciendaPage() {
  const { sections, refreshSections } = useFarm();
  // ... rest of HaciendaTab logic with cattle state management
  // Fetch cattle from /api/cattle on mount + after mutations
  // All section CRUD calls /api/sections then refreshSections()
  // All cattle CRUD calls /api/cattle then refetches cattle
}
```

**Important:** Copy the full component body from the existing `page.tsx` HaciendaTab (lines 448-788). Replace `setSections` calls with `refreshSections()`, and manage cattle as local state fetched from `/api/cattle`.

- [ ] **Step 4: Extract SanidadTab to its own page**

```tsx
// src/app/produccion/sanidad/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";
import { EmptyState } from "@/components/EmptyState";

// Copy Vaccination, HealthEvent interfaces, VACCINES, HEALTH_TYPES, HEALTH_ICON constants
// from current page.tsx

// Copy the entire SanidadTab logic from current page.tsx lines 789-1000
// Changes: use useFarm() for sections, manage vaccinations/healthEvents as local state

export default function SanidadPage() {
  const { sections } = useFarm();
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [healthEvents, setHealthEvents] = useState<HealthEvent[]>([]);

  const loadData = useCallback(async () => {
    const [vacc, health] = await Promise.all([
      fetch("/api/vaccinations").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/health").then((r) => (r.ok ? r.json() : [])),
    ]);
    setVaccinations(vacc);
    setHealthEvents(health);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ... rest of SanidadTab component body from page.tsx
}
```

- [ ] **Step 5: Extract RegistroTab**

```tsx
// src/app/gestion/registro/page.tsx
"use client";

import { useState, useEffect } from "react";
import { EmptyState } from "@/components/EmptyState";

interface Activity {
  id: string;
  type: string;
  description: string;
  raw_message: string | null;
  message_type: string;
  created_at: string;
}

const ACT_ICON: Record<string, string> = {
  movement: "🔄", count_update: "📊", health: "🏥", note: "📝", setup: "⚙️", registration: "📋",
};

export default function RegistroPage() {
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    fetch("/api/activities?limit=50")
      .then((r) => (r.ok ? r.json() : []))
      .then(setActivities);
  }, []);

  if (activities.length === 0) {
    return <EmptyState icon="📋" message="No hay actividad registrada aún" />;
  }

  return (
    <div className="space-y-2">
      {activities.map((a) => (
        <div key={a.id} className="flex gap-3 items-start rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-lg">{ACT_ICON[a.type] || "📌"}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-200">{a.description}</p>
            {a.raw_message && (
              <p className="text-xs text-zinc-600 mt-0.5 truncate">
                {a.message_type === "audio" ? "🎙️ " : ""}
                {a.raw_message}
              </p>
            )}
          </div>
          <time className="text-xs text-zinc-600 shrink-0">
            {new Date(a.created_at).toLocaleDateString("es-AR", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })}
          </time>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Extract Map page**

```tsx
// src/app/mapa/page.tsx
"use client";

import dynamic from "next/dynamic";

const FarmMap = dynamic(() => import("@/components/FarmMap"), { ssr: false });

export default function MapaPage() {
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      <FarmMap />
    </main>
  );
}
```

- [ ] **Step 7: Extract Chat page**

```tsx
// src/app/chat/page.tsx
"use client";

// Copy the entire ChatTab component from current page.tsx lines 1032-1305
// Changes:
// - It becomes the default export
// - Wrap in <main> with standard padding
// - Uses useFarm() for farm context if needed (currently ChatTab doesn't need farm data)

import { useState, useEffect, useRef } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export default function ChatPage() {
  // ... copy full ChatTab logic from page.tsx lines 1032-1305
  // The chat is self-contained — loads its own history from /api/chat
  // Sends messages to /api/chat and /api/chat/audio

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6">
      {/* ... chat UI ... */}
    </main>
  );
}
```

- [ ] **Step 8: Slim down page.tsx to Inicio**

Replace `src/app/page.tsx` with a slim overview that redirects to setup if no farm, or shows the enhanced overview dashboard:

```tsx
// src/app/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";

export default function InicioPage() {
  const { farm, sections, loading, noFarm } = useFarm();
  const router = useRouter();

  useEffect(() => {
    if (!loading && noFarm) {
      router.push("/setup");
    }
  }, [loading, noFarm, router]);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🌿</div>
          <div className="text-zinc-400 text-sm">Cargando CampoAI...</div>
        </div>
      </main>
    );
  }

  if (!farm) return null;

  const allCattle = sections.flatMap((s: any) => s.cattle || []);
  const totalCattle = allCattle.reduce((sum: number, c: any) => sum + c.count, 0);
  const totalHectares = sections.reduce((sum, s) => sum + (s.size_hectares || 0), 0);

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      <h2 className="text-xl font-bold mb-4">Resumen</h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Cabezas" value={totalCattle} accent="emerald" />
        <StatCard label="Secciones" value={sections.length} accent="blue" />
        <StatCard label="Hectáreas" value={totalHectares} accent="amber" />
        <StatCard label="Tipo" value={farm.operation_type === "livestock" ? "Ganadería" : farm.operation_type === "crops" ? "Agricultura" : "Mixto"} accent="purple" />
      </div>

      {sections.length === 0 ? (
        <EmptyState icon="🏕️" message="Agregá tu primera sección en Producción → Hacienda" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sections.map((s) => {
            const sectionCattle = (s as any).cattle || [];
            const headCount = sectionCattle.reduce((sum: number, c: any) => sum + c.count, 0);
            return (
              <div key={s.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="font-semibold text-sm">{s.name}</span>
                  <span className="text-zinc-500 text-xs ml-auto">{s.size_hectares || "?"} ha</span>
                </div>
                <div className="text-xs text-zinc-400">
                  {headCount} cabezas · Agua: {s.water_status} · Pasto: {s.pasture_status}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 9: Verify the app builds and all routes work**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
npx next build
```

Expected: Build succeeds. Navigate to `/`, `/produccion/hacienda`, `/produccion/sanidad`, `/gestion/registro`, `/mapa`, `/chat`, `/setup` — all should load.

- [ ] **Step 10: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/page.tsx src/app/setup/page.tsx src/app/produccion/ src/app/gestion/layout.tsx src/app/gestion/registro/page.tsx src/app/mapa/page.tsx src/app/chat/page.tsx
git commit -m "refactor: decompose monolith page.tsx into route-based navigation"
```

- [ ] **Step 11: Visual review with /frontend-design**

Invoke `/frontend-design` to review the navigation bar, setup page, and overall layout.

---

## Phase 2: Agriculture (Crop Management)

### Task 8: Crops API Routes

**Files:**
- Create: `src/app/api/crops/route.ts`
- Create: `src/app/api/crop-applications/route.ts`

- [ ] **Step 1: Create crops API**

```tsx
// src/app/api/crops/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("crops")
    .select("*, sections(name), crop_applications(id)")
    .eq("farm_id", result.farmId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("crops")
    .insert({
      farm_id: result.farmId,
      section_id: body.sectionId || null,
      crop_type: body.cropType,
      variety: body.variety || null,
      planted_hectares: body.plantedHectares || null,
      planting_date: body.plantingDate || null,
      expected_harvest: body.expectedHarvest || null,
      actual_harvest: body.actualHarvest || null,
      yield_kg: body.yieldKg || null,
      status: body.status || "planted",
      soil_type: body.soilType || null,
      irrigation_type: body.irrigationType || null,
      notes: body.notes || null,
    })
    .select("*, sections(name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("crops")
    .update({
      section_id: body.sectionId,
      crop_type: body.cropType,
      variety: body.variety,
      planted_hectares: body.plantedHectares,
      planting_date: body.plantingDate,
      expected_harvest: body.expectedHarvest,
      actual_harvest: body.actualHarvest,
      yield_kg: body.yieldKg,
      status: body.status,
      soil_type: body.soilType,
      irrigation_type: body.irrigationType,
      notes: body.notes,
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select("*, sections(name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { id } = await req.json();
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("crops")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create crop-applications API**

```tsx
// src/app/api/crop-applications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const cropId = req.nextUrl.searchParams.get("cropId");
  const db = getSupabaseAdmin();

  let query = db
    .from("crop_applications")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("date_applied", { ascending: false });

  if (cropId) query = query.eq("crop_id", cropId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("crop_applications")
    .insert({
      farm_id: result.farmId,
      crop_id: body.cropId,
      type: body.type,
      product_name: body.productName || null,
      dose_per_hectare: body.dosePerHectare || null,
      total_applied: body.totalApplied || null,
      date_applied: body.dateApplied || null,
      applied_by: body.appliedBy || null,
      weather_conditions: body.weatherConditions || null,
      notes: body.notes || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { id } = await req.json();
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("crop_applications")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/api/crops/route.ts src/app/api/crop-applications/route.ts
git commit -m "feat: add crops and crop-applications API routes"
```

---

### Task 9: Agricultura Page UI

**Files:**
- Create: `src/app/produccion/agricultura/page.tsx`

- [ ] **Step 1: Create the Agricultura page**

```tsx
// src/app/produccion/agricultura/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";

interface Crop {
  id: string;
  section_id: string | null;
  crop_type: string;
  variety: string | null;
  planted_hectares: number | null;
  planting_date: string | null;
  expected_harvest: string | null;
  actual_harvest: string | null;
  yield_kg: number | null;
  yield_per_hectare: number | null;
  status: string;
  soil_type: string | null;
  irrigation_type: string | null;
  notes: string | null;
  sections?: { name: string } | null;
  crop_applications?: { id: string }[];
}

interface CropApplication {
  id: string;
  crop_id: string;
  type: string;
  product_name: string | null;
  dose_per_hectare: string | null;
  total_applied: string | null;
  date_applied: string | null;
  applied_by: string | null;
  weather_conditions: string | null;
  notes: string | null;
}

const CROP_TYPES = ["soja", "trigo", "maíz", "girasol", "sorgo", "cebada", "arroz", "avena", "otro"];
const SOIL_TYPES = ["arcilloso", "arenoso", "limoso", "franco"];
const IRRIGATION_TYPES = ["secano", "pivot", "aspersión", "goteo"];
const APP_TYPES = ["fertilizante", "herbicida", "insecticida", "fungicida"];
const WEATHER_OPTIONS = ["soleado", "nublado", "lluvioso", "ventoso"];
const STATUS_COLORS: Record<string, string> = {
  planted: "bg-blue-500",
  growing: "bg-emerald-500",
  harvested: "bg-amber-500",
  failed: "bg-red-500",
};
const STATUS_LABELS: Record<string, string> = {
  planted: "Sembrado",
  growing: "Creciendo",
  harvested: "Cosechado",
  failed: "Fallido",
};

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function AgriculturaPage() {
  const { sections } = useFarm();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingCrop, setEditingCrop] = useState<Crop | null>(null);
  const [showAppForm, setShowAppForm] = useState<string | null>(null); // crop id
  const [applications, setApplications] = useState<Record<string, CropApplication[]>>({});

  // Form state
  const [cropType, setCropType] = useState("");
  const [variety, setVariety] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [plantedHa, setPlantedHa] = useState("");
  const [plantingDate, setPlantingDate] = useState("");
  const [expectedHarvest, setExpectedHarvest] = useState("");
  const [yieldKg, setYieldKg] = useState("");
  const [status, setStatus] = useState("planted");
  const [soilType, setSoilType] = useState("");
  const [irrigationType, setIrrigationType] = useState("");
  const [notes, setNotes] = useState("");

  // Application form state
  const [appType, setAppType] = useState("");
  const [appProduct, setAppProduct] = useState("");
  const [appDose, setAppDose] = useState("");
  const [appTotal, setAppTotal] = useState("");
  const [appDate, setAppDate] = useState("");
  const [appBy, setAppBy] = useState("");
  const [appWeather, setAppWeather] = useState("");
  const [appNotes, setAppNotes] = useState("");

  const loadCrops = useCallback(async () => {
    const res = await fetch("/api/crops");
    if (res.ok) setCrops(await res.json());
  }, []);

  useEffect(() => { loadCrops(); }, [loadCrops]);

  function resetForm() {
    setCropType(""); setVariety(""); setSectionId(""); setPlantedHa("");
    setPlantingDate(""); setExpectedHarvest(""); setYieldKg(""); setStatus("planted");
    setSoilType(""); setIrrigationType(""); setNotes("");
    setEditingCrop(null); setShowForm(false);
  }

  function resetAppForm() {
    setAppType(""); setAppProduct(""); setAppDose(""); setAppTotal("");
    setAppDate(""); setAppBy(""); setAppWeather(""); setAppNotes("");
    setShowAppForm(null);
  }

  function startEdit(crop: Crop) {
    setEditingCrop(crop);
    setCropType(crop.crop_type);
    setVariety(crop.variety || "");
    setSectionId(crop.section_id || "");
    setPlantedHa(crop.planted_hectares?.toString() || "");
    setPlantingDate(crop.planting_date || "");
    setExpectedHarvest(crop.expected_harvest || "");
    setYieldKg(crop.yield_kg?.toString() || "");
    setStatus(crop.status);
    setSoilType(crop.soil_type || "");
    setIrrigationType(crop.irrigation_type || "");
    setNotes(crop.notes || "");
    setShowForm(true);
  }

  async function handleSubmit() {
    const payload = {
      cropType, variety: variety || null, sectionId: sectionId || null,
      plantedHectares: plantedHa ? Number(plantedHa) : null,
      plantingDate: plantingDate || null, expectedHarvest: expectedHarvest || null,
      yieldKg: yieldKg ? Number(yieldKg) : null, status,
      soilType: soilType || null, irrigationType: irrigationType || null,
      notes: notes || null,
      ...(editingCrop ? { id: editingCrop.id } : {}),
    };
    await fetch("/api/crops", {
      method: editingCrop ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    resetForm();
    loadCrops();
  }

  async function handleDelete(id: string) {
    await fetch("/api/crops", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadCrops();
  }

  async function loadApplications(cropId: string) {
    const res = await fetch(`/api/crop-applications?cropId=${cropId}`);
    if (res.ok) {
      const data = await res.json();
      setApplications((prev) => ({ ...prev, [cropId]: data }));
    }
  }

  async function handleAddApplication(cropId: string) {
    await fetch("/api/crop-applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cropId, type: appType, productName: appProduct || null,
        dosePerHectare: appDose || null, totalApplied: appTotal || null,
        dateApplied: appDate || null, appliedBy: appBy || null,
        weatherConditions: appWeather || null, notes: appNotes || null,
      }),
    });
    resetAppForm();
    loadApplications(cropId);
    loadCrops(); // refresh application count
  }

  async function handleDeleteApplication(id: string, cropId: string) {
    await fetch("/api/crop-applications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadApplications(cropId);
    loadCrops();
  }

  // Stats
  const activeCrops = crops.filter((c) => c.status !== "harvested" && c.status !== "failed");
  const totalPlantedHa = activeCrops.reduce((sum, c) => sum + (c.planted_hectares || 0), 0);
  const pendingHarvests = crops.filter((c) => c.status === "growing" || (c.status === "planted" && c.expected_harvest)).length;

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Ha sembradas" value={totalPlantedHa} accent="emerald" />
        <StatCard label="Cultivos activos" value={activeCrops.length} accent="amber" />
        <StatCard label="Cosechas pendientes" value={pendingHarvests} accent="purple" />
        <StatCard label="Total cultivos" value={crops.length} accent="blue" />
      </div>

      {/* Add button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
        >
          + Nuevo Cultivo
        </button>
      </div>

      {/* Add/Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">{editingCrop ? "Editar Cultivo" : "Nuevo Cultivo"}</h3>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Tipo de cultivo" value={cropType} onChange={setCropType}
                options={CROP_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
              <Input label="Variedad" value={variety} onChange={setVariety} placeholder="DM 46i20 IPRO" />
              <Select label="Sección/Potrero" value={sectionId} onChange={setSectionId}
                options={sections.map((s) => ({ value: s.id, label: s.name }))} />
              <Input label="Hectáreas sembradas" value={plantedHa} onChange={setPlantedHa} type="number" />
              <Input label="Fecha siembra" value={plantingDate} onChange={setPlantingDate} type="date" />
              <Input label="Cosecha estimada" value={expectedHarvest} onChange={setExpectedHarvest} type="date" />
              <Input label="Rendimiento (kg)" value={yieldKg} onChange={setYieldKg} type="number" />
              <Select label="Estado" value={status} onChange={setStatus}
                options={Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
              <Select label="Tipo de suelo" value={soilType} onChange={setSoilType}
                options={SOIL_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
              <Select label="Riego" value={irrigationType} onChange={setIrrigationType}
                options={IRRIGATION_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
            </div>
            <div className="mt-3">
              <Input label="Notas" value={notes} onChange={setNotes} placeholder="Observaciones..." />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleSubmit} className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">
                {editingCrop ? "Guardar" : "Crear"}
              </button>
              <button onClick={resetForm} className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:bg-zinc-800">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Application form modal */}
      {showAppForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-bold mb-4">Nueva Aplicación</h3>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Tipo" value={appType} onChange={setAppType}
                options={APP_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
              <Input label="Producto" value={appProduct} onChange={setAppProduct} placeholder="Glifosato 48%" />
              <Input label="Dosis/ha" value={appDose} onChange={setAppDose} placeholder="2 L/ha" />
              <Input label="Total aplicado" value={appTotal} onChange={setAppTotal} placeholder="240 L" />
              <Input label="Fecha" value={appDate} onChange={setAppDate} type="date" />
              <Input label="Aplicado por" value={appBy} onChange={setAppBy} />
              <Select label="Clima" value={appWeather} onChange={setAppWeather}
                options={WEATHER_OPTIONS.map((w) => ({ value: w, label: w.charAt(0).toUpperCase() + w.slice(1) }))} />
              <Input label="Notas" value={appNotes} onChange={setAppNotes} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => handleAddApplication(showAppForm)} className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">
                Agregar
              </button>
              <button onClick={resetAppForm} className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:bg-zinc-800">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Crop cards */}
      {crops.length === 0 ? (
        <EmptyState icon="🌾" message="No hay cultivos registrados. Agregá uno para empezar." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {crops.map((crop) => (
            <div key={crop.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">
                  🌱 {crop.crop_type.charAt(0).toUpperCase() + crop.crop_type.slice(1)}
                  {crop.sections?.name ? ` — ${crop.sections.name}` : ""}
                </span>
                <span className={`${STATUS_COLORS[crop.status]} text-white text-[10px] px-2 py-0.5 rounded-full font-semibold`}>
                  {STATUS_LABELS[crop.status]}
                </span>
              </div>
              <div className="text-xs text-zinc-400 leading-relaxed">
                {crop.variety && <>Variedad: {crop.variety}<br /></>}
                {crop.planted_hectares && <>Hectáreas: {crop.planted_hectares} ha<br /></>}
                {crop.planting_date && <>Siembra: {new Date(crop.planting_date).toLocaleDateString("es-AR")}<br /></>}
                {crop.expected_harvest && <>Cosecha est.: {new Date(crop.expected_harvest).toLocaleDateString("es-AR")}<br /></>}
                {crop.yield_per_hectare && <>Rinde: {Math.round(crop.yield_per_hectare).toLocaleString()} kg/ha<br /></>}
                {crop.soil_type && <>Suelo: {crop.soil_type}<br /></>}
                {crop.irrigation_type && <>Riego: {crop.irrigation_type}<br /></>}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { loadApplications(crop.id); setShowAppForm(crop.id); }}
                  className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded hover:bg-zinc-700"
                >
                  + Aplicación
                </button>
                <button
                  onClick={() => startEdit(crop)}
                  className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded hover:bg-zinc-700"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(crop.id)}
                  className="text-xs bg-zinc-800 text-red-400 px-2 py-1 rounded hover:bg-zinc-700"
                >
                  Eliminar
                </button>
                <span className="text-xs text-zinc-600 ml-auto">
                  {crop.crop_applications?.length || 0} aplicaciones
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
npx next build
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/produccion/agricultura/page.tsx
git commit -m "feat: add Agricultura page with crop CRUD and application tracking"
```

- [ ] **Step 4: Visual review with /frontend-design**

Invoke `/frontend-design` to review the Agricultura page UI.

---

## Phase 3: Inventory Management

### Task 10: Inventory API Routes

**Files:**
- Create: `src/app/api/inventory/route.ts`
- Create: `src/app/api/inventory/movements/route.ts`

- [ ] **Step 1: Create inventory items API**

```tsx
// src/app/api/inventory/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("inventory_items")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("category")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("inventory_items")
    .insert({
      farm_id: result.farmId,
      name: body.name,
      category: body.category,
      unit: body.unit,
      current_stock: body.currentStock || 0,
      min_stock: body.minStock || null,
      cost_per_unit: body.costPerUnit || null,
      notes: body.notes || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("inventory_items")
    .update({
      name: body.name,
      category: body.category,
      unit: body.unit,
      min_stock: body.minStock,
      notes: body.notes,
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { id } = await req.json();
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("inventory_items")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create inventory movements API**

```tsx
// src/app/api/inventory/movements/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const itemId = req.nextUrl.searchParams.get("itemId");
  const db = getSupabaseAdmin();

  let query = db
    .from("inventory_movements")
    .select("*, inventory_items(name, unit), sections(name)")
    .eq("farm_id", result.farmId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (itemId) query = query.eq("item_id", itemId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();

  // Validate stock won't go negative for uso/pérdida
  if (body.type === "uso" || body.type === "pérdida") {
    const { data: item } = await db
      .from("inventory_items")
      .select("current_stock")
      .eq("id", body.itemId)
      .eq("farm_id", result.farmId)
      .single();

    if (item && item.current_stock + body.quantity < 0) {
      return NextResponse.json(
        { error: `Stock insuficiente. Disponible: ${item.current_stock}` },
        { status: 400 }
      );
    }
  }

  const { data, error } = await db
    .from("inventory_movements")
    .insert({
      farm_id: result.farmId,
      item_id: body.itemId,
      type: body.type,
      quantity: body.quantity, // positive for compra, negative for uso
      unit_cost: body.unitCost || null,
      section_id: body.sectionId || null,
      crop_id: body.cropId || null,
      cattle_id: body.cattleId || null,
      date: body.date || new Date().toISOString().split("T")[0],
      notes: body.notes || null,
    })
    .select("*, inventory_items(name, unit)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-create financial transaction for purchases
  if (body.type === "compra" && body.unitCost && data) {
    await db.from("financial_transactions").insert({
      farm_id: result.farmId,
      type: "egreso",
      category: "compra_insumo",
      description: `Compra: ${data.inventory_items?.name || "insumo"}`,
      amount: Math.abs(body.quantity * body.unitCost),
      currency: body.currency || "USD",
      date: body.date || new Date().toISOString().split("T")[0],
      section_id: body.sectionId || null,
      inventory_movement_id: data.id,
    });
  }

  return NextResponse.json(data);
}
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/api/inventory/route.ts src/app/api/inventory/movements/route.ts
git commit -m "feat: add inventory items and movements API routes with auto-financial linking"
```

---

### Task 11: Inventario Page UI

**Files:**
- Create: `src/app/gestion/inventario/page.tsx`

- [ ] **Step 1: Create the Inventario page**

This page follows the design mockup: low-stock alert banner, category filter pills, inventory table with status indicators, and movement registration modals. The full implementation follows the same patterns as the Agricultura page (form modals, CRUD operations, StatCard stats).

Create `src/app/gestion/inventario/page.tsx` with:
- Fetch items from `/api/inventory` on mount
- Category filter pills (Todos, Alimento, Semilla, Agroquímico, Medicamento, Combustible)
- Table with columns: Item, Stock, Mínimo, $/unidad, Estado (OK/Justo/Bajo)
- Low stock alert banner when items have `current_stock < min_stock`
- "Nuevo Item" form modal
- "Registrar Compra" form modal (creates movement with type=compra, positive quantity)
- "Registrar Uso" form modal (creates movement with type=uso, negative quantity, links to section/crop/cattle)
- Status logic: Bajo (red) when stock < min, Justo (yellow) when stock < 2×min, OK (green) otherwise

The component structure mirrors AgriculturaPage — local state management, modal forms, StatCard stats bar.

- [ ] **Step 2: Verify build**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
npx next build
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/gestion/inventario/page.tsx
git commit -m "feat: add Inventario page with stock tracking, alerts, and movement forms"
```

- [ ] **Step 4: Visual review with /frontend-design**

---

## Phase 4: Financial Tracking

### Task 12: Financial API Route

**Files:**
- Create: `src/app/api/financial/route.ts`

- [ ] **Step 1: Create financial transactions API**

```tsx
// src/app/api/financial/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const period = req.nextUrl.searchParams.get("period") || "30d";
  const db = getSupabaseAdmin();

  let dateFilter = new Date();
  if (period === "7d") dateFilter.setDate(dateFilter.getDate() - 7);
  else if (period === "30d") dateFilter.setDate(dateFilter.getDate() - 30);
  else if (period === "90d") dateFilter.setDate(dateFilter.getDate() - 90);
  else dateFilter.setFullYear(dateFilter.getFullYear() - 1);

  const { data, error } = await db
    .from("financial_transactions")
    .select("*, sections(name), crops(crop_type), cattle(category, breed)")
    .eq("farm_id", result.farmId)
    .gte("date", dateFilter.toISOString().split("T")[0])
    .order("date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  if (!body.amount || body.amount <= 0) {
    return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("financial_transactions")
    .insert({
      farm_id: result.farmId,
      type: body.type,
      category: body.category,
      description: body.description || null,
      amount: body.amount,
      currency: body.currency || "USD",
      date: body.date || new Date().toISOString().split("T")[0],
      section_id: body.sectionId || null,
      crop_id: body.cropId || null,
      cattle_id: body.cattleId || null,
      notes: body.notes || null,
    })
    .select("*, sections(name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("financial_transactions")
    .update({
      type: body.type,
      category: body.category,
      description: body.description,
      amount: body.amount,
      currency: body.currency,
      date: body.date,
      section_id: body.sectionId,
      crop_id: body.cropId,
      cattle_id: body.cattleId,
      notes: body.notes,
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select("*, sections(name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { id } = await req.json();
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("financial_transactions")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/api/financial/route.ts
git commit -m "feat: add financial transactions API route with period filtering"
```

---

### Task 13: Finanzas Page UI

**Files:**
- Create: `src/app/gestion/finanzas/page.tsx`

- [ ] **Step 1: Create the Finanzas page**

Create `src/app/gestion/finanzas/page.tsx` following the design mockup:
- Period selector: 7d / 30d / 90d / Año
- Summary cards: Ingresos (green), Egresos (red), Resultado (yellow — difference)
- Cost-per-unit breakdown section: cards per cattle batch and crop showing total cost, cost/head or cost/ha, category breakdown percentages
- Recent transactions list with type indicator (▲ green for ingreso, ▼ red for egreso)
- "Nueva Transacción" form modal with:
  - Type: ingreso/egreso
  - Category: dropdown (venta_ganado, venta_cosecha, compra_insumo, servicio, mano_obra, transporte, veterinario, maquinaria, otro)
  - Description, amount, currency (USD/UYU/ARS), date
  - Cost allocation: section, crop, cattle dropdowns
- Fetch cattle from `/api/cattle` and crops from `/api/crops` for allocation dropdowns
- Calculate income/expense/balance from transactions
- Calculate cost-per-unit by grouping egresos by cattle_id and crop_id

- [ ] **Step 2: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/gestion/finanzas/page.tsx
git commit -m "feat: add Finanzas page with cost-per-unit tracking and transaction management"
```

- [ ] **Step 3: Visual review with /frontend-design**

---

## Phase 5: Metrics Dashboard

### Task 14: Metrics API Route

**Files:**
- Create: `src/app/api/metrics/route.ts`

- [ ] **Step 1: Create metrics aggregation API**

```tsx
// src/app/api/metrics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const type = req.nextUrl.searchParams.get("type") || "general";
  const period = req.nextUrl.searchParams.get("period") || "90d";

  const db = getSupabaseAdmin();
  const farmId = result.farmId;

  let dateFrom = new Date();
  if (period === "30d") dateFrom.setDate(dateFrom.getDate() - 30);
  else if (period === "90d") dateFrom.setDate(dateFrom.getDate() - 90);
  else dateFrom.setFullYear(dateFrom.getFullYear() - 1);
  const dateStr = dateFrom.toISOString().split("T")[0];

  // Parallel queries
  const [
    cattleRes, sectionsRes, cropsRes, inventoryRes,
    financialRes, vaccinationsRes, healthRes
  ] = await Promise.all([
    db.from("cattle").select("*").eq("farm_id", farmId),
    db.from("sections").select("*").eq("farm_id", farmId),
    db.from("crops").select("*").eq("farm_id", farmId),
    db.from("inventory_items").select("*").eq("farm_id", farmId),
    db.from("financial_transactions").select("*").eq("farm_id", farmId).gte("date", dateStr),
    db.from("vaccinations").select("*").eq("farm_id", farmId),
    db.from("health_events").select("*").eq("farm_id", farmId).gte("date_occurred", dateStr),
  ]);

  const cattle = cattleRes.data || [];
  const sections = sectionsRes.data || [];
  const crops = cropsRes.data || [];
  const inventory = inventoryRes.data || [];
  const financial = financialRes.data || [];
  const vaccinations = vaccinationsRes.data || [];
  const healthEvents = healthRes.data || [];

  // Snapshot KPIs
  const totalHeads = cattle.reduce((s, c) => s + c.count, 0);
  const totalPlantedHa = crops.filter((c) => c.status !== "failed").reduce((s, c) => s + (c.planted_hectares || 0), 0);
  const totalSectionHa = sections.reduce((s, sec) => s + (sec.size_hectares || 0), 0);
  const lowStockItems = inventory.filter((i) => i.min_stock && i.current_stock < i.min_stock).length;
  const overdueVax = vaccinations.filter((v) => v.next_due && new Date(v.next_due) <= new Date()).length;
  const unresolvedHealth = healthEvents.filter((h) => !h.resolved).length;

  // Financial summary
  const income = financial.filter((f) => f.type === "ingreso").reduce((s, f) => s + f.amount, 0);
  const expenses = financial.filter((f) => f.type === "egreso").reduce((s, f) => s + f.amount, 0);
  const margin = income > 0 ? ((income - expenses) / income) * 100 : 0;

  // Livestock KPIs
  const stockingRate = totalSectionHa > 0 ? totalHeads / totalSectionHa : 0;
  const deaths = healthEvents.filter((h) => h.type === "muerte").reduce((s, h) => s + h.head_count, 0);
  const mortalityRate = totalHeads > 0 ? (deaths / (totalHeads + deaths)) * 100 : 0;

  // Crop KPIs
  const harvestedCrops = crops.filter((c) => c.status === "harvested" && c.yield_per_hectare);
  const avgYield = harvestedCrops.length > 0
    ? harvestedCrops.reduce((s, c) => s + (c.yield_per_hectare || 0), 0) / harvestedCrops.length
    : 0;

  // Monthly financial trend (group by month)
  const monthlyFinancial: Record<string, { income: number; expenses: number }> = {};
  for (const f of financial) {
    const month = f.date.substring(0, 7); // YYYY-MM
    if (!monthlyFinancial[month]) monthlyFinancial[month] = { income: 0, expenses: 0 };
    if (f.type === "ingreso") monthlyFinancial[month].income += f.amount;
    else monthlyFinancial[month].expenses += f.amount;
  }

  // Monthly health events trend
  const monthlyHealth: Record<string, number> = {};
  for (const h of healthEvents) {
    const month = h.date_occurred.substring(0, 7);
    monthlyHealth[month] = (monthlyHealth[month] || 0) + 1;
  }

  return NextResponse.json({
    snapshot: {
      totalHeads, totalPlantedHa, totalSectionHa, lowStockItems,
      overdueVax, unresolvedHealth, income, expenses, margin,
    },
    livestock: { stockingRate, mortalityRate, totalHeads },
    crops: { avgYield, harvestedCount: harvestedCrops.length, activeCrops: crops.filter((c) => c.status !== "harvested" && c.status !== "failed").length },
    trends: {
      financial: Object.entries(monthlyFinancial).sort().map(([month, data]) => ({ month, ...data })),
      health: Object.entries(monthlyHealth).sort().map(([month, count]) => ({ month, count })),
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/api/metrics/route.ts
git commit -m "feat: add metrics aggregation API route"
```

---

### Task 15: Métricas Page UI + Install Recharts

**Files:**
- Modify: `package.json` (add recharts)
- Create: `src/app/gestion/metricas/page.tsx`

- [ ] **Step 1: Install recharts**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
npm install recharts
```

- [ ] **Step 2: Create the Métricas page**

Create `src/app/gestion/metricas/page.tsx` following the design:
- Filter bar: Operation type toggle (General / Ganadería / Agricultura) + Period selector (30d / 90d / Año)
- Snapshot section ("Estado Actual"): StatCards for totalHeads, totalPlantedHa, lowStockItems, overdueVax, income, expenses, margin
- Trends section ("Tendencias"): 2x2 grid of Recharts bar charts:
  - Monthly financial (income vs expenses stacked bars)
  - Health events per month
  - Cost per head trend (from financial data grouped by cattle_id)
  - Yield per harvest (from crops data)
- Use `BarChart`, `Bar`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer` from recharts
- Dark theme styling: `fill="#34d399"` for income/positive, `fill="#f87171"` for expenses/negative
- Fetch from `/api/metrics?type=general&period=90d`

- [ ] **Step 3: Verify build**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
npx next build
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add package.json package-lock.json src/app/gestion/metricas/page.tsx
git commit -m "feat: add Métricas dashboard with Recharts visualizations"
```

- [ ] **Step 5: Visual review with /frontend-design**

---

## Phase 6: AI Integration

### Task 16: Extend AI System Prompt and Operations

**Files:**
- Modify: `src/lib/ai.ts`

This is the most critical task — it makes all new features voice-operable.

- [ ] **Step 1: Update getFarmContext to include new data**

In `src/lib/ai.ts`, modify the `getFarmContext` function to also fetch crops, inventory, and financial summary. Add these to the parallel Promise.all:

```typescript
// Add to the Promise.all in getFarmContext:
const [sectionsRes, cattleRes, activitiesRes, vaccinationsRes, healthRes, cropsRes, inventoryRes, financialRes] = await Promise.all([
  // ... existing queries ...
  db.from("crops").select("*, sections(name), crop_applications(id, type, product_name, date_applied)").eq("farm_id", farmId),
  db.from("inventory_items").select("*").eq("farm_id", farmId),
  db.from("financial_transactions").select("*").eq("farm_id", farmId).order("date", { ascending: false }).limit(10),
]);
```

Add context sections for crops:
```typescript
const crops = cropsRes.data || [];
if (crops.length > 0) {
  ctx += "\nCULTIVOS:\n";
  for (const c of crops) {
    ctx += `- crop_id="${c.id}" ${c.crop_type}`;
    if (c.variety) ctx += ` (${c.variety})`;
    if (c.sections?.name) ctx += ` en ${c.sections.name}`;
    ctx += ` ${c.planted_hectares || "?"}ha estado:${c.status}`;
    if (c.yield_per_hectare) ctx += ` rinde:${Math.round(c.yield_per_hectare)}kg/ha`;
    ctx += ` apps:${c.crop_applications?.length || 0}`;
    ctx += "\n";
  }
}
```

Add context for inventory:
```typescript
const inventoryItems = inventoryRes.data || [];
if (inventoryItems.length > 0) {
  ctx += "\nINVENTARIO:\n";
  for (const i of inventoryItems) {
    const status = i.min_stock && i.current_stock < i.min_stock ? "[BAJO]" : "";
    ctx += `- item_id="${i.id}" ${i.name} (${i.category}): ${i.current_stock} ${i.unit}`;
    if (i.min_stock) ctx += ` min:${i.min_stock}`;
    if (i.cost_per_unit) ctx += ` $${i.cost_per_unit}/${i.unit}`;
    ctx += ` ${status}\n`;
  }
}
```

Add context for recent financials:
```typescript
const financials = financialRes.data || [];
if (financials.length > 0) {
  const totalIncome = financials.filter(f => f.type === "ingreso").reduce((s, f) => s + f.amount, 0);
  const totalExpenses = financials.filter(f => f.type === "egreso").reduce((s, f) => s + f.amount, 0);
  ctx += `\nFINANZAS RECIENTES: Ingresos $${totalIncome}, Egresos $${totalExpenses}, Balance $${totalIncome - totalExpenses}\n`;
}
```

- [ ] **Step 2: Update the system prompt to include new tables and operations**

In the `systemPrompt` string inside `processMessage`, add the new tables after the existing ones:

```typescript
// Add after the existing table definitions in the system prompt:

crops: section_id (uuid|null), crop_type (text, e.g. soja/trigo/maíz/girasol), variety (text|null), planted_hectares (number), planting_date (ISO date|null), expected_harvest (ISO date|null), actual_harvest (ISO date|null), yield_kg (number|null), status ("planted"|"growing"|"harvested"|"failed"), soil_type (text|null), irrigation_type ("secano"|"pivot"|"aspersión"|"goteo"|null), notes (text|null)

crop_applications: crop_id (uuid), type ("fertilizante"|"herbicida"|"insecticida"|"fungicida"), product_name (text|null), dose_per_hectare (text|null), total_applied (text|null), date_applied (ISO date|null), applied_by (text|null), weather_conditions ("soleado"|"nublado"|"lluvioso"|"ventoso"|null), notes (text|null)

inventory_items: name (text), category ("alimento"|"semilla"|"fertilizante"|"agroquímico"|"medicamento"|"combustible"|"otro"), unit ("kg"|"L"|"dosis"|"unidad"), current_stock (number), min_stock (number|null), cost_per_unit (number|null), notes (text|null)

inventory_movements: item_id (uuid), type ("compra"|"uso"|"ajuste"|"pérdida"), quantity (number, positivo para compra, negativo para uso), unit_cost (number|null, solo para compra), section_id (uuid|null), crop_id (uuid|null), cattle_id (uuid|null), date (ISO date), notes (text|null)

financial_transactions: type ("ingreso"|"egreso"), category ("venta_ganado"|"venta_cosecha"|"compra_insumo"|"servicio"|"mano_obra"|"transporte"|"veterinario"|"maquinaria"|"otro"), description (text|null), amount (number, siempre positivo), currency ("USD"|"UYU"|"ARS"), date (ISO date), section_id (uuid|null), crop_id (uuid|null), cattle_id (uuid|null), inventory_movement_id (uuid|null), notes (text|null)
```

Also update the `executeOperations` function to recognize the new tables in the allowed tables check:

```typescript
// In executeOperations, update the farm_id check:
if (["sections", "cattle", "activities", "vaccinations", "health_events", "crops", "crop_applications", "inventory_items", "inventory_movements", "financial_transactions"].includes(op.table)) {
  data.farm_id = farmId;
}
```

- [ ] **Step 3: Update the DBOperation interface to include new tables**

```typescript
interface DBOperation {
  table: string; // Add: "crops" | "crop_applications" | "inventory_items" | "inventory_movements" | "financial_transactions"
  action: "insert" | "update" | "delete" | "upsert" | "move";
  data: Record<string, unknown>;
  match?: Record<string, unknown>;
  move_count?: number;
}
```

- [ ] **Step 4: Add Farm type to context injection**

In the `getFarmContext` function, also fetch and include the farm's operation_type:

```typescript
// At the start of getFarmContext, fetch the farm:
const { data: farm } = await db.from("farms").select("operation_type").eq("id", farmId).single();
ctx += `TIPO DE ESTABLECIMIENTO: ${farm?.operation_type || "livestock"}\n\n`;
```

- [ ] **Step 5: Verify build**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
npx next build
```

- [ ] **Step 6: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/lib/ai.ts
git commit -m "feat: extend AI system prompt with crops, inventory, financial operations"
```

---

## Phase 7: Final Integration

### Task 17: Update Sections API to Include Cattle (for FarmProvider)

**Files:**
- Modify: `src/app/api/sections/route.ts`

The FarmProvider needs sections to include cattle for the Inicio overview. Verify the sections GET already joins cattle:

- [ ] **Step 1: Check sections API returns cattle**

Read `src/app/api/sections/route.ts` and ensure the GET query includes `.select("*, cattle(*)")` or similar. If not, update it.

- [ ] **Step 2: Commit if changed**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add src/app/api/sections/route.ts
git commit -m "fix: ensure sections API includes cattle for overview"
```

---

### Task 18: Create Placeholder Pages for Incomplete Routes

**Files:**
- Create any missing page files that would cause 404s

- [ ] **Step 1: Verify all routes have pages**

Ensure these all exist and at minimum export a default component:
- `src/app/produccion/hacienda/page.tsx`
- `src/app/produccion/sanidad/page.tsx`
- `src/app/produccion/agricultura/page.tsx`
- `src/app/gestion/inventario/page.tsx`
- `src/app/gestion/finanzas/page.tsx`
- `src/app/gestion/metricas/page.tsx`
- `src/app/gestion/registro/page.tsx`
- `src/app/mapa/page.tsx`
- `src/app/chat/page.tsx`
- `src/app/setup/page.tsx`

- [ ] **Step 2: Full build verification**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
npx next build
```

Expected: Build succeeds with all routes accessible.

- [ ] **Step 3: Commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add -A
git commit -m "chore: verify all routes have pages, final build check"
```

---

### Task 19: Final Visual Review

- [ ] **Step 1: Run /frontend-design on the complete app**

Invoke `/frontend-design` to do a final review of:
- Navigation consistency across all pages
- Mobile responsiveness of new sections
- Color palette consistency (Zinc/Emerald theme)
- Form modal patterns match across all pages
- Empty states have helpful messages

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Final commit**

```bash
cd "/Users/maximolorenzoylosada/Documents/SU Generator/89_campo_ai"
git add -A
git commit -m "polish: visual refinements from frontend-design review"
```

---

## Summary

| Phase | Tasks | What It Delivers |
|-------|-------|-----------------|
| 1. Foundation | Tasks 1-7 | Migration, shared components, FarmProvider, NavBar, route-based navigation, setup with operation type |
| 2. Agriculture | Tasks 8-9 | Crop CRUD API + Agricultura page with planting, applications, harvest tracking |
| 3. Inventory | Tasks 10-11 | Inventory items/movements API + Inventario page with stock alerts and movement forms |
| 4. Financial | Tasks 12-13 | Financial transactions API + Finanzas page with cost-per-unit breakdown |
| 5. Metrics | Tasks 14-15 | Metrics aggregation API + Métricas page with Recharts visualizations |
| 6. AI | Task 16 | Extended AI system prompt — all new features voice-operable via WhatsApp/chat |
| 7. Integration | Tasks 17-19 | Final wiring, build verification, visual polish |
