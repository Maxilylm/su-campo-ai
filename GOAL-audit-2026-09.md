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

> Deployed to production 2026-09-19 via `vercel deploy --prod` (git push is denied — see below), twice:
> first at commit `247318d`, then again at `13c2587` after the DB work below. The second deploy was
> **not optional** — migration `034` dropped `move_cattle`'s old 4-arg overload, and the first deploy's
> app code still called it with 4 args, which would have 404'd (PGRST202) every "move cattle between
> sections" AI action until the redeploy landed. Confirmed both `campo-ai-mlx.vercel.app` and
> `su-campo-ai.vercel.app` serve the final build. Not separately re-verified per-feature (formatMoney
> rendering, an actual audio upload, an offline paddock scenario, an actual AI move) — that needs an
> authenticated browser session.

**AI pipeline**
- [ ] Execute multi-op AI batches atomically via one `apply_ai_operations(p_farm_id, jsonb)` RPC, or
      stop at the first error and return a per-op receipt. Today a partial batch plus a retry duplicates
      rows (`ai.ts:910-1393`).
      Not started 2026-09-19. A full iteration on its own: a new RPC (or per-op receipt contract),
      `executeOperations` rewritten around it, and tests for the partial-batch-plus-retry case.
- [ ] Bind confirmation tokens to `userId` and each target row's `updated_at`. Sign with a dedicated
      secret, not the service-role key (`ai-confirmation.ts:97`). Record consumed proposals outside
      `chat_requests`, since "Limpiar historial" wipes them and re-enables replay.
      Partial 2026-09-19: userId binding and the dedicated secret are both done — `subjectId` (userId
      for web/audio, sender phone for WhatsApp) is now part of the signed payload and checked on
      verify, token version bumped so old tokens fail closed; signing prefers an optional
      `AI_CONFIRMATION_SECRET` over the service-role key, falling back to the old behavior when unset
      so this didn't need to block on the user setting it (documented in `.env.example`; setting it is
      still recommended, since it decouples token validity from service-role-key rotation). Not done:
      binding to each target row's `updated_at` (an optimistic-concurrency check so a stale proposal
      can't apply to a row that changed since — needs `executeOperations` to compare/fail per-op, not
      just a token-verification change) and moving consumed-proposal tracking outside `chat_requests`
      (a real replay-window fix, needs a new table + wiring "Limpiar historial" not to touch it) — both
      are separate, real pieces of work left for their own pass.
- [x] Per-table/per-action field schemas (zod-like): allowed columns, numeric bounds, enum checks on
      update (`cattle.category`, `health_status`, `activities.type`). Explicitly reject `move` on
      non-cattle tables (`ai-validation.ts:59`).
      ✓ Done 2026-09-19: `AI_ALLOWED_COLUMNS` (per-table column allowlist, `stripDisallowedColumns`)
      applied in `executeOperations` before any insert/update. `cattle.health_status` now enum-checked
      (`healthy`/`enfermo`/`tratamiento`/`cuarentena`, matching the UI's own `Select`). `activities` was
      previously fully exempt from `validateAIOperation` (an early-return skipped it); now
      length-bounded (`type` ≤ 50 chars, `description` ≤ 2000) rather than a fixed enum, since there's
      no real closed set of `type` values (system code uses `setup`/`registration`, but a user-requested
      free-text note is legitimate). `move` on a non-cattle table previously silently matched no branch
      and did nothing; now explicitly rejected with a log entry. 5 new tests in `ai-validation.test.ts`,
      2 new tests in `execute-operations.test.ts`.
- [ ] Groq budget: estimate tokens and trim context to ~6k (it can hold 2000 cattle + 20×4000-char
      history + 4000 max_tokens). Handle 429 separately with Retry-After, and don't persist it into the
      replayed idempotent response.
      Partial 2026-09-19: the 429/idempotency half is done — `AIRateLimitedError` (`ai-errors.ts`)
      carries Groq's `Retry-After`, thrown from both Groq call sites (`processMessage`'s completion and
      `generateFarmSummary`). All 4 callers (chat, audio, WhatsApp, insights) catch it and return 429
      with `Retry-After`, releasing the idempotency claim via `markChatRequestFailed` instead of
      `completeChatRequest` — a retry now gets a fresh attempt instead of replaying the stale error
      forever. Regression tests in `ai-errors.test.ts`. Not done: the token-budget/context-trimming
      half — estimating tokens and capping `farmContext` + history to ~6k needs real tuning (per-table
      `AI_CONTEXT_LIMITS` already bound row counts, but not an aggregate character/token budget) to
      avoid degrading answer quality; left for its own pass with real measurement, not a guess.
