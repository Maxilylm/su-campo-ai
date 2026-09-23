# GOAL — Field operations: where things are, and what to do today

Features (`GOAL-features.md`), hardening (`GOAL-hardening.md`), UX (`GOAL.md`) and the September
security audit (`GOAL-audit-2026-09.md`) are done or explicitly scoped. This pass moves the app from
*record keeping* to *field operations*: every potrero on the map shows what is in it, stocking and
rest are measured, and the day's work is planned per potrero.

**Scope:** $0, no new services. `build`/`lint`/`test` green every box; a unit test for every piece of
pure logic. One box per iteration: AUDIT → FIX → verify → check the box → commit. Commits stay local
(push is 403 on this machine) and ship with `vercel deploy --prod --yes`.

**Audit baseline (verified 2026-09-22):** 80 test files / 415 tests green, `tsc` clean.
- The map (`FarmMap.tsx`) draws padrones, sub-section polygons (stored by overloading
  `sections.map_center` as a GeoJSON Polygon) and infrastructure, but labels carry **only the
  section name** — no heads, no crop, no pasture or water state. Where the cattle and crops are is
  invisible on the one screen built to show it.
- `move_cattle` rewrites `cattle.section_id` in place. **No movement or occupancy history exists**, so
  days grazed, days rested and rotation planning are impossible.
- `sections.capacity` and `size_hectares` exist but nothing computes stocking (heads/ha, UG/ha) or
  warns about overstocking.
- Planning is agenda-shaped (tasks, vaccinations, harvests by date). Nothing groups the day by place
  or folds in weather gates (no spraying in wind/rain) or rotation moves.
- **Security:** section `name`/`color`, padrón codes and feature names are interpolated into Leaflet
  `divIcon` HTML and `bindTooltip` strings (both `innerHTML`). `color` is unvalidated in the REST
  route and in `validateAIOperation`. Farms are multi-member and AI inserts auto-apply, so this is a
  stored XSS reachable by any editor or by a prompt-injected assistant write.

---

## P0. Security
- [x] **Map label XSS.** Escape every interpolated value in map HTML; pass tooltips as text nodes;
      validate `color` as `#rrggbb` in `api/sections` POST/PUT and in `validateAIOperation`.
      Done when: a section named `<img src=x onerror=alert(1)>` renders as text, and a non-hex color
      is rejected by both write paths; tests cover the escaper and the validator.
      ✓ Done 2026-09-22: `map-labels.ts` (escapeHtml, safeHexColor, text-node tooltips) now builds
      every Leaflet label. `section-input.ts` validates color, water/pasture status and `mapCenter`
      (point or ≤500-vertex closed Polygon) for `api/sections` POST/PUT and the padrón sub-section
      route; `validateAIOperation` rejects non-hex colors and the AI schema hint says `#rrggbb`.
      Legacy non-hex rows render with the default color instead of breaking.

## A. Where things are
- [x] **Occupancy on the map.** Per section: heads by category, active crops, pasture/water state.
      Shown in the label (`Potrero 3 · 42 cab. · Soja`) and in a click panel listing batches and
      crops, for polygon, point-placed *and* geometry-less sections. Crops-only farms show no cattle.
      Done when: the map answers "what is in each potrero" without leaving the page.
      ✓ Done 2026-09-22: `/api/field-status` (one read → `buildFieldStatus`) feeds the map. Labels carry
      a second line (`47 cab. · 12 d`, `Maíz`, `libre · 21 d descanso`); geometry-less sections get it
      inline in the padrón label. New `FieldStatusPanel` lists **every** potrero — production had 13 of
      14 sections with no geometry, invisible on the map until now — with filters (atención / ocupados /
      libres), click-to-focus, and a nudge to draw unplaced ones. Crops-only farms see crops only.
      Viewport fits only when padrones change, so an occupancy refresh keeps the user's zoom.
