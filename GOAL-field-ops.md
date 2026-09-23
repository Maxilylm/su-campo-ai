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

## E. Found while verifying live (not in the original plan)
- [x] **The assistant was down.** Groq retired `llama-3.3-70b-versatile`; every `/api/chat` reply had
      been "Hubo un error…" since at least 2026-09-18 (production logs: `model_not_found`).
      ✓ Fixed 2026-09-22: default `openai/gpt-oss-120b` (largest model the key can use; JSON mode and
      Spanish verified live) with `reasoning_effort: "low"`; optional `GROQ_CHAT_MODEL` env; insight
      max_tokens 400 → 800 for reasoning headroom. Verified in the live chat: "¿qué potrero está más
      cargado y a dónde muevo los novillos del Sur?" → Potrero Norte, 98 cab., 75,2 UG, 0,63 UG/ha;
      mover a I-995 (matches the rotation plan). Prompt now keeps ids out of reply text.
- [x] **Health check was blind to it.** The Groq probe only checked the key existed. `/api/status` now
      asks Groq for the configured model (`GET /models/{id}`, free, cached 5 min); retired model or
      rejected key → degraded, timeouts non-fatal. (A first version URL-encoded the `/` in the model id,
      which Groq 404s — `/api/status` returned 503 for ~3 min until the per-segment fix.)

---

## Verified live vs. not (2026-09-22)
- Verified in production with a real session: moves from plan and map (single batch and whole herd,
  round trips restored), grazing clock trigger, manual clock, drawing an unplaced potrero (then reset),
  label layout, Plan del día actions, `/api/status` Groq probe, chat answers after the model switch.
- **Not** verified: phone-width layout (the automation browser could not be narrowed below desktop);
  offline rendering of the field-status snapshot (the write is verified, the offline read is unit-tested);
  a real AI auto-insert through Jev in production (gate verified against the live TypeSafe API locally).
- Latency finding: free-tier Supabase calls from the functions sometimes take 3-7 s; a per-batch
  move from the browser timed out once. Whole-herd moves are now one request.

## Next loop (ranked by value ÷ effort)

1. ✓ **Act from the plan, not just read it.** (done 2026-09-22 — there was no manual move in the UI at
   all, only the assistant could call `move_cattle`. New `POST /api/cattle/move` (validated, idempotent,
   same RPC, logs a "movement" activity) + `MoveCattleDialog` (batch, count with split preview,
   destination with ranked suggestions first) on every occupied potrero in the map panel and on plan
   rotation items; "Hecho" completes plan tasks in place.)
   **Was:** "Mover" on a rotation item opens a prefilled move dialog
   (batch, count, destination) that calls the existing `move_cattle` flow; "Hecho" on a task item
   completes it. Today every item links away to another page.
