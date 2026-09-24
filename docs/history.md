# CampoAI history

A condensed record of what shipped, per planning file, oldest first. The original files
(`GOAL-hardening.md`, `GOAL-features.md`, `GOAL.md`, `GOAL-audit-2026-09.md`, `GOAL-field-ops.md`)
were replaced by this file and [`ROADMAP.md`](../ROADMAP.md) on 2026-09-24; they remain in git
history. From 2026-09-22 on, each change is also a row in the [`LOOP.md`](../LOOP.md) ledger.
Lessons that were not obvious at the time are marked **Lesson**.

## March 2026: design plans (`docs/superpowers/`, deleted)

Four documents from 2026-03-29: the expansion design + plan (agriculture, inventory, finances,
metrics; livestock / crops / mixed farm profiles) and the frontend redesign spec + plan (Lucide icons
instead of emoji, typography scale, Linear/Vercel-style layout). Both were implemented and are fully
superseded by the current code, so they were deleted rather than archived (git history has them).
The same cleanup removed the committed `.superpowers/` brainstorm output (HTML mockups, server logs).

## Production hardening (`GOAL-hardening.md`, 2026-06-13)

- Lazy env validation (`env.ts`): no build-time crash, `coreEnvPresence()`, WhatsApp validated only when used.
- WhatsApp made optional: `/api/whatsapp` returns 503 when unconfigured; the core app never imports it.
- `GET /api/status` liveness probe (unauthenticated, never throws).
- Chat-message inserts log on failure instead of fire-and-forget.
- `extractJsonObject()` tolerates fenced / prose-wrapped model JSON.
- Vitest harness; first tests for JSON extraction, the cattle split (`computeCattleSplit`) and env.
- `supabase/full_setup.sql` + `supabase/README.md` apply order.
- Branded error / not-found pages, loading skeletons, metadata/OG, per-farm chat rate limit, README.
- Lint 17 → 0 (hoisting NavBar sub-components fixed a real state-reset bug).
- **Lesson:** the first `/api/status` deploy found the free-tier Supabase project auto-paused; a daily
  Vercel cron on `/api/status` now keeps it awake.

## Features (`GOAL-features.md`, 2026-06-14 → 2026-08-15)

- Alerts hub (`buildAlerts`, `/api/alerts`, home panel, NavBar badge).
- ⌘K command palette over sections, cattle, crops, inventory and every page.
- Export: full JSON backup and per-table CSV (`/api/export`).
- Sample data ("Probar con datos de ejemplo") with dates chosen so alerts light up.
- Printable reports (cattle by category, finance summary, inventory valuation) via `window.print()`.
- Weather panel (Open-Meteo, geocoded from `farms.location`, no key) and a spray hint.
- AI weekly summary cached in `farm_insights` (migration 008).
- Weight records and daily gain (migration 009, `/produccion/peso`).
- 2026-08: installable PWA with private per-user offline snapshots (read-only; the service worker
  never caches `/api/*`), explicit "sync before leaving coverage", tasks (014) wired into alerts,
  calendar, AI and export; unified agenda; result by section; multi-user farms with owner/editor/
  viewer roles and expiring invites (031).

## UI/UX audit (`GOAL.md`, 2026-06-14)

- Every page, alerts, export and the palette reachable on mobile (top bar + "Menú").
- Nav routes == palette routes; missing loading/empty states filled (mapa, métricas, reportes).
- Confirm dialog + toasts on every destructive action (chat "Limpiar historial" had none).
- aria-labels on icon-only buttons; a nested `<main>` removed; non-color cues on statuses.
- `status-styles.ts` centralizes tone colors; card padding normalized.
- `/api/alerts` fetched once via `FarmContext` instead of twice.
- **Lesson:** this pass marked contrast "done" but `text-emerald-600`/`text-amber-600` failed AA on
  white; the September audit fixed it (-700). Measure contrast, don't eyeball it.

## Security & robustness audit (`GOAL-audit-2026-09.md`, 2026-09-18 → 2026-09-19)

P0, same day:
- Anon key could read and write every tenant: nine "Service role full access" policies had no
  `TO service_role`. Migration 032 rescoped them and revoked anon table grants.
- Migration 031 fixed before applying (missing tables in its rescope loop; editors could PATCH
  `farms.user_id`/`owner_phone` → `guard_farm_identity`), then applied and owners backfilled.
- Confirmation matcher rewritten: whole-message, accent-insensitive ("Confirmá" failed on ASCII
  `\b`; "Confirmo, mové 10 novillos" matched `\bno`). Web confirms only via the button.

P1:
- Next 16.2.0 → 16.3.5 + `npm audit fix` (0 prod vulnerabilities).
- `/api/status` reported missing migrations as present. **Lesson:** supabase-js turns a bodiless
  HEAD 404 into a 204 with no error; probes now GET with `limit(0)`.
- Every AI update/delete/move became a signed proposal on all channels.
- Offline cold start falls back to `getSession()`; farm bootstrap no longer reruns per navigation.
- Open redirect in `safeNextPath` fixed; security headers (partial CSP, XFO, nosniff, Referrer-,
  Permissions-Policy); offline snapshots cleared on sign-out; SW refuses redirected responses.

