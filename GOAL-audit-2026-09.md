# GOAL — CampoAI full audit & remediation (2026-09-18)

Follows `GOAL-hardening.md`, `GOAL-features.md` and `GOAL.md` (all boxes checked). This pass
audits security, the AI pipeline, the database and the frontend against the **live** system, not
just the source. Same rules: $0, one box per iteration, keep `tsc`/`lint`/`test`/`build` green, add
a test when a fix introduces pure logic. DB changes: new numbered migration in `supabase/` → apply to
project `fdceixfggdpjoydqyvss` → regenerate `full_setup.sql`.

> P0-1 was applied to production on 2026-09-18, so this file no longer describes an open exposure.

Evidence tags: **[live]** verified against production · **[code]** verified by reading source ·
**[unverified]** plausible, needs a repro.

---

## Baseline (verified 2026-09-18)

- `tsc --noEmit` clean · `eslint` clean · **342/342 tests pass** (73 files) · `next build` OK (59 routes).
- Live `https://campo-ai-mlx.vercel.app` serves commit `7ce6b4c`; the browser bundle and the server
  both use Supabase project `fdceixfggdpjoydqyvss` (5 farms, 13 MB).
- Supabase migration ledger: 017–030 recorded **today at 19:52 UTC**, matching
  `_PENDING-migrations-015-030.sql`. **031 (`farm_memberships`) is NOT applied**: `farm_members`,
  `farm_invites`, `has_farm_role`, `is_farm_owner` are absent, and REST returns PGRST205.
- WhatsApp is unconfigured on live (`/api/whatsapp` → 503), so WhatsApp findings are latent.
- `npm audit`: `next@16.2.0` has 25 advisories (2 critical, fixed in ≥16.3.3), plus `ws`, `nanoid`,
  `sharp`, `postcss`, `baseline-browser-mapping`.
- Supabase advisors: anon/authenticated SECURITY DEFINER `log_field_mutation()` is executable via RPC,
  `update_inventory_stock` has a mutable search_path, leaked-password protection is off, 24
  `auth_rls_initplan`, 175 `multiple_permissive_policies`, 13 unindexed FKs.

---

## P0 — exploitable now (do today, each is minutes via Supabase MCP `apply_migration`)