2. ✓ **Draw the unplaced potreros.** (done 2026-09-22 — "Dibujar en el mapa" on each unplaced row
   starts the polygon placement mode for that potrero; `padronForShape` (ray casting, holes and
   MultiPolygon) picks the padrón holding most vertices; `PUT /api/sections/geometry` stores shape +
   padrón without touching the Hacienda form's full-record PUT.)
   **Was:** 3 of 4 demo potreros (13 of 14 in production) have no geometry.
   A "Dibujar en el mapa" button on each unplaced row in `FieldStatusPanel` that starts the existing
   polygon-placement mode for that section (needs a PUT path for `map_center` on existing sections).
3. ✓ **Set the grazing clock by hand once.** (done 2026-09-22 — `PUT /api/field-status` with a validated
   date (not future, ≤3 years back, browser's local day); writes `occupied_since` if the potrero holds
   animals now, else `last_vacated_at`, anchored at noon UTC. Inline "¿Desde cuándo están?" /
   "¿Desde cuándo está libre?" on rows whose clock is unknown.)
   **Was:** Potreros occupied before migration 045 show "ingreso sin
   registrar" until their next move. A one-time "¿Desde cuándo están?" date on the panel row that
   writes `section_occupancy.occupied_since` (new, service-role route; validated date ≤ today).
4. ✓ **Movement history.** — LOOP iterations 1 and 1b (#18, #19). Migrations 047 (`grazing_periods`,
   opened/closed by a trigger on `section_occupancy`), 048 (`peak_heads`) and 049 (running peaks in
   `grazing_period_peaks`, locked last: clock → period → peak). Panel "Historial" line and the
   assistant's context show last rest (flagged < 30 d), periods and animal-days/ha over 365 d.
   Warm `/api/field-status` ≈ 0.5 s with six parallel queries; cold start ≈ 4 s (platform, see below).
   **Done when:** every stocking/emptying of a potrero (any write path, including the manual date)
   opens/closes a `grazing_periods` row; each potrero row shows its last rest (flagged when shorter
   than 30 d) and animal-days/ha over the last 365 d; the assistant sees the same.
   **Verify by:** rollback DO block for the trigger; a real move in production creates and closes a
   period (then reverted); the panel shows the history line.
   **Idea:** `section_occupancy` holds only the current clock. An append-only
   `grazing_periods` log (same trigger) enables grazing-days-per-hectare per season, rest-period
   compliance and the rotation chart the map is still missing.
5. ✓ **Jev insert gate enabled in production** (2026-09-22, user-approved). Live probing showed every
   correct registration with a `section_id` held as "coincidencia" — a uuid can't match "en el Norte".
   Referenced ids are now resolved to names before asking Jev; verified live: correct inserts apply,
   a wrong count and a question are held.
6. ✓ **Offline field status.** (done 2026-09-22 — the map saves each online `/api/field-status`
   answer per user (`campoai:offline-field-status:*`, cleared by "Borrar copias locales") and shows it
   read-only offline; malformed or >7-day-old copies are rejected. Not exercised in a real offline
   browser session — unit-tested only.)
   **Was:** Add `field-status` to the offline entity snapshot so the potrero panel
   and labels work in the field without signal (the map already works offline).
7. ⛔ **Blocked on config — Plan del día via WhatsApp webhook.** Production has only
   `WHATSAPP_VERIFY_TOKEN`; without `WHATSAPP_ACCESS_TOKEN` + phone-number id the webhook can receive
   but never reply. Build it once WhatsApp Business is set up.
   **Idea:** The WhatsApp integration exists; a "plan" keyword could
   reply with `dailyPlanText` — the foreman gets the day without opening the app.
8. ✓ **Cold-start 504 on `/api/farm`.** (done 2026-09-22 — `retryTransientResponse`: one quiet retry
   after 1.2 s on 502/503/504, never on real errors, stops if aborted.)
   **Was:** Seen live right after a deploy: `/api/farm` 504 → 503 → 200 within
   5 s, which flips the whole app into the "Conexión con el servidor interrumpida · modo lectura" banner
   until the retry. Consider one silent retry before entering recovery mode.
9. **Accepted risk (loop audit 2026-09-23):** advisor 0028/0029 flag `has_farm_role`/`is_farm_owner`
   as SECURITY DEFINER callable by anon/authenticated. Both key on `auth.uid()`: anon always gets
   false, a user only learns their own role — no data exposed. DEFINER is required to avoid RLS
   recursion (farm_members policies call has_farm_role). Revisit only if they start taking an
   arbitrary user id.
10. **Cold-start latency.** ◐ Step 1 done (loop 2, #21): `requireFarm` verifies sessions locally with
    `getClaims` (ES256 JWKS), removing one Supabase Auth round trip per API request — warm medians
    30-60 % lower, worst case 5.2 s → 0.6 s. Step 2 done (loop 4, #23): membership lookup shared per
    instance (15 s cache, invalidated on membership changes) and 5 s cold timeout — the cold load that
    used to return 503 on three routes now loads clean. Remaining: cold function starts themselves.
    **Was:** First request after a deploy or idle: `/api/field-status` ≈ 4.3 s vs 0.5 s
    warm; `/api/farm` has produced 503/504 on cold starts (client now retries once). Candidates: a
    lighter warm-up ping in the existing daily cron is not enough (Vercel scales to zero within
    minutes); consider trimming per-request auth round trips in `requireFarm` first.
11. ✓ **Readable activity feed** (loop 5, #25) — product walk found raw audit rows with ids on the home
    page; `presentActivities` humanizes and folds them.
12. ✓ **Spray window in the plan** (loop 6, #27): 3+ daylight hours, wind 3–15 km/h, no rain. (from the loop 5 walk): the home weather card says "No pulverizar"
    today but nothing says *when* the next window is. Open-Meteo's daily forecast can carry max wind;
    with rain it gives the next suitable day for Plan del día and the assistant.
13. ✓ **Week view + vaccine supply check** (loop 8, #31).
14. ✓ **Weather route cold 504** (loop 9, #33) (loop 8 audit): `/api/weather` returned 504 once at 17:28 UTC — its farm
    location lookup has a 2.5 s timeout, the same cold-connection issue loop 4 fixed for auth.
15. **Housekeeping.** ✓ `set_updated_at` search_path pinned (migration 046, advisor cleared). Still
   open: `has_farm_role`/`is_farm_owner` are SECURITY DEFINER and executable by `anon` (used inside RLS
   policies, so revoking needs a check of which policies anon can evaluate); pg_graphql exposes all
   26 tables to signed-in users (RLS still guards rows; the app never uses GraphQL). Leaked-password protection is still
   a manual dashboard toggle.
