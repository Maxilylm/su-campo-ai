# CampoAI Expansion — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Scope:** Add agricultural settings, inventory management, financial tracking, and metrics dashboard to CampoAI

---

## 1. Overview

Evolve CampoAI from a livestock-only MVP into a configurable farm management platform supporting livestock, crop, and mixed operations. Four new sections are added as independent tabs, integrated through shared data models and a unified AI chat interface.

### Priority Order
1. Agricultural settings & crop management (foundation — changes farm profile)
2. Inventory management (consumable inputs — feeds into financials)
3. Financial tracking (cost-per-unit — depends on inventory + production data)
4. Metrics dashboard (read-only aggregation — depends on everything else)

### Key Decisions

| Decision | Answer |
|----------|--------|
| Operation types | Configurable: livestock, crops, or mixed |
| Adaptation depth | Structural — different data models, metrics, AI capabilities per type |
| Financial model | Cost-per-unit tracking (profitability per herd/crop/section) |
| Inventory scope | Consumable inputs only (feed, seeds, fertilizer, medicine, fuel) |
| Metrics dashboard | Snapshot (current state) + historical trends |
| AI/WhatsApp integration | Full — all new features voice-operable |
| Offline support | Not needed now |
| Charting library | Recharts (lightweight, React-native, Next.js compatible) |

---

## 2. Architecture: Grouped Navigation

The current single-page 6-tab monolith (`page.tsx`, 19KB) is restructured into grouped, route-based navigation with lazy loading per section.

### Navigation Groups

**Top-level navigation:**
- **Inicio** — Enhanced overview with snapshot metrics
- **Producción ▾** — Hacienda, Sanidad, Agricultura (sub-tabs adapt to operation type)
- **Gestión ▾** — Inventario, Finanzas, Métricas, Registro
- **Mapa** — Standalone
- **Chat AI** — Standalone

**Desktop:** Top nav bar with dropdown menus for Producción and Gestión.
**Mobile:** Bottom tab bar (5 items). Tapping Producción or Gestión opens a sub-tab bar.

### Route Structure

```
src/app/
├── page.tsx              ← Inicio (summary dashboard)
├── layout.tsx            ← Shared nav + auth + FarmProvider context
├── setup/page.tsx        ← Farm creation + operation type selector
├── produccion/
│   ├── layout.tsx        ← Sub-tab bar (adapts to operation_type)
│   ├── hacienda/page.tsx ← Extracted from current page.tsx
│   ├── sanidad/page.tsx  ← Extracted from current page.tsx
│   └── agricultura/page.tsx ← NEW
├── gestion/
│   ├── layout.tsx        ← Sub-tab bar
│   ├── inventario/page.tsx  ← NEW
│   ├── finanzas/page.tsx    ← NEW
│   ├── metricas/page.tsx    ← NEW
│   └── registro/page.tsx    ← Extracted from current page.tsx
├── mapa/page.tsx         ← Extracted (FarmMap component stays)
├── chat/page.tsx         ← Extracted from current page.tsx
└── login/page.tsx        ← Unchanged
```

### Shared State: FarmProvider Context

Root `layout.tsx` wraps everything in a `FarmProvider` that holds:
- `farm` — id, name, operation_type, total_hectares
- `sections` — all sections (shared across Hacienda, Agricultura, Mapa, Inventario)
- `refreshFarm()` — refetch after mutations

Each page fetches its own domain data independently. Only farm + sections are shared.

---

## 3. Farm Profile & Operation Types

### Database Change

```sql
ALTER TABLE farms ADD COLUMN operation_type TEXT NOT NULL DEFAULT 'livestock';
-- values: 'livestock', 'crops', 'mixed'
-- Existing farms auto-default to 'livestock' (backwards compatible)
```

### Setup Flow

Farm creation adds a second step: operation type selection (Ganadería / Agricultura / Mixto). This determines which navigation sections are visible and which AI capabilities are active.

### Adaptation Matrix