- [x] **P0-1. Close the anon-key data exposure.** [live] Nine tables have a policy
      `"Service role full access" FOR ALL USING (true) WITH CHECK (true)` with **no `TO service_role`**,
      so it applies to `public`: `activities, cattle, chat_messages, farms, health_events, map_features,
      padrones, sections, vaccinations`. The anon key ships in the JS bundle. Using only that key, with
      no login, `GET /rest/v1/farms` and `/rest/v1/vaccinations` return every tenant's rows (confirmed);
      writes and deletes are equally open. Origin: `002_auth.sql:19-26`, `003_expanded.sql:79-82`,
      `005_map.sql:37,41`, `004_chat_messages.sql`.
      Fix: a standalone `032_rescope_service_policies.sql` (does not depend on 031) that
      drops and recreates each policy `TO service_role`. The service role bypasses RLS anyway, so the
      server loses nothing. Belt-and-braces: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon`.
      No client code calls `supabase.from()` (verified), and auth endpoints don't need table grants.
      Also `REVOKE EXECUTE ON FUNCTION log_field_mutation() FROM anon, authenticated`.
      **Done when:** `select tablename from pg_policies where schemaname='public' and roles='{public}'
      and qual='true'` returns 0 rows, and an anon-key `GET /rest/v1/farms?select=id` returns `[]` or 401.
      Afterwards, review whether any row was tampered with (compare `activities` history for anomalies).
      ✓ Done 2026-09-18: `032_rescope_service_policies.sql` applied. 0 `{public}` policies with
      `qual='true'`, anon has no table privileges, and anon REST now returns 42501. No tampering signals
      checked beyond this; review `activities` if any record looks wrong.

- [x] **P0-2. Fix migration 031, then apply it.** [code] + [live: unapplied] Order matters:
      - Its re-scope loop (`031:51-55`) leaves out `vaccinations` and `health_events`. P0-1 covers
        this, but align the file so a fresh `full_setup.sql` install is safe too.
      - "Editors update shared farms" (`031:145-148`) lets an editor PATCH `farms.user_id` and
        `owner_phone` directly via REST. That makes them owner, lets them remove the real owner, and
        hijacks WhatsApp routing. Fix: column-level grants
        `REVOKE UPDATE ON farms FROM authenticated; GRANT UPDATE (name, total_hectares, location,
        operation_type) ON farms TO authenticated;`, or a BEFORE UPDATE trigger rejecting changes to
        `user_id`/`owner_phone`.
      - Mark `has_farm_role`/`is_farm_owner` `STABLE` and set `search_path`.
      - Then apply, regenerate `full_setup.sql`, and add rollback notes.
      **Done when:** `farm_members` exists live, the owner can invite a member end-to-end on
      production, and an editor-token PATCH of `farms.user_id` is rejected.
      ✓ Done 2026-09-18: 031 now also rescopes `vaccinations`/`health_events`, marks the role helpers
      `STABLE`, and adds `guard_farm_identity` (only the service role may change `user_id`/`owner_phone`).
      Applied live and backfilled 5 owners. A rolled-back attack test as an editor: normal edit OK,
      `user_id` and `owner_phone` changes both rejected (42501), cross-farm rows invisible.
      Not yet verified: a real owner → invite → accept flow on production (needs two accounts).

- [x] **P0-3. Fix the AI confirmation matcher.** [code, reproduced in Node] `isExplicitAIConfirmation`
      (`src/lib/ai-confirmation-text.ts:7-8`):
      - It treats ordinary commands as confirmations: "Hoy se aplica urea en el lote 3" → true,
        "Guardar 20 vacas en el potrero" → true.
      - It misses real ones: "Confirmá" → false and "guardá" → false (ASCII `\b` before `á`).
      - It rejects "Confirmo, mové 10 novillos" (the `\bno` has no closing `\b`, so it matches "novillos").
      On web, a new message typed after a proposal can apply the *old* proposal (`chat/page.tsx:279-289`).
      Fix: on web, confirm **only** through the button (`confirmationOverride`); the WhatsApp token must
      be the whole message `CONFIRMO`. Rewrite with `\p{L}`-aware boundaries (`u` flag) and add the six
      strings above as regression tests.
      **Done when:** the tests pass and typing a new instruction never consumes a pending proposal.
      ✓ Done 2026-09-18: whole-message, accent-insensitive matcher plus the six regression strings;
      web chat sends a proposal token only from the confirmation button. Trade-off: only one lead-in
      word is allowed ("Sí, confirmo" works, "Sí, dale, confirmá" doesn't), which may reject natural
      Whisper transcripts in audio chat. If users hit it, widen the lead-in list, not the verb match.

## P1 — high impact, this week

- [x] **P1-1. Upgrade Next.js 16.2.0 → ≥16.3.5** (+ `npm audit fix` for ws/nanoid/sharp/postcss).
      Covers proxy-bypass (GHSA-26hh…, GHSA-492v…), SSRF, RSC DoS and the Image Optimizer RCE
      (`/_next/image` is enabled by default even though no `next/image` is imported). If the optimizer
      isn't needed, set `images: { unoptimized: true }`. **Done when:** `npm audit --omit=dev` shows no
      high/critical and the build and tests stay green. Remember: deploys are `vercel deploy --prod` (Hobby
      cap 100/day).
      ✓ Done 2026-09-18: next 16.3.5 / eslint-config-next 16.3.5 + `npm audit fix`; 0 prod vulnerabilities.

- [x] **P1-2. `/api/status` reports 031 as applied when it isn't.** [live] The 031 probe is in the
      deployed build (`status/route.ts:253-254`), yet live returns `missingMigrations: []` while
      `farm_members` returns PGRST205. The first cold call also returns `reason:"timeout"` with
      `available:true, ok:true`, cached `s-maxage=30`. A ping timeout makes `criticalSchemaTimedOut`
      false, so the schema reads as "ok".
      Fix:
      - Trace why a PGRST205 from the lane runner doesn't reach `missingSchemaMigrations()`.
      - Make timeouts tri-state (`available: null`, `no-store`) and raise the critical probe budget to ~3 s.
      - Keep the public payload to `{ok}` and put the details behind auth or `CRON_SECRET`.
      **Done when:** a test with a PGRST205 probe yields `missingMigrations: ["supabase/031_…"]`, and live
      shows 031 missing until P0-2 is applied.
      ✓ Done 2026-09-18. Root cause: probes used `select(..., { head: true })`. HEAD responses have no body
      and supabase-js turns a bodiless 404 into a 204 with no error (reproduced live), so missing tables
      always looked present. Probes now use GET + `limit(0)`. Timed-out checks are not edge-cached.
      Not done: public payload trimming to `{ok}` (moved to P2).

- [x] **P1-3. Require confirmation for destructive AI writes.** [code] Only handoff prompts (the phrase
      `/no guardes cambios en esta respuesta/`) go through confirmation (`ai.ts:861`). Every other
      message, whether web, audio or WhatsApp, applies up to 20 update/delete/move ops immediately.
      Deletes cascade into `weight_records` and `crop_applications`. Farm data enters the prompt
      unescaped (`ai.ts:359-372`), and viewers can post into the shared transcript that editors'
      turns read (`chat/route.ts:100,218`).
      Fix: route every `update`/`delete`/`move` and every multi-op batch through
      `createAIConfirmation`. Escape `<>"` in context. Tag history by author role and drop viewer turns
      from editor context. **Done when:** a test proves a model-emitted delete returns a proposal, not
      an execution.
      ✓ Done 2026-09-18 (partial): every update/delete/move now becomes a signed proposal on all three
      channels. Still open (P2): escaping context values and author-tagging shared history.