P2 (2026-09-19):
- Confirmation tokens bound to the user and to each row's `updated_at` (043 added the column and
  trigger to all 10 AI-updatable tables; the update itself carries `.eq("updated_at", …)`, not a
  read-then-compare), optional `AI_CONFIRMATION_SECRET`, consumed proposals in
  `ai_confirmed_requests` (044) because "Limpiar historial" wiped `chat_requests` and re-enabled replay.
- Per-table AI column allowlist; enum checks; `move` rejected on non-cattle tables.
- Groq 429s carry Retry-After and release the idempotency claim instead of replaying the error.
- `executeOperations` tests with an in-memory Supabase fake.
- Context values escaped; chat history tagged by author role so viewer turns never reach an editor's call (037).
- `/api/status` full detail only for same-origin requests (`Sec-Fetch-Site`, `Vary`), `{ok}` otherwise.
- Rate limits moved to Postgres (036, atomic, in-memory fallback) and added to imports, sample data, invites.
- WhatsApp: per-sender rate limit and a global cap on farm auto-creation (removing auto-create would
  have removed WhatsApp's only onboarding path).
- Audio body cap 4.5 MB / file 4 MB, 411 without Content-Length; CSV formula guard only on strings.
- DB integrity (033): CHECKs on counts/stock/amounts, currency enum, `update_inventory_stock` on all
  ops, `farms.user_id ON DELETE SET NULL`, 15 FK indexes.
- `move_cattle` idempotency key; 034 dropped the old 4-arg overload. **Lesson:** `CREATE OR REPLACE`
  with an added parameter creates a new overload, and the app deploy must land with the migration
  (the old build called the dropped overload).
- 035: audit triggers skipped once the farm row is gone (farm delete cascade FK-failed, breaking the
  sample-data rollback).
- Advisors: `auth_rls_initplan` 25 → 0 (038/039), 30-day retention via pg_cron (040),
  `multiple_permissive_policies` 259 → 0 (041/042). **Lesson:** splitting a `FOR ALL` policy is only
  safe if a SELECT policy still covers the same roles, since UPDATE/DELETE need row visibility; one
  "invariant check" that session turned out to be a no-op query. Verify the verifier.
- Migrations made mostly re-runnable; `check-supabase-setup.mjs` diffs migration bodies against `full_setup.sql`.
- Frontend: every `<Label>` tied to its control (repo-wide regression test), chat `aria-live`,
  contrast -600 → -700, `formatMoney` + `parseLocalizedNumber` on every money input (fixed a raw
  string written to a numeric column), Recharts loaded on demand, SW prunes old build assets.

## Field operations (`GOAL-field-ops.md`, 2026-09-22 → 2026-09-24)

- Map label XSS fixed: escaped HTML, text-node tooltips, `#rrggbb` validated on both write paths.
- Occupancy on the map and a panel listing every potrero (13 of 14 production potreros had no geometry).
- Stocking in UG/ha against capacity; overstock and water alerts.
- Grazing clock per potrero (045, trigger on `cattle`, own table so moves don't invalidate pending AI
  proposals or flood the audit feed); proven with a 7-assertion rollback `DO` block in production.
- Rest-aware destination suggestions and `planRotation`.
- Plan del día (`/gestion/plan`): the day grouped by potrero with weather gates; share, print, hand to the assistant.
- Assistant context gained CARGA Y ROTACIÓN (skipped when any source is truncated).
- Groq retired `llama-3.3-70b-versatile`; the assistant had been failing since ~2026-09-18. Default
  now `openai/gpt-oss-120b` with `GROQ_CHAT_MODEL` override, and `/api/status` probes the model.
  **Lesson:** a key-present health check is blind to a retired model; URL-encoding the `/` in the
  model id made Groq 404 for three minutes.
- Manual cattle moves from plan and map (`/api/cattle/move`), drawing unplaced potreros, setting the
  grazing clock by hand, offline field status, one silent retry on 502/503/504.
- Jev insert gate enabled: referenced ids resolved to names first (a uuid never matches "en el Norte").
- Loop iterations 1–18 (ledger in `LOOP.md`): grazing history and running peaks (047–049, including a
  swap-move deadlock caught in review), local JWT verification (`getClaims`), Markdown-only merges skip
  the build, shared membership cache, readable activity feed, spray window, week view and vaccine
  supply, assistant week answers and stale-history pruning, a six-reviewer full audit (050: API roles
  lose grants on service-only tables, `pg_graphql` dropped; advisors 33 → 5), farm-local "today"
  everywhere on the server, calendar-day handling of vaccination dates.
- **Lesson:** repeated questions got the old answer verbatim; history is context for the referent,
  never a data source.

## Loop 19 cleanup (2026-09-24)

- `ai.ts` (1650 lines) split into `ai-farm-context`, `ai-prompt`, `ai-groq`, `ai-action`,
  `ai-proposal`, `ai-execute`; `ai.ts` is the orchestrating facade.
- Farm context capped at ~6k estimated tokens with a deterministic trim order (`ai-context-budget.ts`).
- Vaccination dates in the AI context use `calendarDateLabel`; `/api/vaccinations` orders same-day
  rows by entry time.
- Dead code removed (knip), Next.js template SVGs removed, GOAL files consolidated into `ROADMAP.md`
  and this file.