| Feature | 🐄 Ganadería | 🌾 Agricultura | 🐄🌾 Mixto |
|---------|:---:|:---:|:---:|
| Hacienda (livestock) | ✓ | ✗ | ✓ |
| Sanidad (health/vaccines) | ✓ | ✗ | ✓ |
| Agricultura (crops) | ✗ | ✓ | ✓ |
| Inventario (inputs) | ✓ feed, medicine | ✓ seeds, fertilizer | ✓ all |
| Finanzas (cost tracking) | ✓ per head | ✓ per hectare | ✓ both |
| Métricas (KPIs) | ✓ livestock KPIs | ✓ crop KPIs | ✓ combined |
| Mapa | ✓ | ✓ | ✓ |
| Chat AI context | ✓ livestock ops | ✓ crop ops | ✓ all ops |

---

## 4. Agricultura (Crop Management)

### New Tables

```sql
CREATE TABLE crops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms ON DELETE CASCADE,
  section_id UUID REFERENCES sections ON DELETE SET NULL,
  crop_type TEXT,          -- soja, trigo, maíz, girasol, sorgo, cebada, arroz
  variety TEXT,            -- seed variety/cultivar
  planted_hectares NUMERIC,
  planting_date DATE,
  expected_harvest DATE,
  actual_harvest DATE,
  yield_kg NUMERIC,
  yield_per_hectare NUMERIC GENERATED ALWAYS AS (yield_kg / NULLIF(planted_hectares, 0)) STORED,
  status TEXT DEFAULT 'planted',  -- planted, growing, harvested, failed
  soil_type TEXT,          -- arcilloso, arenoso, limoso, franco
  irrigation_type TEXT,    -- secano, pivot, aspersión, goteo
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crop_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms ON DELETE CASCADE,
  crop_id UUID REFERENCES crops ON DELETE CASCADE,
  type TEXT,               -- fertilizante, herbicida, insecticida, fungicida
  product_name TEXT,
  dose_per_hectare TEXT,   -- e.g. "2 L/ha"
  total_applied TEXT,
  date_applied DATE,
  applied_by TEXT,
  weather_conditions TEXT, -- soleado, nublado, lluvioso, ventoso
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### UI

- Stats bar: ha planted, active crops, pending harvests, scheduled applications
- Crop cards (mirror existing section cards pattern): crop type, variety, section, dates, yield, status badge, application count
- Status flow: planted → growing → harvested | failed
- Sections are shared between livestock and crops (a potrero can have both)

### API Routes

- `GET/POST /api/crops` — list & create crops
- `PUT/DELETE /api/crops` — update & delete crops
- `GET/POST /api/crop-applications` — list & create applications
- `DELETE /api/crop-applications` — delete application

### AI Chat Integration

- "Sembré 120 hectáreas de soja DM 46i20 en el Norte" → creates crop linked to section
- "Apliqué glifosato 2 litros por hectárea en la soja del Norte, día soleado" → creates application with weather
- "Cosechamos el trigo del Sur, rindió 256 toneladas" → updates status + yield
- "¿Qué tengo sembrado?" → lists active crops

---

## 5. Inventario (Consumable Inputs)

### New Tables

```sql
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,    -- alimento, semilla, fertilizante, agroquímico, medicamento, combustible, otro
  unit TEXT NOT NULL,        -- kg, L, dosis, unidad
  current_stock NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC,        -- alert threshold
  cost_per_unit NUMERIC,    -- latest purchase price (feeds into Finanzas)
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms ON DELETE CASCADE,
  item_id UUID REFERENCES inventory_items ON DELETE CASCADE,
  type TEXT NOT NULL,        -- compra, uso, ajuste, pérdida
  quantity NUMERIC NOT NULL, -- positive for compra/ajuste, negative for uso/pérdida (sign convention enforced by API)
  unit_cost NUMERIC,        -- price per unit (compra only)
  total_cost NUMERIC GENERATED ALWAYS AS (quantity * COALESCE(unit_cost, 0)) STORED,
  section_id UUID REFERENCES sections,  -- where it was used (cost allocation)
  crop_id UUID REFERENCES crops,        -- which crop consumed it
  cattle_id UUID REFERENCES cattle,     -- which herd consumed it
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Triggers:**
- On `inventory_movements` INSERT: update `inventory_items.current_stock` by adding `quantity`
- On `inventory_movements` INSERT WHERE type='compra': update `inventory_items.cost_per_unit` to `unit_cost`