- [ ] Split `ai.ts` (1434 lines) into `ai-farm-context`, `ai-prompt`, `ai-groq`, `ai-process`,
      `ai-policy`, `ai-executor*` and **`ai-pipeline.ts` (`runAIChatTurn`)**. The claim → process →
      guard → confirm → execute → persist sequence is copy-pasted across chat, audio and WhatsApp,
      which is how WhatsApp lost `enforceAIWriteAccess`.
      Not started 2026-09-19. Large structural refactor touching every AI code path; deliberately left
      for its own iteration rather than rushed alongside everything else this session touched.
- [x] Tests: `executeOperations` with a fake Supabase builder (farm_id forcing, cross-farm references,
      `NEW_SECTION_` placeholders, partial batch), malformed model JSON, route-level 403/replay/mismatch.
      Partial 2026-09-19: `execute-operations.test.ts` adds a minimal chainable in-memory fake standing
      in for the supabase-js builder (insert/update/delete, `.eq()`, `.single()`/`.maybeSingle()`),
      mocking `@/lib/supabase` so both `ai.ts`'s and `auth.ts`'s `getSupabaseAdmin()` calls resolve to
      it. 6 tests: farm_id forced on insert regardless of model input, `NEW_SECTION_` placeholder
      resolves to the real id from an earlier op in the same batch, a cross-farm relation reference is
      rejected, a batch continues past one failed op (partial batch), malformed/non-array `operations`
      degrades to an empty batch instead of throwing, and an update/delete match with extra fields is
      rejected. Not done: route-level 403/replay/mismatch tests — those exercise the chat/audio/WhatsApp
      route handlers themselves (auth, idempotency claiming, confirmation verification), not
      `executeOperations`, and need a different (route-level) test harness this box didn't build.
- [ ] **(from P1-3, partial)** Escape `<>"` in AI-prompt context values, and tag chat history by author
      role so a viewer's turn is dropped from what an editor's model call reads (`ai.ts:359-372`,
      `chat/route.ts:100,218`).

**Security / platform**
- [x] **(from P1-2, deferred)** Trim `/api/status`'s public payload to `{ok}` only; put
      `missingMigrations`/`issues`/reasons behind auth or `CRON_SECRET` (`status/route.ts`).
      ✓ Done 2026-09-19, resolved differently than the literal ask because a real product conflict
      exists: `login/page.tsx` (unauthenticated) fetches `/api/status` directly and renders
      `missingMigrations`/`issues` via `<ServiceHealthReport>` as an intentional pre-login "your
      Supabase isn't set up right" diagnostic (also on `setup`/`gestion/campo`), and
      `shouldRetryServiceStatus` reads the reason fields to decide whether a failed check is worth
      retrying — trimming unconditionally would have broken both, and there's no `CRON_SECRET` wired
      into this project to gate on. Instead gated on `Sec-Fetch-Site`: a same-origin request (the app's
      own fetch, which is what the login/setup/campo pages make) gets the full payload; everything else
      (curl, a scanner, another origin, or a client with no Fetch Metadata at all) gets only `{ok}`.
      Added `Vary: Sec-Fetch-Site` so the CDN can't serve a cached same-origin full-detail response to a
      later cross-origin request within the 30s edge-cache window. Verified live: cross-origin →
      `{"ok":true}`; simulated same-origin → full payload.
- [ ] **(from P1-6, deferred)** A full script/connect-src CSP needs a nonce strategy (Next inline
      hydration scripts require one); today's CSP only covers `frame-ancestors`/`object-src`/`base-uri`/
      `form-action`.
      Not started 2026-09-19. Needs `middleware.ts` nonce generation threaded through Next's inline
      hydration scripts — non-trivial, its own iteration.
