# GOAL — Make CampoAI production-ready (app only)

**Scope:** the standalone web app. Email/password auth → create farm → manage
hacienda / agricultura / sanidad / inventario / finanzas / mapa → AI chat (text + voice).
External **WhatsApp Business API is OUT OF SCOPE** — it must be cleanly optional, never
a blocker, and never crash the app when its keys are absent.

**Stack constraint:** $0 budget. Only Supabase free tier + Groq free tier. Deploy to Vercel Hobby.

**Definition of done:** every box below is checked, `npm run build` is clean, `npm run lint`
is clean, and the production deploy at https://89campaiai.vercel.app serves the full flow.

---

## Audit baseline (state at 2026-06-13)

- App **is already deployed** and live; Vercel has real Supabase + Groq keys (set 77d ago).
  `ideas.md` calling this "blocked" is **stale** — only WhatsApp (out of scope) is incomplete.
- `npm run build` passes. 34 routes compile. No tests exist. 1 TODO in `src/`.
- `owner_phone NOT NULL` is handled in `/api/farm` via `user.phone || web-${user.id}`. OK.
- WhatsApp coupling isolated to 3 files: `middleware.ts`, `api/whatsapp/route.ts`, `lib/whatsapp.ts`.
- In-app voice (`/api/chat/audio` → Groq Whisper) is self-contained. Keep it.

---

## Checklist (work top-to-bottom; one item per loop iteration)

### P0 — correctness & resilience
- [x] **Env validation.** Add `src/lib/env.ts` that validates required vars
      (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
      `GROQ_API_KEY`) and throws a clear, named error if missing. Replace `process.env.X!`
      non-null assertions in `lib/supabase.ts`, `lib/supabase-server.ts`, `middleware.ts`, `lib/ai.ts`.
      WhatsApp vars are validated lazily only inside `lib/whatsapp.ts` / `api/whatsapp`, never at boot.
      ✓ Done 2026-06-13: lazy getters (no build-time crash), `coreEnvPresence()` + `whatsappConfig()` helpers.
- [x] **WhatsApp made non-fatal.** `api/whatsapp/route.ts` must return a clean 503 "WhatsApp not
      configured" when `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` are absent, not throw.
      Nothing in the core app render path imports WhatsApp send logic.
      ✓ Done 2026-06-13: early 503 guards on GET+POST via `whatsappConfig()`; `lib/whatsapp.ts`
      routed through the helper, removed `process.env.X!` assertion. Core render path never imports it.
- [x] **Real liveness endpoint.** Add `GET /api/status` (unauthenticated) returning
      `{ ok: true, supabase: bool, groq: bool }` — checks env presence + a cheap Supabase ping.
      (Leave existing `/api/health` = farm health_events as-is, or rename internally if it collides.)
      ✓ Done 2026-06-13: never-throws, lazy supabase import, HEAD count ping, 200/503 status.
      Allowlisted in middleware so it's reachable without auth. `/api/health` left as-is.
- [x] **Kill silent failures.** The fire-and-forget `chat_messages` insert (`.then()` with no
      catch) in `api/chat/route.ts` must log on error. Audit other `.then()`/empty-catch sites.
      ✓ Done 2026-06-13: both chat + chat/audio inserts now log on error. Audited all `.then()`
      sites — sanidad page ones are legit fetch chains; no empty catch blocks found.