### UI

- Low stock alert banner (items where `current_stock < min_stock`)
- Category filter pills: Todos, Alimento, Semilla, Agroquímico, Medicamento, Combustible
- Table: item name, current stock, minimum, cost/unit, status (OK/Justo/Bajo)
- Three-state status: OK (green, stock > 2× min), Justo (yellow, stock > min), Bajo (red, stock < min)
- Actions: Nuevo Item, Registrar Compra, Registrar Uso

### Cross-Section Integration

- **→ Agricultura:** crop_application logs can auto-deduct from inventory
- **→ Sanidad:** vaccination records can auto-deduct medicine doses
- **→ Finanzas:** every `compra` movement auto-creates an egreso transaction; `uso` movements allocate costs to sections/crops/herds
- **→ Métricas:** consumption trends, cost trends, restock frequency

### API Routes

- `GET/POST /api/inventory` — list & create items
- `PUT/DELETE /api/inventory` — update & delete items
- `GET/POST /api/inventory/movements` — list & create movements

### AI Chat Integration

- "Compré 1000 kilos de ración a 280 pesos el kilo" → creates/updates item + compra movement
- "Usé 50 litros de gasoil en el potrero Norte" → uso movement allocated to section
- "¿Cuánta ración me queda?" → returns current_stock
- "¿Qué me falta comprar?" → items where current_stock < min_stock

---

## 6. Finanzas (Cost-Per-Unit Tracking)

### New Table