- [x] **P1-4. Offline cold start.** [code, unverified on device] `FarmContext.tsx:541` uses
      `auth.getUser()` (a network call). Offline, it resolves `{user:null}`, so the saved copy never
      loads and the installed PWA opened in a paddock shows "No se pudo cargar el campo."
      Fix: fall back to `getSession()` (local) on `AuthRetryableFetchError`.
      **Done when:** the app opens offline in DevTools and shows the snapshot.
      ✓ Done 2026-09-18: falls back to `getSession()` when `getUser()` can't reach Supabase. Not yet
      tried on a device.

- [x] **P1-5. Stop re-running auth and farm load on every navigation.** [code] `FarmContext.tsx:516-554`
      depends on `pathname`. Each click fires `getUser` + `/api/farm` + `/api/sections` + `/api/alerts`,
      bypassing the 5-min throttle. Fix: subscribe once and refresh on `userId` change only.
      **Done when:** navigating between 3 pages produces no repeat `/api/farm` calls in the network log.
      ✓ Done 2026-09-18: the bootstrap keys on an `isAuthRoute` flag; invite acceptance refreshes
      explicitly.

- [x] **P1-6. Security headers + open redirect.** [live/code]
      - Live sends only HSTS. Add CSP (allow Supabase, OSM tiles and Open-Meteo; Groq is server-only,
        so it needs no entry), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, and
        `Permissions-Policy` (microphone=self) via `next.config.ts` `headers()`.
      - `safeNextPath` (`src/lib/navigation.ts:1-4`) accepts `/\evil.com` and `/%09/evil.com`, which
        post-login lands off-site. Validate with `new URL(value, origin).origin === origin`.
      **Done when:** the headers are present on live and tests cover the redirect cases.
      ✓ Done 2026-09-18: open redirect fixed (tests added). Headers: CSP `frame-ancestors/object-src/
      base-uri/form-action`, XFO, nosniff, Referrer-Policy, Permissions-Policy. A full script/connect CSP
      still needs a nonce strategy (P2).

