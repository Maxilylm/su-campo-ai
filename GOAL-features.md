# GOAL — CampoAI high-value features

The app is production-hardened and live (see `GOAL-hardening.md`). This goal adds **net-new
capabilities** that make CampoAI materially more useful to a working farmer. Ordered by
**value-to-effort** — the loop works top-to-bottom, one box per iteration.

**Scope:** the app only. Still $0 (Supabase + Groq + free no-key APIs). WhatsApp Business API
stays out of scope. Keep `build`/`lint`/`test` green every iteration. Features that change the DB
apply a new numbered migration in `supabase/` AND to the live project via Supabase MCP
(`apply_migration`, project `fdceixfggdpjoydqyvss`), then regenerate `supabase/full_setup.sql`.

**Grounding (verified 2026-06-13; capabilities expanded since then):** data for alerts exists (`vaccinations.next_due`,
`inventory_items.min_stock` vs `current_stock`, `health_events.resolved`, `crops.expected_harvest`).
`cmdk` is installed and wired into the global command palette. Section/padrón coordinates exist
(`map_center`, padrón `geometry`). Alerts, export, weather, offline reading, tasks and activity
history are now implemented; this file records the original feature loop and later hardening.

---

## Tier 1 — highest leverage, uses existing data, no schema change

- [x] **Alerts & reminders hub.** New `GET /api/alerts` aggregates: vaccinations due/overdue
      (`next_due` ≤ today+30d), low stock (`current_stock < min_stock`), unresolved `health_events`,
      upcoming harvests (`expected_harvest` ≤ today+30d). Render an alerts panel on the home page
      (`/`) and a count badge in `NavBar`. Each alert deep-links to the relevant page. No new tables.
      Value: turns passive data into action — the #1 reason a farmer opens the app daily.
      ✓ Done 2026-06-14: pure `buildAlerts()` (7 unit tests) + `/api/alerts`, `AlertsPanel` on home
      (severity colors, deep links), Bell badge in NavBar. 31 tests green, lint+build clean.

- [x] **Global command palette (⌘K / Ctrl+K).** Wire the already-installed `cmdk` into a
      `CommandDialog`: fuzzy-search across sections, cattle batches, crops, inventory items, plus
      quick-nav to every page and "nueva …" actions. Mount in `NavBar`, open on ⌘K. No schema.
      Value: instant navigation/lookup on a data-dense app; near-zero cost (dep already present).
      ✓ Done 2026-06-14: CommandPalette mounted in NavBar, ⌘K/Ctrl+K toggle, nav + lazy-loaded
      sections/inventory/crops groups, deep-link on select. Lint+build clean, 31 tests green.

- [x] **Data export & backup.** `GET /api/export` returns the full farm as JSON (all tables scoped
      to `farm_id`). Add per-module CSV export buttons (hacienda, finanzas, inventario, sanidad).
      A "Descargar respaldo" action on a settings/account menu. No schema.
      Value: trust + portability + DICOSE/accountant hand-off. Low effort.
      ✓ Done 2026-06-14: pure `toCSV()` (5 tests) + `/api/export` (full JSON backup, or per-table CSV
      via ?format=csv&table=, Content-Disposition attachment). Account dropdown gets Respaldo (JSON)
      + Hacienda/Sanidad/Inventario/Finanzas CSV — one tidy menu vs scattering buttons. 36 tests green.

- [x] **Sample data ("Probar con datos de ejemplo").** A one-click action on `/setup` (or empty
      dashboard) that seeds a realistic demo farm (sections, cattle, a crop, inventory, a few
      transactions, a due vaccination) for the current user via a server route. Clearly labeled;
      easy to wipe. No schema (uses existing tables).
      Value: new users see a populated, alive dashboard immediately — the biggest activation lever.
      ✓ Done 2026-06-14: pure `buildSampleData()` (4 tests, incl. referential-integrity + alert-trigger
      invariants) + `POST /api/sample-data` (creates farm if none, refuses if data exists, resolves
      section keys, dates chosen so Alerts panel lights up). "Probar con datos de ejemplo" on /setup.

## Tier 2 — high value, moderate effort (small schema / free external API)

- [x] **Printable reports (PDF via print).** Branded, print-CSS report pages: cattle inventory
      (DICOSE-style head counts by category/section), financial summary (income/expense/result by
      category + period), inventory valuation. "Imprimir / Guardar PDF" uses the browser print
      dialog (no lib, no cost). No schema.
      Value: farmers need paper for sales, vets, accountants, registry.
      ✓ Done 2026-06-14: pure aggregations in `reports.ts` (4 tests: cattle-by-category, finance
      summary, inventory valuation) + `/reportes` page (3 tabbed reports, window.print()) + @media
      print CSS hiding chrome. Linked in gestión nav + command palette. 44 tests green.