- [x] Rate limiter is an in-memory `Map` per serverless instance and never evicted (`rate-limit.ts:46`).
      Move it to a Supabase table with an atomic increment, key per user and per farm, and apply it
      to imports, sample-data and invites.
      ✓ Done 2026-09-19 via `036_rate_limit_buckets.sql` (applied live, smoke-tested with 4 calls at
      capacity 3 — 4th correctly blocked). `checkRateLimit` is now async: tries
      `consume_rate_limit_token` (atomic `FOR UPDATE` row lock) first, falls back to the original
      in-memory bucket if the RPC errors (migration not applied / Supabase unreachable) so an outage
      degrades instead of 500ing. Wired into cattle/financial/inventory imports (`import:<farmId>`),
      sample-data generation (`sample-data:<userId>`), invite creation (`invite:<farmId>`) and invite
      acceptance (`invite-accept:<userId>`) — none of these had any rate limiting before. Kept
      `consumeToken`'s pure logic and its existing tests; added `checkRateLimit` fallback-path tests.
- [x] Before enabling WhatsApp (latent today): rate-limit per sender, don't auto-create a farm for
      unknown numbers (`whatsapp/route.ts:241-267`), and verify phone ownership (OTP) before mapping
      `owner_phone`.
      Partial 2026-09-19: added per-sender rate limiting (`whatsapp:<phone>`, capacity 15/refill 6s —
      WhatsApp had no rate limit at all before, unlike chat/audio), sitting ahead of the farm lookup so
      a flood can't spam-create farms; no rejection message is sent back so a flood isn't amplified into
      more outbound traffic. Not done: the auto-create-for-unknown-numbers behavior itself, and OTP
      phone-ownership verification — both are real feature/UX redesigns (how does a legitimate new
      WhatsApp user get onboarded without auto-create? what does an OTP flow look like over a chat
      webhook?) that need a product decision, not a mechanical fix. WhatsApp remains unconfigured on
      live (`/api/whatsapp` → 503 per baseline), so this stays latent regardless.
      Not started 2026-09-19 — latent, WhatsApp is unconfigured on live per the baseline (`/api/whatsapp`
      → 503), so this has no current exposure.
- [x] Audio: set the limit to ~4 MB (Vercel's body cap is 4.5 MB, the code says 10 MB), and reject a
      missing Content-Length before `formData()`.
      ✓ Done 2026-09-19: `chat/audio/route.ts` now caps the request at 4.5 MB and the file at 4 MB
      (was 12/10 MB), and rejects a missing/non-numeric `Content-Length` with 411 before `formData()`
      is ever called. WhatsApp audio is out of scope — it fetches media server-side from Twilio, not a
      client upload subject to Vercel's body cap. No pure logic added (route handler, no existing API
      route test pattern in this repo); tsc/eslint/vitest all green (346/346).
- [x] CSV export: guard only string cells, and add `\t`/`\r` to the formula guard. `-500` currently
      exports as `'-500` (`csv.ts:9`).
      ✓ Done 2026-09-19: `cell()` now checks `typeof v === "string"` before applying the leading-marker
      guard, so numeric cells (e.g. `-500`) render as plain numbers. Guard set extended to `\t`/`\r`.
      Regression tests added in `csv.test.ts` (11/11 pass). tsc/eslint/vitest all green (346/346).
- [ ] Supabase Auth: enable leaked-password protection (free toggle).
      Checked 2026-09-19: not exposed by any loaded Supabase MCP tool (no auth-config tool in the set;
      `get_advisors` still reports `auth_leaked_password_protection` WARN). Needs a manual toggle by the
      user in the dashboard: Authentication → Providers → Email → enable leaked-password protection.

**Database**
- [x] Delete or archive `supabase/_PENDING-migrations-015-030.sql`. Re-pasting its 026/028 sections
      after 031 reopens `chat_requests` to `public`.
      ✓ Already done: the file was deleted in commit `5507bdf` (earlier P0-1 work), before this pass
      started. Confirmed gone from the working tree.