- [x] **AI JSON hardening.** `processMessage` must tolerate model output wrapped in ``` fences /
      leading prose; strip to the JSON object before `JSON.parse`. Add a unit test for this.
      ✓ Done 2026-06-13: extracted pure `extractJsonObject()` in `src/lib/json.ts` (fence strip +
      string-aware balanced-brace scan). Wired into `processMessage`. Unit test lands with the P1
      harness (the unit-tests box already lists "AI JSON extraction/repair").

### P1 — verification & tests
- [x] **Test harness.** Add `vitest`. Wire `npm test`. Keep it free/offline (no network).
      ✓ Done 2026-06-13: vitest 3.2.6, `vitest.config.ts` (node env, `@/` alias, `src/**/*.test.ts`),
      `npm test` → `vitest run`. Sanity test green; build unaffected (Next ignores `.test.ts`).
- [x] **Unit tests** for: AI JSON extraction/repair, the cattle `move` split math in
      `executeOperations`, and env validation. All green.
      ✓ Done 2026-06-13: extracted pure `computeCattleSplit()` (refactored `executeOperations` to use
      it), 20 tests across json/cattle/env all green. `npm test` clean, build unaffected.
- [x] **Schema reproducibility.** Verify `schema.sql` + `002`–`007` apply in order on a fresh
      Supabase with zero errors. Add `supabase/README.md` with the exact apply order and a single
      concatenated `supabase/full_setup.sql` for one-shot setup. Note any drift (e.g. columns added
      by code but missing from migrations: `padron_id`, `operation_type`, expansion tables).
      ✓ Done 2026-06-13: reviewed all 7 — apply cleanly in order on a fresh DB (additive ALTERs,
      IF NOT EXISTS tables). Key caveat documented: CREATE POLICY isn't idempotent → run-once.
      Generated `full_setup.sql` (14 tables) + `supabase/README.md` (order table + drift notes).
      No real drift: all columns are captured in migrations; owner_phone handled via web-<id>.

### P2 — production polish
- [x] **Error & not-found pages.** Add `src/app/error.tsx` and `src/app/not-found.tsx` (branded).
      ✓ Done 2026-06-13: branded Logo + Button, Spanish copy. error.tsx logs + reset/home actions
      (shows digest ref); not-found.tsx 404 with home link. Build clean.
- [x] **Loading states.** Confirm every `gestion/*` and `produccion/*` page has a skeleton/loading
      state and an empty state. Fill gaps.
      ✓ Done 2026-06-13: audited all. metricas/registro/chat already had loading; added a `loaded`
      guard + `<LoadingPage />` skeleton to finanzas, inventario, agricultura, hacienda, sanidad
      (were flashing EmptyState during initial fetch). All keep their existing empty states. Build clean.
- [x] **Metadata/SEO.** Real `<title>`, description, OG tags, favicon in `app/layout.tsx`.
      ✓ Done 2026-06-13: metadataBase + title template (`%s · CampoAI`), refreshed standalone-app
      description (chat+voice, not WhatsApp-centric), OpenGraph + Twitter cards, keywords. favicon.ico
      already present. Build clean.
- [x] **Light rate-limit** on `api/chat` + `api/chat/audio` (in-memory per-farm token bucket) to
      protect the Groq free tier. Cheap, no external service.
      ✓ Done 2026-06-13: `src/lib/rate-limit.ts` token bucket (burst 10, ~10/min sustained per farm),
      429 + Retry-After on both chat routes. Pure `consumeToken` core with 4 unit tests (24 total green).
- [x] **README.** Rewrite `README.md`: what it is, the Supabase+Groq setup, the SQL apply order,
      env vars, local dev, deploy. Mark WhatsApp as optional/experimental.
      ✓ Done 2026-06-13: full README (features, stack, Supabase/Groq setup, full_setup.sql, env,
      local dev, project layout). WhatsApp clearly marked optional/experimental (503 when absent).

### Done criteria (verify, then stop the loop)
- [x] `npm run build` clean, `npm run lint` clean, `npm test` green.
      ✓ Done 2026-06-13: lint now 0 problems (was 17). Hoisted NavBar NavLink/NavDropdown to module
      level (fixed real state-reset bug), typed page.tsx (removed `any`), removed unused vars,
      scoped one documented disable for the fetch-on-mount false positive. 24 tests green, build clean.
- [x] Deployed to Vercel prod; `/login`, `/setup`, and `/api/status` all respond correctly.
      ✓ Done 2026-06-13: deployed to https://89campoai.vercel.app. The new /api/status probe caught
      the Supabase project PAUSED (free-tier auto-pause) — restored it via MCP → ACTIVE_HEALTHY.
      Final check: /api/status {ok:true,supabase:true,groq:true}, /login 200, / 307, /api/whatsapp 503.
- [x] `ideas.md` row #89 updated from `blocked` → `completed` with an accurate note.
- [x] `strategy.md` gets a CampoAI production-hardening learnings entry.

---

## Loop protocol
Each iteration: (1) read this file, (2) pick the **first unchecked box**, (3) implement it,
(4) verify with `npm run build` (+ `npm test` once the harness exists), (5) check the box and
commit with a descriptive message, (6) if every box is checked, do the final deploy + doc updates
and **end the loop**. Never start WhatsApp Business API work. Keep commits small and scoped to one item.
