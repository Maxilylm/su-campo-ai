# CampoAI Frontend Redesign: Professional & Luxury UX

**Date:** 2026-03-29
**Scope:** Frontend-only redesign. No architecture, API, or database changes.
**Aesthetic target:** Linear / Vercel / Stripe Dashboard — minimal, precise, confident.

---

## 1. Design System Foundation

### 1.1 Icon System
- Replace all emoji used as UI iconography with **Lucide React** icons (monochrome, 20px default, consistent stroke weight)
- Emoji is only permitted inside user-generated content (chat messages, notes displayed as quotes)
- Map: `🐄→Beef`, `🌾→Wheat`, `💉→Syringe`, `🏥→Heart`, `📦→Package`, `💰→DollarSign`, `📊→BarChart3`, `📋→ClipboardList`, `🐣→Egg`, `💀→Skull`, `🤒→Thermometer`, `🩹→BandageIcon`, `💊→Pill`, `🩺→Stethoscope`, `🔄→ArrowLeftRight`, `📝→FileText`, `⚙️→Settings`, `🏠→Home`, `🗺️→Map`, `💬→MessageSquare`, `⛽→Fuel`, `🧪→FlaskConical`, `🌱→Sprout`, `🥩→Drumstick`

### 1.2 Typography Scale (6 stops)
| Role | Class | Size |
|------|-------|------|
| Page title | `text-2xl font-semibold tracking-tight` | 28px |
| Section title | `text-lg font-medium` | 18px |
| Card title | `text-base font-medium` | 16px |
| Body | `text-sm` | 14px |
| Caption/label | `text-xs font-medium text-muted-foreground` | 12px |
| Overline | `text-[11px] uppercase tracking-wider font-semibold text-muted-foreground` | 11px |

### 1.3 Spacing Upgrade
- Card padding: `p-3`/`p-4` → `p-5`
- Section gaps: `space-y-6` → `space-y-8`
- Tag padding: `px-2 py-0.5` → `px-2.5 py-1`
- Page container: `max-w-6xl mx-auto px-6 py-6`

### 1.4 Semantic Color System
| Role | Color | Usage |
|------|-------|-------|
| Primary action | Emerald-600 | Buttons, active nav, links |
| Success | Emerald | Positive status tags only |
| Warning | Amber | Alerts, overdue indicators |
| Destructive | Red | Errors, delete, expenses |
| Info | Blue | Secondary tags, informational |
| Data viz | Emerald-400, Blue-400, Amber-400, Violet-400 | Charts only, never reused for UI states |

### 1.5 shadcn/ui Theme Variables
Configure `globals.css` with shadcn CSS variable system: `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring`, `--input`, etc. Mapped to the existing zinc/emerald dark palette plus a new light palette.

---

## 2. Navigation & Page Layout

### 2.1 Desktop Navigation
- **Dropdowns:** Replace `onMouseEnter`/`onMouseLeave` hover triggers with **click-to-open** using shadcn `DropdownMenu`. Click outside or press Escape to close.
- **Logo:** Replace `🌿 CampoAI` emoji with a gradient SVG logo mark (emerald gradient square with "C" initial) + clean "CampoAI" wordmark in `font-semibold text-sm tracking-tight`.
- **Farm badge:** Farm name displayed in a bordered badge with a green status dot. Replaces raw text + emoji operation type label.
- **User area:** Avatar circle (initial letter) with dropdown menu (Settings, Logout). Replaces bare "Salir" text link.
- **Theme toggle:** Sun/Moon icon button next to user avatar. Opens dropdown: Light, Dark, System.

### 2.2 Mobile Navigation
- **Bottom bar:** Replace emoji icons with Lucide icons (Home, Beef, BarChart3, Map, MessageSquare).
- **Sub-navigation fix:** The `SubTabBar` component is currently only rendered inside the `produccion/layout.tsx` and `gestion/layout.tsx` layouts. It must be visible on mobile (remove any `hidden sm:flex` or equivalent restriction). On mobile, SubTabBar renders as a horizontally scrollable pill bar pinned below the page header and above the content. This makes all sub-pages (Sanidad, Agricultura, Finanzas, Metricas, Registro) reachable from mobile.
- Bottom bar highlights the parent group; SubTabBar handles specific route.