- [x] **P1-7. Clear offline data on logout.** [code] The `campoai:offline-*:<uid>` localStorage (herd,
      finances, chat) survives logout for 7 days (`NavBar.tsx:172-177`, `FarmContext.tsx:535-538`).
      Call `clearOfflineSnapshots` in the SIGNED_OUT path. Also have the SW refuse to cache
      `response.redirected` (a login page stored under an app route).
      ✓ Done 2026-09-18: SIGNED_OUT clears the snapshots; the SW skips redirected responses (shell cache v6).

## P2 — robustness & quality (next iterations)

**AI pipeline**
- [ ] Execute multi-op AI batches atomically via one `apply_ai_operations(p_farm_id, jsonb)` RPC, or
      stop at the first error and return a per-op receipt. Today a partial batch plus a retry duplicates
      rows (`ai.ts:910-1393`).
- [ ] Bind confirmation tokens to `userId` and each target row's `updated_at`. Sign with a dedicated
      secret, not the service-role key (`ai-confirmation.ts:97`). Record consumed proposals outside
      `chat_requests`, since "Limpiar historial" wipes them and re-enables replay.
- [ ] Per-table/per-action field schemas (zod-like): allowed columns, numeric bounds, enum checks on
      update (`cattle.category`, `health_status`, `activities.type`). Explicitly reject `move` on
      non-cattle tables (`ai-validation.ts:59`).
- [ ] Groq budget: estimate tokens and trim context to ~6k (it can hold 2000 cattle + 20×4000-char
      history + 4000 max_tokens). Handle 429 separately with Retry-After, and don't persist it into the
      replayed idempotent response.
- [ ] Split `ai.ts` (1434 lines) into `ai-farm-context`, `ai-prompt`, `ai-groq`, `ai-process`,
      `ai-policy`, `ai-executor*` and **`ai-pipeline.ts` (`runAIChatTurn`)**. The claim → process →
      guard → confirm → execute → persist sequence is copy-pasted across chat, audio and WhatsApp,
      which is how WhatsApp lost `enforceAIWriteAccess`.
- [ ] Tests: `executeOperations` with a fake Supabase builder (farm_id forcing, cross-farm references,
      `NEW_SECTION_` placeholders, partial batch), malformed model JSON, route-level 403/replay/mismatch.

**Security / platform**
- [ ] Rate limiter is an in-memory `Map` per serverless instance and never evicted (`rate-limit.ts:46`).
      Move it to a Supabase table with an atomic increment, key per user and per farm, and apply it
      to imports, sample-data and invites.
- [ ] Before enabling WhatsApp (latent today): rate-limit per sender, don't auto-create a farm for
      unknown numbers (`whatsapp/route.ts:241-267`), and verify phone ownership (OTP) before mapping
      `owner_phone`.