- [x] Fresh installs only: `DROP FUNCTION IF EXISTS record_weight(uuid,uuid,date,numeric,text)`. The
      010 and 017 overloads are ambiguous (PGRST203) for 5-arg calls (`ai.ts:1051`). Live already has
      only the 6-arg version.
      ✓ Already done: this `DROP FUNCTION` is the last statement in `032_rescope_service_policies.sql`
      / `full_setup.sql`, applied live already. Confirmed live has only the 6-arg overload.
- [x] Integrity: CHECK constraints (`NOT VALID` → validate) on `cattle.count >= 0`,
      `inventory_items.current_stock >= 0` and `financial_transactions.amount >= 0`, plus a currency
      enum. Give `update_inventory_stock` UPDATE/DELETE branches and a fixed `search_path`.
      `farms.user_id` needs `ON DELETE SET NULL`.
      ✓ Done 2026-09-19 via `033_integrity_and_performance.sql` (applied live, `apply_migration`).
      Verified zero existing violations before adding each CHECK (so plain `CHECK`, no `NOT VALID`
      needed): `cattle.count`, `inventory_items.current_stock`, `financial_transactions.amount` all >= 0;
      added a `currency IN ('USD','UYU','ARS')` enum check on both `financial_transactions` and
      `inventory_items` (both only ever contained `'USD'` live). `update_inventory_stock` now branches
      on `TG_OP` (INSERT/UPDATE/DELETE) and the trigger fires on all three; `search_path` was already
      fixed in 032. `farms.user_id` FK recreated `ON DELETE SET NULL`. Dry-run via `BEGIN…ROLLBACK`
      before applying for real; verified live afterward (constraints, trigger def, FK def all queried).
- [x] Add an idempotency key to `move_cattle`; a retried split move splits twice.
      ✓ Done 2026-09-19: `move_cattle` takes an optional `p_idempotency_key`; on a repeat call with the
      same key it returns the cached `(source_id, destination_id, moved_count, move_mode)` instead of
      re-running the split. `executeOperations` (`ai.ts`) now threads the route's request `Idempotency-Key`
      through as `${requestId}:move:${opIndex}`, wired in chat/audio/WhatsApp. Verified live with a real
      cattle batch: two calls with the same key dropped the source count only once (20→15, not 20→10)
      and created exactly one destination batch, then rolled back. Follow-up migration `034` dropped the
      now-dead 4-arg overload (`CREATE OR REPLACE` with an added param creates a new overload rather
      than replacing the old one — the same ambiguous-overload class 032 fixed for `record_weight`).
      Not implemented: true concurrent-submission locking (claim-before-execute) — this fixes the
      realistic sequential client-retry case, not two simultaneous submits racing each other.
- [x] [unverified] A farm delete cascade fires audit triggers that insert `activities` for the deleted
      farm, which may FK-fail the sample-data rollback. Repro on a branch first.
      ✓ Confirmed and fixed 2026-09-19 via `035_fix_audit_trigger_farm_delete_cascade.sql` (applied
      live). Repro'd exactly as suspected: `DELETE FROM farms` on any farm with audited child rows
      (cattle, sections, ...) failed with `23503 activities_farm_id_fkey violation` — the cascade
      deletes the farm row first, then children, and `log_field_mutation()`'s AFTER DELETE trigger on
      each child unconditionally inserted an `activities` row referencing the now-gone farm. This is
      exactly the sample-data rollback path (`api/sample-data/route.ts` deletes the farm to undo a
      partial create on error) — a failed sample-data generation with any rows already created could
      not be cleaned up. Fix: skip the audit insert once the parent farm no longer exists. Verified
      both the original failure and the fix against live data via `BEGIN…ROLLBACK` (no data touched).
- [x] Performance/storage (500 MB free tier): composite `(farm_id, created_at desc)` indexes on
      `activities` and `chat_messages`, `crop_applications(farm_id)`, the 13 unindexed FKs, and
      `(select auth.uid())` in policies. Add 30-day retention for `whatsapp_events`/`chat_requests`.
      Partial 2026-09-19 via `033_integrity_and_performance.sql`: added all 15 missing FK indexes (the
      advisor count had grown to 15 since 031/032 added tables), composite
      `(farm_id, created_at desc)` on `activities`/`chat_messages` plus `crop_applications(farm_id)`, and
      dropped the two single-column `created_at`-only indexes the performance advisor had confirmed
      unused (now superseded by the composite). `get_advisors` before/after: `unindexed_foreign_keys`
      15 → 0. Deferred (too broad/risky to blind-rewrite without per-policy review):
      `(select auth.uid())` wrapping across ~25 `auth_rls_initplan`-flagged policies, and 30-day
      retention for `whatsapp_events`/`chat_requests` (needs `pg_cron`, available but not enabled on
      this project — enabling it is itself a small decision the user should make).