### 2.3 Page Layout Template (All Pages)
Every page follows this structure:
1. **Breadcrumb** — `text-[11px] text-muted-foreground`. E.g., "Produccion / Hacienda"
2. **Page header** — Flex row: left side has title (`text-2xl font-semibold`) + optional description (`text-sm text-muted-foreground`); right side has primary action button(s)
3. **Content area** — Page-specific content below, separated by `mb-8`

Use shadcn `Breadcrumb` component.

---

## 3. Components & Interaction Patterns

### 3.1 Forms → Slide-over Drawers
- All "Add" and "Edit" forms open as a **right-side slide-over panel** using shadcn `Sheet` component.
- Sheet width: `sm:max-w-md` (448px) for simple forms, `sm:max-w-lg` (512px) for complex forms (cattle with 10+ fields).
- Sheet has: title, description, scrollable form body, sticky footer with Save/Cancel buttons.
- Page content underneath stays visible but dimmed. Scroll position preserved.
- On mobile: Sheet becomes full-screen bottom sheet.

### 3.2 Select → Searchable Combobox
- Replace all 6 duplicated native `<select>` + `Select` component definitions with **one shared** shadcn `Select` component (for short lists <8 items) or `Combobox` (for longer lists like sections, cattle, crops).
- Combobox includes search/filter input, keyboard navigation, section color dots for section selectors.
- Single shared component in `src/components/ui/`.

### 3.3 Tables → Data Tables
- All tables (cattle, inventory, transactions) use a standardized **DataTable** pattern:
  - Sortable column headers (click to toggle asc/desc)
  - Search/filter bar above the table
  - Pagination (20 rows per page) with page indicator and prev/next buttons
  - Row checkbox selection for future bulk actions
  - Row count display ("47 registros")
- Row actions: Replace inline "Editar"/"Eliminar" text links with a `•••` button that opens a shadcn `DropdownMenu` with Edit, Delete, and contextual actions.

### 3.4 Delete Confirmation
- All destructive actions (delete section, cattle, crop, inventory item, transaction) require confirmation via shadcn `AlertDialog`.
- Dialog shows: what will be deleted, "This action cannot be undone", Cancel + red "Delete" button.