- [x] **Stocking rate.** Pure `grazing.ts`: heads/ha, UG/ha (Uruguayan equivalences), % of capacity;
      map colored by utilization; `stocking` alert when a section is over capacity.
      Done when: overstocked potreros are red on the map and in the alerts panel; tests cover it.
      ✓ Done 2026-09-22: UG per category (Plan Agropecuario, rounded), heads/ha, UG/ha, % of capacity;
      level uses head capacity first, else UG/ha (>1 high, >1.5 over). Polygons fill red/amber. New
      alert kind `field` ("Potreros" filter in Pendientes): overstocked/at-limit potreros and animals
      standing where water is `seco`/`bajo`/`inundado`. Additive in `/api/alerts` — a failed read drops
      only the potrero alerts. 437 tests.

## B. Rotation
- [x] **Occupancy history.** A grazing/rest clock per potrero, maintained by a trigger on `cattle` so
      every write path (UI, AI, RPC, CSV import) records it.
      Done when: moving a batch out of a potrero starts its rest clock; ledger + `check:supabase` clean.
      ✓ Done 2026-09-22: migration 045 `section_occupancy` (own table, not columns on `sections`: 043's
      `updated_at` trigger anchors AI-confirmation concurrency and 012 audits every update, so stamping
      sections per move would invalidate pending AI proposals and flood the feed). The trigger passes
      arrived/departed heads so only real transitions move the clock — a zero-count row in a resting
      potrero changes nothing — and carries 035's farm-exists guard for the delete cascade. SECURITY
      DEFINER + fixed search_path like `log_field_mutation`, EXECUTE revoked from API roles (no new
      advisor warnings). Verified with a 7-assertion rollback DO block against production (arrival,
      re-arrival, split + full `move_cattle`, zero-count rows, count→0, section + farm delete).
      Existing occupied potreros have no row: their start is unknown and is shown as such.
- [x] **Rest and next-paddock suggestions.** Days grazed / days rested per potrero; rank candidate
      destinations for a batch (rested enough, pasture not poor, water ok, capacity fits).
      Done when: each occupied potrero shows days in use and a suggested destination.
      ✓ Done 2026-09-22: `moveReasons` (no water, overstocked, worn pasture, ≥21 d grazing),
      `suggestDestinations` (hard rules: empty, no crop, water not dry, pasture not worn, capacity not
      exceeded; score by rest ≥30 d, pasture, water) and `planRotation` (most urgent first, never two
      herds to one potrero). `/api/field-status` returns `rotation`; the panel shows "Conviene mover…
      Destino sugerido…" and the "Requieren atención" filter includes pending moves.

## C. The day
- [x] **Plan del día.** One page: today's and overdue tasks, sanitary work, harvest windows, rotation
      moves due and weather gates, grouped by potrero so it reads as a route.
      Done when: a manager can open one screen in the morning and assign the day.
      ✓ Done 2026-09-22: `/gestion/plan` (first in Gestión, NavBar, mobile menu and ⌘K). Pure
      `daily-plan.ts`: water problems, rotation moves, overdue + next-2-days tasks/vaccinations/harvests,
      grouped by potrero (most urgent stop first, "General" last). Spray-type tasks are marked
      "No hoy" when `sprayAdvice` says wind/rain; heat (≥32 °C) and heavy rain add notes. The browser
      sends its local date so the day boundary is the farm's, not UTC. Share over WhatsApp (`wa.me`
      text, $0), print, or hand the list to CampoAI to organize. Shared `loadFieldStatus` now backs
      `/api/field-status` and the plan. Field status and weather are optional: either failing leaves
      the core list intact. Also fixed: potreros with only a crop showed a "Libre" badge.

## D. Assistant
- [x] **Spatial grounding.** Feed occupancy, stocking and rest into the AI farm context so
      "¿qué potrero está sobrecargado?" and "¿a dónde muevo las vaquillonas?" are answerable.
      Done when: those questions return grounded answers in the live app.
      ✓ Done 2026-09-22: `ai-field-context.ts` renders a CARGA Y ROTACIÓN block (stocking level, UG,
      UG/ha, days grazed/rested or "sin registrar", crops, suggested moves with section ids) from rows
      `getFarmContext` already loads plus one optional `section_occupancy` read (1.5 s budget). Skipped
      when any source is truncated so partial rows never understate stocking. Names escaped with the
      existing `esc`. System prompt: use the block's numbers, explain a move's reason, propose `move`
      (which always requires confirmation), point to Plan del día. Also: Plan del día no longer adds
      a generated water item next to an existing water task for the same potrero.