- [x] **Weather panel (Open-Meteo, free, no key).** Fetch current + 7-day forecast for the farm's
      coordinates (derive a centroid from padrón `geometry` / section `map_center`; fall back to a
      geocode of `farms.location`). Show a card on home + an "apto para pulverizar?" hint on
      agricultura (wind/rain heuristic). Server route to avoid CORS. May add `farms.lat/lng` columns
      (migration) if no coordinates exist yet.
      ✓ Done 2026-06-14: pure `weatherCodeLabel()` + `sprayAdvice()` (5 tests). `/api/weather`
      geocodes `farms.location` via Open-Meteo (no key, cached 30min/24h) → 7-day forecast; degrades
      gracefully (no_location/geocode_failed). `WeatherPanel` on home + agricultura with spray hint.
      No schema change needed (geocode-based). 49 tests green.

- [x] **AI weekly summary / proactive insights.** Reuse `getFarmContext()` → one Groq call →
      a "Resumen semanal" card on home: what changed, what needs attention, one suggestion. Cache
      the latest summary (new `farm_insights` table or a column) so it's not regenerated per load.
      Value: the AI becomes proactive, not just reactive to chat. Flashy, cheap (1 call/week).
      ✓ Done 2026-06-14: migration 008 (farm_insights, unique per farm) applied to LIVE Supabase via
      MCP + full_setup.sql regenerated (15 tables). `generateFarmSummary()` reuses getFarmContext →
      Groq. `/api/insights` (GET cache-only, POST explicitly generates) + `InsightsCard` on home
      with "Generar resumen"/"Actualizar". Pure `isStale()` helper (4 tests). 53 tests green.

- [x] **Cattle weight & gain tracking.** New `weight_records` table (cattle_id, date, weight_kg).
      Log weights over time; compute ADG (average daily gain) per batch; small trend chart on the
      hacienda batch detail. Migration + applied to live DB + full_setup.sql regenerated.
      Value: weight gain is the core productivity metric for livestock.
      ✓ Done 2026-06-14: migration 009 (weight_records) applied to LIVE Supabase via MCP +
      full_setup.sql regenerated (16 tables). Pure `computeADG()`/`sortByDate()` (6 tests).
      `/api/weight` (GET history, POST + syncs cattle.weight_kg to latest). Dedicated `/produccion/peso`
      page: batch selector, GMD stat, recharts trend, log form, history. Linked in nav + palette. 59 tests.

## Done criteria (verify, then stop the loop)
- [x] Every Tier 1 + Tier 2 box checked; `build`/`lint`/`test` all green. ✓ 123 tests, lint+build clean.
- [x] Initial schema changes 008–009 are reflected in `supabase/full_setup.sql`; later hardening
      migrations are also included there. `014_tasks.sql` remains safe to apply separately when
      a deployment has not enabled the optional agenda table yet.
- [x] Deployed to Vercel prod; `/api/status` still `{ok:true}`; spot-check new routes respond.
      ✓ https://89campoai.vercel.app — status {ok:true,supabase:true,groq:true}; /reportes /produccion/peso 307, /login 200.
- [x] `strategy.md` gets a "CampoAI features" learnings entry. ✓ Added.

## Backlog (NOT loop targets yet — bigger / needs product decisions)
- [x] **PWA instalable + lectura offline.** Manifest, service worker y snapshot privado por usuario
      para consultar el último panel, la agenda, el registro de actividad y el índice de búsqueda
      sincronizados durante cortes de conexión. Las vistas quedan explícitamente en modo lectura y
      no cachean respuestas API en el service worker.
      ✓ Done 2026-08-14: indicador de conexión, fallback del dashboard y shell instalable publicados.
- [x] **Tasks / to-do with due dates linked to sections/cattle.** Implemented with migration 014,
  agenda UI, alerts, calendar, AI context, demo seed, export fallback and quick completion from
  Pendientes. Apply `supabase/014_tasks.sql` to activate persistence on a deployment.
- [x] **Offline connection UX + recent activity.** Global read-only connection banner with retry,
  recent activity panel on Inicio, and debounced full snapshot refresh after mutations so the
  offline fallback does not preserve stale farm, section or alert data.
- [x] **Resultado por sección.** Reporte financiero por sección y moneda, con movimientos sin
  asignar visibles para evitar atribuciones engañosas; los costos por cultivo y lote ya están
  disponibles en Finanzas.
- Multi-user farm sharing with roles (invite workers) — auth + RLS work.

---

## Loop protocol
Each iteration: (1) read this file, (2) pick the **first unchecked box**, (3) implement it,
(4) verify `npm run build` + `npm run lint` + `npm test` (add tests for any new pure logic),
(5) for schema changes: write `supabase/00N_*.sql`, apply via Supabase MCP to project
`fdceixfggdpjoydqyvss`, regenerate `full_setup.sql`, (6) check the box and commit with a
descriptive message, (7) when all Tier 1+2 boxes are checked, deploy to Vercel prod, update
`strategy.md`, and **end the loop**. Keep commits small (one feature per commit). $0 only; never
build WhatsApp Business API.