- [ ] Audio: set the limit to ~4 MB (Vercel's body cap is 4.5 MB, the code says 10 MB), and reject a
      missing Content-Length before `formData()`.
- [ ] CSV export: guard only string cells, and add `\t`/`\r` to the formula guard. `-500` currently
      exports as `'-500` (`csv.ts:9`).
- [ ] Supabase Auth: enable leaked-password protection (free toggle).

**Database**
- [ ] Delete or archive `supabase/_PENDING-migrations-015-030.sql`. Re-pasting its 026/028 sections
      after 031 reopens `chat_requests` to `public`.
- [ ] Fresh installs only: `DROP FUNCTION IF EXISTS record_weight(uuid,uuid,date,numeric,text)`. The
      010 and 017 overloads are ambiguous (PGRST203) for 5-arg calls (`ai.ts:1051`). Live already has
      only the 6-arg version.
- [ ] Integrity: CHECK constraints (`NOT VALID` → validate) on `cattle.count >= 0`,
      `inventory_items.current_stock >= 0` and `financial_transactions.amount >= 0`, plus a currency
      enum. Give `update_inventory_stock` UPDATE/DELETE branches and a fixed `search_path`.
      `farms.user_id` needs `ON DELETE SET NULL`.
- [ ] Add an idempotency key to `move_cattle`; a retried split move splits twice.
- [ ] [unverified] A farm delete cascade fires audit triggers that insert `activities` for the deleted
      farm, which may FK-fail the sample-data rollback. Repro on a branch first.
- [ ] Performance/storage (500 MB free tier): composite `(farm_id, created_at desc)` indexes on
      `activities` and `chat_messages`, `crop_applications(farm_id)`, the 13 unindexed FKs, and
      `(select auth.uid())` in policies. Add 30-day retention for `whatsapp_events`/`chat_requests`.
- [ ] Make migrations re-runnable (`CREATE OR REPLACE`, `DROP POLICY IF EXISTS` pairs; 017:101 and
      019:14 aren't), and fix the stale `full_setup.sql` header (lines 5-7).

**Frontend**
- [ ] a11y: 84 `<Label>`s without `htmlFor` across the dialog forms. Add `src/components/FormField.tsx`
      with auto ids. Chat input label, `aria-live` on replies, touch targets of at least 44px.
- [ ] Contrast (GOAL C was marked done but fails): `text-emerald-600` (~3.8:1) and `text-amber-600`
      (~3.2:1) on white, 47 uses including `status-styles.ts:9-20`. Use `-700` in light mode.
- [ ] `src/lib/format.ts`: `formatMoney(n, currency)` via `Intl.NumberFormat("es-UY")`, replacing 14
      bare `toLocaleString()` and the `$`-for-every-currency prefix (`finanzas:871`). Use
      `parseLocalizedNumber` + `inputMode="decimal"` on the 19 number inputs. Accents ("Producción",
      "Categoría", "Sección", "Escribí").
- [ ] Bundle: load Recharts through `next/dynamic` (duplicated ~101 KB gz chunks in `metricas` and `peso`).
      Import Supabase lazily in `NavBar` logout (53 KB gz on all 21 pages).
- [ ] SW asset cache `campoai-public-assets-v1` grows forever. Keep a per-build manifest and prune on
      activate.
- [ ] Refactor the big pages (inventario 1267, sanidad 1102, finanzas 1034 lines) with
      `useApiResource` (the ~15 copies of the fetch/offline/truncation pattern), `useEntityForm` +
      `EntitySheet`, `RowActionsMenu` and `usePagination`. Fix the `FarmMembersCard` stale-response race.

**Repo hygiene**
- [ ] The Supabase migration ledger is incomplete (only migrations applied via MCP are listed). Record
      031+ through `apply_migration` so drift is visible. Extend `check-supabase-setup.mjs` to diff
      contents, not just presence.

---

## What's solid (keep it)

- Every API route derives `farm_id` from the session, never from input. Updates and deletes are also
  constrained by `farm_id`, and FK references are validated per farm, including in the AI executor.
- CSRF check at the proxy, a generic error surface (no provider messages leak), and body/row caps
  on JSON, imports and exports.
- WhatsApp webhook: HMAC over the raw body, `timingSafeEqual`, fails closed.
- Transactional RPCs are SECURITY INVOKER with fixed `search_path`, service-role-only, and use
  `FOR UPDATE` row locks. Idempotency keys are unique per farm.
- Offline layer: `/api/*` is never SW-cached, snapshots are per user, and partial writes roll back.
- A daily Vercel cron on `/api/status` keeps the free-tier Supabase project from pausing.