### 3.5 Toast Notifications
- Install `sonner` (shadcn's recommended toast library).
- Show toast after every CRUD operation: "Seccion creada", "Hacienda actualizada", "Error al guardar" etc.
- Position: bottom-right. Auto-dismiss: 4 seconds. Success = green check icon. Error = red x icon.
- Replace the single `alert()` call in inventory with an error toast.

### 3.6 Loading → Skeleton Placeholders
- Replace all emoji + `animate-pulse` text loading states with shadcn `Skeleton` components.
- Skeletons mirror the actual page layout: stat card skeletons (rounded rectangles), table row skeletons, card skeletons.
- Initial app load (FarmProvider): skeleton of the dashboard layout, not a centered emoji.

### 3.7 Empty States
- Replace emoji + text empty states with: Lucide icon (muted color, 48px) + heading (`text-base font-medium`) + description (`text-sm text-muted-foreground`) + CTA button (primary style).
- Example: Lucide `Beef` icon + "Sin hacienda registrada" + "Registra tu primera hacienda para empezar el seguimiento." + "Agregar hacienda" button.

### 3.8 Animations & Transitions
- Sheet: slide in from right, 200ms ease-out
- DropdownMenu: fade + scale, 150ms
- AlertDialog: fade in backdrop + scale dialog, 150ms
- Toasts: slide up from bottom-right
- Skeleton → content: crossfade
- Route changes: top progress bar via `nprogress` (thin emerald bar at top of viewport)

---

## 4. Page-Specific Changes

### 4.1 Login
- **Layout:** Split — form on left (40%), gradient hero panel on right (60%). Mobile: form only, full-width.
- **Logo:** SVG logo mark + "CampoAI" wordmark. No emoji.
- **Form:** More padding (`p-8`), rounded-2xl. Clean input styling.
- **Hero panel:** Subtle gradient mesh background (emerald → zinc-900). Tagline + brief value prop text.
- **Theme toggle:** Visible on login page too.

### 4.2 Dashboard (Home)
- StatCards upgraded: left-aligned, Lucide icon, optional trend badge.
- Section cards: left-border accent using section color (4px solid border-left) instead of a 3px dot.
- Water/pasture status: proper `Badge` components instead of inline text.
- Welcome header: "Buenos dias, [email prefix]" with farm name and current date.

### 4.3 Hacienda
- Section list: collapsible accordion — click a section header to expand and see its cattle inline.
- Cattle: DataTable with sort, paginate, search, row action menu.
- Both "Add section" and "Add cattle" open Sheet drawers.

### 4.4 Sanidad
- Timeline-style layout: vertical line on the left connecting events chronologically.
- Overdue vaccinations: top-of-page shadcn `Alert` banner with `AlertTriangle` icon.
- Status toggle: "Resolver"/"Reabrir" becomes a proper status dropdown (Pendiente → En progreso → Resuelto).

### 4.5 Agricultura
- Crop cards: keep grid layout, upgrade spacing and add `•••` action menu.
- Application forms: open inside the crop's Sheet drawer as a nested section.
- Status badges: consistent tag system from design tokens.

### 4.6 Inventario
- Low stock alert: shadcn `Alert` with Lucide `AlertTriangle`.
- Inventory table: DataTable with sortable stock column, color-coded status.
- Category filter pills: consistent pill styling from design system.

### 4.7 Finanzas
- Transaction icons: Lucide `TrendingUp` (green) / `TrendingDown` (red) replace `▲`/`▼` text.
- Cost-per-unit cards: subtle progress bar showing % of total budget.
- New transaction form: Sheet drawer.

### 4.8 Metricas
- Filter bar: unchanged (already well-designed).
- Charts: axis labels, legend, tooltips styled to match new design tokens.
- KPI cards: upgraded StatCard with trend badges.

### 4.9 Registro
- Timeline component: vertical line on left, Lucide icons in muted circles at each node, timestamps right-aligned.
- Raw message quotes: left-border blockquote styling.

### 4.10 Chat
- Minimal changes — existing design is solid.
- Add subtle header: "Chat con CampoAI" + Lucide `Bot` icon.
- Suggested prompts: `Ghost` button styling with more padding.

### 4.11 Mapa
- No layout changes. Leaflet controls and tooltips get dark/light theme override improvements to match new zinc palette.

---

## 5. Light/Dark Mode & Theme System

### 5.1 Implementation
- Install `next-themes`. Wrap app in `ThemeProvider` with `attribute="class"` and `defaultTheme="dark"`.
- Theme toggle in nav bar: Lucide `Sun`/`Moon` icon button → dropdown with Light, Dark, System options.

### 5.2 Dark Palette (refined from current)
```
--background: #09090b
--foreground: #fafafa
--card: #18181b
--card-foreground: #fafafa
--muted: #27272a
--muted-foreground: #a1a1aa
--border: #27272a
--primary: #059669
--primary-foreground: #ffffff
--destructive: #dc2626
--accent: #27272a
```

### 5.3 Light Palette (new)
```
--background: #ffffff
--foreground: #09090b
--card: #f9fafb
--card-foreground: #09090b
--muted: #f4f4f5
--muted-foreground: #71717a
--border: #e4e4e7
--primary: #059669
--primary-foreground: #ffffff
--destructive: #dc2626
--accent: #f4f4f5
```

### 5.4 Theme-Dependent Overrides
- Leaflet map tooltip and control backgrounds need light-mode CSS variant.
- Chart tooltip background follows `--card` variable.
- All hardcoded zinc hex values in components must be replaced with CSS variable references or Tailwind semantic classes.

---

## 6. Dependencies to Add

| Package | Purpose |
|---------|---------|
| `shadcn/ui` CLI | Install component primitives |
| `@radix-ui/*` | Underlying primitives (installed by shadcn) |
| `lucide-react` | Icon system |
| `next-themes` | Light/dark mode |
| `sonner` | Toast notifications |
| `nprogress` | Route change progress bar |
| `class-variance-authority` | Component variant styling (shadcn dependency) |
| `clsx` + `tailwind-merge` | Conditional class composition (shadcn dependency) |

### shadcn Components to Install
`button`, `dropdown-menu`, `sheet`, `dialog`, `alert-dialog`, `select`, `combobox`, `input`, `label`, `badge`, `skeleton`, `alert`, `breadcrumb`, `table`, `tooltip`, `separator`, `avatar`, `command`

---

## 7. What Does NOT Change

- All API routes (`/api/*`) — untouched
- Supabase integration and auth flow logic — untouched
- FarmContext data model — untouched
- Database schema — untouched
- Leaflet map functionality — untouched
- Chat/audio recording logic — untouched
- Recharts library (stays, just re-themed)
- Business logic in all pages — untouched
- Spanish language — untouched
- Geist font family — untouched