- [x] Make migrations re-runnable (`CREATE OR REPLACE`, `DROP POLICY IF EXISTS` pairs; 017:101 and
      019:14 aren't), and fix the stale `full_setup.sql` header (lines 5-7).
      ✓ Done 2026-09-19: `full_setup.sql`'s "002 through 032" header was already current (regenerated in
      an earlier session); updated to "034". `CREATE FUNCTION` → `CREATE OR REPLACE FUNCTION` for
      `record_weight`/`record_inventory_purchase` (017) and `create_padron_with_section` (019). Paired
      every `CREATE POLICY` across 002/003/004/005/007/008/009/011/014/026/028 and `full_setup.sql`
      with an immediately preceding `DROP POLICY IF EXISTS` (44 + 52 additions) — most of these files
      had zero pairing before, not just the two example lines. Verified with
      `scripts/check-supabase-setup.mjs` (order/docs/duplicate-index checks) and a `$$`-balance check.
      No live schema change — these are already-applied historical files; this only fixes future
      re-runs and fresh installs. Still not fully re-runnable: unguarded `ALTER TABLE ... ADD CONSTRAINT`
      statements remain scattered across the file (updated the header to say so honestly).

**Frontend**
- [ ] a11y: 84 `<Label>`s without `htmlFor` across the dialog forms. Add `src/components/FormField.tsx`
      with auto ids. Chat input label, `aria-live` on replies, touch targets of at least 44px.
      Partial 2026-09-19: `src/components/FormField.tsx` added (`useId()` + `cloneElement` to inject the
      id onto its single child control — Input/Textarea; **not** for Radix `Select`, which needs the id
      placed directly on `SelectTrigger` instead). Migrated the 21 exact
      `<div className="space-y-2"><Label>text</Label><Input .../></div>` one-liners in
      finanzas/inventario/hacienda to `<FormField>`. Regression guard in `formfield-usage.test.ts`.
      Still open: the remaining ~63 `<Label>`s (mostly wrapping `Select`/multi-line JSX, in
      agricultura/sanidad/peso/campo/setup too), the chat input label, `aria-live` on replies, and the
      44px touch-target sweep — none of those attempted this pass.
- [x] Contrast (GOAL C was marked done but fails): `text-emerald-600` (~3.8:1) and `text-amber-600`
      (~3.2:1) on white, 47 uses including `status-styles.ts:9-20`. Use `-700` in light mode.
      ✓ Done 2026-09-19: blanket `-600` → `-700` across all 18 files that used
      `text-emerald-600`/`text-amber-600` (44 usages); none had a conflicting `dark:text-*-600`
      variant, so no dark-mode regression. `text-red-600` untouched (~4.83:1, already AA). Regression
      test added to `status-styles.test.ts`. tsc/eslint/vitest all green (347/347). Not yet verified
      live — bundled with the other frontend items for one `vercel deploy --prod` at the end.
