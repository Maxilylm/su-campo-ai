# GOAL — CampoAI high-value features

The app is production-hardened and live (see `GOAL-hardening.md`). This goal adds **net-new
capabilities** that make CampoAI materially more useful to a working farmer. Ordered by
**value-to-effort** — the loop works top-to-bottom, one box per iteration.

**Scope:** the app only. Still $0 (Supabase + Groq + free no-key APIs). WhatsApp Business API
stays out of scope. Keep `build`/`lint`/`test` green every iteration. Features that change the DB
apply a new numbered migration in `supabase/` AND to the live project via Supabase MCP
(`apply_migration`, project `fdceixfggdpjoydqyvss`), then regenerate `supabase/full_setup.sql`.

**Grounding (verified 2026-06-13):** data for alerts already exists (`vaccinations.next_due`,
`inventory_items.min_stock` vs `current_stock`, `health_events.resolved`, `crops.expected_harvest`).
`cmdk` is installed (`components/ui/command.tsx`) but unused. Section/padrón coordinates exist
(`map_center`, padrón `geometry`). No alerts/export/reminder/weather features exist yet.

---

## Tier 1 — highest leverage, uses existing data, no schema change

- [x] **Alerts & reminders hub.** New `GET /api/alerts` aggregates: vaccinations due/overdue
      (`next_due` ≤ today+30d), low stock (`current_stock < min_stock`), unresolved `health_events`,
      upcoming harvests (`expected_harvest` ≤ today+30d). Render an alerts panel on the home page
      (`/`) and a count badge in `NavBar`. Each alert deep-links to the relevant page. No new tables.
      Value: turns passive data into action — the #1 reason a farmer opens the app daily.
      ✓ Done 2026-06-14: pure `buildAlerts()` (7 unit tests) + `/api/alerts`, `AlertsPanel` on home
      (severity colors, deep links), Bell badge in NavBar. 31 tests green, lint+build clean.

- [ ] **Global command palette (⌘K / Ctrl+K).** Wire the already-installed `cmdk` into a
      `CommandDialog`: fuzzy-search across sections, cattle batches, crops, inventory items, plus
      quick-nav to every page and "nueva …" actions. Mount in `NavBar`, open on ⌘K. No schema.
      Value: instant navigation/lookup on a data-dense app; near-zero cost (dep already present).

- [ ] **Data export & backup.** `GET /api/export` returns the full farm as JSON (all tables scoped
      to `farm_id`). Add per-module CSV export buttons (hacienda, finanzas, inventario, sanidad).
      A "Descargar respaldo" action on a settings/account menu. No schema.
      Value: trust + portability + DICOSE/accountant hand-off. Low effort.

- [ ] **Sample data ("Probar con datos de ejemplo").** A one-click action on `/setup` (or empty
      dashboard) that seeds a realistic demo farm (sections, cattle, a crop, inventory, a few
      transactions, a due vaccination) for the current user via a server route. Clearly labeled;
      easy to wipe. No schema (uses existing tables).
      Value: new users see a populated, alive dashboard immediately — the biggest activation lever.

## Tier 2 — high value, moderate effort (small schema / free external API)

- [ ] **Printable reports (PDF via print).** Branded, print-CSS report pages: cattle inventory
      (DICOSE-style head counts by category/section), financial summary (income/expense/result by
      category + period), inventory valuation. "Imprimir / Guardar PDF" uses the browser print
      dialog (no lib, no cost). No schema.
      Value: farmers need paper for sales, vets, accountants, registry.

- [ ] **Weather panel (Open-Meteo, free, no key).** Fetch current + 7-day forecast for the farm's
      coordinates (derive a centroid from padrón `geometry` / section `map_center`; fall back to a
      geocode of `farms.location`). Show a card on home + an "apto para pulverizar?" hint on
      agricultura (wind/rain heuristic). Server route to avoid CORS. May add `farms.lat/lng` columns
      (migration) if no coordinates exist yet.
      Value: weather drives spraying, harvest, and animal-welfare decisions daily.

- [ ] **AI weekly summary / proactive insights.** Reuse `getFarmContext()` → one Groq call →
      a "Resumen semanal" card on home: what changed, what needs attention, one suggestion. Cache
      the latest summary (new `farm_insights` table or a column) so it's not regenerated per load.
      Value: the AI becomes proactive, not just reactive to chat. Flashy, cheap (1 call/week).

- [ ] **Cattle weight & gain tracking.** New `weight_records` table (cattle_id, date, weight_kg).
      Log weights over time; compute ADG (average daily gain) per batch; small trend chart on the
      hacienda batch detail. Migration + applied to live DB + full_setup.sql regenerated.
      Value: weight gain is the core productivity metric for livestock.

## Done criteria (verify, then stop the loop)
- [ ] Every Tier 1 + Tier 2 box checked; `build`/`lint`/`test` all green.
- [ ] Any schema change applied to live Supabase and reflected in `supabase/full_setup.sql`.
- [ ] Deployed to Vercel prod; `/api/status` still `{ok:true}`; spot-check new routes respond.
- [ ] `strategy.md` gets a "CampoAI features" learnings entry.

## Backlog (NOT loop targets yet — bigger / needs product decisions)
- PWA (installable + offline read) — manifest + service worker.
- Tasks / to-do with due dates linked to sections/cattle.
- Multi-user farm sharing with roles (invite workers) — auth + RLS work.
- Profitability per section/crop/batch (cost-per-head, margin analysis).

---

## Loop protocol
Each iteration: (1) read this file, (2) pick the **first unchecked box**, (3) implement it,
(4) verify `npm run build` + `npm run lint` + `npm test` (add tests for any new pure logic),
(5) for schema changes: write `supabase/00N_*.sql`, apply via Supabase MCP to project
`fdceixfggdpjoydqyvss`, regenerate `full_setup.sql`, (6) check the box and commit with a
descriptive message, (7) when all Tier 1+2 boxes are checked, deploy to Vercel prod, update
`strategy.md`, and **end the loop**. Keep commits small (one feature per commit). $0 only; never
build WhatsApp Business API.