```sql
CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms ON DELETE CASCADE,
  type TEXT NOT NULL,          -- ingreso, egreso
  category TEXT NOT NULL,      -- venta_ganado, venta_cosecha, compra_insumo, servicio, mano_obra, transporte, veterinario, maquinaria, otro
  description TEXT,
  amount NUMERIC NOT NULL,     -- always positive; type determines sign
  currency TEXT DEFAULT 'USD', -- USD, UYU, ARS
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Cost allocation (at least one should be set for egresos)
  section_id UUID REFERENCES sections,
  crop_id UUID REFERENCES crops,
  cattle_id UUID REFERENCES cattle,
  -- Link to inventory if this was a purchase
  inventory_movement_id UUID REFERENCES inventory_movements,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Design decision:** Single table for income and expenses, differentiated by `type`. Balance = `SUM(CASE WHEN type='ingreso' THEN amount ELSE -amount END)`. No double-entry accounting complexity.

### Cost Flow Sources

1. **Inventory** — every `compra` movement auto-creates an egreso; `uso` movements allocate existing cost
2. **Sanidad** — vet visits/treatments logged as egresos (category: veterinario)
3. **Chat AI** — direct voice entry for standalone expenses/income
4. **Manual** — dashboard form for labor, machinery, transport, etc.

### UI

- Period selector: 7d / 30d / 90d / Año
- Summary cards: Ingresos (green), Egresos (red), Resultado (yellow)
- Cost-per-unit breakdown cards per productive unit (herd or crop): total cost, cost/head or cost/ha, category breakdown percentages
- Recent transactions list with type indicator (▲ income, ▼ expense)
- Multi-currency: USD, UYU, ARS

### Cost-Per-Unit Calculation

- **Livestock:** `SUM(egresos WHERE cattle_id = X) / cattle.count` = cost per head
- **Crops:** `SUM(egresos WHERE crop_id = X) / crop.planted_hectares` = cost per hectare

### API Routes

- `GET/POST /api/financial` — list & create transactions
- `PUT/DELETE /api/financial` — update & delete transactions

### AI Chat Integration

- "Vendí 10 novillos a 4,250 dólares cada uno" → ingreso (venta_ganado), $42,500
- "Pagué 50 mil pesos de flete" → egreso (transporte), $50,000 UYU
- "¿Cuánto me está costando cada cabeza del lote del Norte?" → aggregated cost per head
- "¿Cuánto gasté este mes?" → SUM egresos for current month

---

## 7. Métricas (KPIs & Dashboard)

### Architecture

No new tables. Métricas is a **read-only aggregation layer** that queries existing tables. All KPIs are computed at query time from: cattle, crops, crop_applications, inventory_items, inventory_movements, financial_transactions, vaccinations, health_events.

### UI Layout

**Snapshot (top):** Current state alert KPIs
- Total heads, planted ha, low stock items, overdue vaccinations
- Financial summary: income, expenses, margin for selected period

**Trends (bottom):** Historical charts (Recharts)
- Cost per head (monthly bar chart)
- Yield per ha (per harvest bar chart)
- Inventory consumption (monthly bar chart)
- Health events per month (bar chart with mortality rate)

### Filter Controls
- Operation type toggle: General / Ganadería / Agricultura
- Period selector: 30d / 90d / Año

### KPIs by Operation Type

**🐄 Ganadería:**
- Stocking rate (heads/ha)
- Cost per head per batch
- Mortality rate (%)
- Pregnancy rate (%)
- Weight gain (kg/month)
- Vaccination compliance (on time vs overdue)
- Health events per month

**🌾 Agricultura:**
- Yield per ha per crop
- Cost per ha per crop
- Gross margin per ha
- Planted vs available hectares
- Applications per crop
- Pending harvests
- Yield vs historical average

### API Route

- `GET /api/metrics?type=general|livestock|crops&period=30d|90d|year` — returns computed KPIs + chart data

### AI Chat Integration

- "¿Cómo va el campo?" → natural language snapshot
- "¿Cuál es mi carga animal?" → total heads / total hectares
- "¿Qué cultivo me rindió mejor?" → compares yield_per_hectare across harvested crops
- "¿Cuánto gasté en sanidad este año?" → aggregated health expenses

---

## 8. AI System Prompt Updates

The AI system prompt in `src/lib/ai.ts` must be extended to:

1. Include farm `operation_type` in context
2. Add crop data to context injection (for crops/mixed farms)
3. Add inventory items + current stock levels to context
4. Add recent financial summary to context
5. Recognize new intents: crop operations, inventory operations, financial operations, metric queries
6. New DB operations: insert/update/delete on crops, crop_applications, inventory_items, inventory_movements, financial_transactions
7. Understand currency context (pesos = UYU/ARS, dólares = USD)

---

## 9. Database Migrations

New migration file: `007_expansion.sql`

Contains:
1. `ALTER TABLE farms ADD COLUMN operation_type`
2. `CREATE TABLE crops`
3. `CREATE TABLE crop_applications`
4. `CREATE TABLE inventory_items`
5. `CREATE TABLE inventory_movements`
6. `CREATE TABLE financial_transactions`
7. Triggers for inventory stock updates
8. RLS policies for all new tables (same pattern as existing: `farm_id` matches authenticated user's farm)

---

## 10. Visual Design & UX Review Process

All UI components for this expansion must be reviewed using the `/frontend-design` skill before being considered complete. This applies to:

- Navigation bar (desktop + mobile) redesign
- Farm setup flow (operation type selector)
- Agricultura tab (crop cards, application forms)
- Inventario tab (stock table, alert banners, movement forms)
- Finanzas tab (summary cards, cost-per-unit breakdowns, transaction list)
- Métricas tab (KPI cards, Recharts visualizations, filter controls)

**Process:** After each section's functionality is implemented, invoke `/frontend-design` to review visual design, layout, spacing, color usage, responsiveness, and overall UX quality. The skill focuses purely on design polish — not architecture or logic.

The existing dark theme (Zinc/Emerald palette) and design patterns (cards, badges, tables, emoji icons) should be maintained for consistency. New sections should feel like a natural extension of the existing app, not a bolted-on addition.

---

## 11. Error Handling

- All new API routes follow existing patterns: auth check → farm validation → operation → activity log
- Inventory movements that would make stock negative are rejected (API returns 400)
- Financial transactions require `amount > 0`
- Crop `yield_per_hectare` handles division by zero via `NULLIF`
- AI operations that fail leave a clear error in the chat response (no silent failures)

---

## 12. What's NOT in Scope

- Offline mode
- PDF report generation
- Breeding/genetics tracking
- Market price integrations
- Multi-user/role support
- Output tracking (harvested grain, milk, wool as separate inventory)
- Equipment/asset management
- Double-entry accounting
- Weather API integration (weather is manual text input on crop applications)