- [x] `src/lib/format.ts`: `formatMoney(n, currency)` via `Intl.NumberFormat("es-UY")`, replacing 14
      bare `toLocaleString()` and the `$`-for-every-currency prefix (`finanzas:871`). Use
      `parseLocalizedNumber` + `inputMode="decimal"` on the 19 number inputs. Accents ("Producción",
      "Categoría", "Sección", "Escribí").
      ✓ Done 2026-09-19: `formatMoney`/`formatAmount` added (`format.ts`, tested) and wired into every
      money display (finanzas, inventario, metricas, reportes' local `money()` helper, CommandPalette),
      fixing the `$`-literal bug at `finanzas:871`. All 16 `type="number"` inputs across
      setup/campo/hacienda/finanzas/inventario/agricultura/peso/sanidad switched to
      `type="text" inputMode="decimal"`, and every server-side `Number(body.X)` parse for those same
      fields swapped to `parseLocalizedNumber` (sections, cattle, weight, financial, crops, inventory +
      movements, health, vaccinations, farm-input) so comma-decimal input actually reaches the DB as a
      number — this also fixed a real bug where `financial` PUT wrote `body.amount` (a raw string)
      straight to a numeric column. Accents fixed for Producción/Categoría/Sección/Escribí plus the
      same-class lowercase instances (Hectáreas, Ubicación, Stock mínimo, área, acción, eliminará, and
      the AI prompt's "SIN SECCIÓN ASIGNADA"); left the literal placeholder tokens
      (`NEW_SECTION_NombreSeccion`, `uuid-seccion-destino`) and CSV-import column synonyms unaccented on
      purpose. Not touched: `padrones` numeric fields (no client decimal-input UI exists for them).
      tsc/eslint/vitest/`next build` all green (353/353, 59 routes). Not yet verified live.
- [x] Bundle: load Recharts through `next/dynamic` (duplicated ~101 KB gz chunks in `metricas` and `peso`).
      Import Supabase lazily in `NavBar` logout (53 KB gz on all 21 pages).
      ✓ Done 2026-09-19: extracted the chart JSX into `src/components/charts/BarTrendChart.tsx` (shared
      by metricas' two bar charts, dedupes the duplicated JSX too) and `WeightLineChart.tsx` (peso), both
      loaded via `next/dynamic(..., { ssr: false })`. Verified in the production build: neither
      `build-manifest.json`'s `pages` map nor `rootMainFiles` references the chunk containing recharts
      (`grep`ped for `ResponsiveContainer`/`recharts-*` class strings across `.next/static/chunks`) — it
      now exists as a single ~356K on-demand chunk pulled in by two small async wrapper chunks, not
      duplicated per page. `NavBar`'s `getSupabaseBrowser` import moved from module scope into
      `handleLogout` via `await import("@/lib/supabase")`, so the Supabase client no longer ships in
      NavBar's bundle (rendered on every page) — only loaded when a user actually logs out.
      tsc/eslint/vitest/`next build` all green (353/353, 59 routes). Not yet verified live.
- [x] SW asset cache `campoai-public-assets-v1` grows forever. Keep a per-build manifest and prune on
      activate.
      ✓ Done 2026-09-19: `activate` now fetches `/` and `/login` fresh (`cache: "no-store"`) to build a
      manifest of the current build's referenced `/_next/static/` paths, then deletes any
      `PUBLIC_ASSET_CACHE` entry under `/_next/static/` not in that manifest (the explicit icon/manifest
      entries are untouched — only hashed build chunks are eligible). A wrongly-pruned entry isn't a
      correctness bug: the existing fetch handler re-fetches and re-caches anything a page still needs.
      If both fetches fail (offline activation), pruning is skipped entirely rather than risk deleting
      live assets. Regression tests added to `service-worker.test.ts` (text-assertion style, matching
      this file's existing convention since `public/sw.js` runs outside the app's module graph).
      tsc/eslint/vitest all green (354/354); `node --check public/sw.js` confirms valid syntax. Not yet
      verified live (needs a real deploy-over-deploy cycle to observe cache size over time).
- [ ] Refactor the big pages (inventario 1267, sanidad 1102, finanzas 1034 lines) with
      `useApiResource` (the ~15 copies of the fetch/offline/truncation pattern), `useEntityForm` +
      `EntitySheet`, `RowActionsMenu` and `usePagination`. Fix the `FarmMembersCard` stale-response race.

**Repo hygiene**
- [ ] The Supabase migration ledger is incomplete (only migrations applied via MCP are listed). Record
      031+ through `apply_migration` so drift is visible. Extend `check-supabase-setup.mjs` to diff
      contents, not just presence.
      Partial 2026-09-19: `list_migrations` confirms 031-034 are all recorded (031/032 from an earlier
      session, 033/034 applied this pass via `apply_migration`) — no drift for these. Not done: extending
      `check-supabase-setup.mjs` to diff file contents against the ledger (it currently only checks
      ordering/documentation/index presence) — a real tooling addition, deferred.

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
