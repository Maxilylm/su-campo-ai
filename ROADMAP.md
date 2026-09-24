# CampoAI roadmap

CampoAI is a farm-management web app for Uruguayan and Argentine livestock and crop operations
(Spanish es-UY UI). One farm-scoped dashboard holds hacienda, potreros with stocking and rotation,
crops, sanidad, inventory, finances, tasks and parcel maps, shared between owner/editor/viewer
members. Its assistant (Groq, text or voice, also over WhatsApp) answers from the live farm context
and writes records after validation, with a signed confirmation for anything that changes existing
data. It works read-only offline as a PWA. Budget: $0 (Supabase free, Groq free, Vercel Hobby).

How work is picked, shipped and verified: [`LOOP.md`](./LOOP.md). What already shipped and why:
[`docs/history.md`](./docs/history.md). Product learnings: [`strategy.md`](./strategy.md).

Each item: **value** (who benefits, how often) · **effort** (S/M/L) · **risk** (auth, money,
migrations, the AI write path).

---

## In progress (covered by other work right now)

- **Full CSP with a nonce.** Today's CSP covers only `frame-ancestors`/`object-src`/`base-uri`/
  `form-action`; script/connect-src needs a nonce threaded through Next's inline hydration scripts.
- **Frontend revamp.** Includes the remaining a11y work (44 px touch targets; every `Button` size
  tops out at 40 px) and the big-page refactor (inventario, sanidad, finanzas: shared
  `useApiResource`, `useEntityForm` + `EntitySheet`, `RowActionsMenu`, `usePagination`, and the
  `FarmMembersCard` stale-response race).

## Open

| Item | Value | Effort | Risk |
|---|---|---|---|
| **`runAIChatTurn` pipeline.** The claim → process → guard → confirm → execute → persist sequence is copied across `/api/chat`, `/api/chat/audio` and `/api/whatsapp`; that duplication is how WhatsApp once lost `enforceAIWriteAccess`. `ai.ts` is now split, so this is the remaining half of that refactor. | Every AI channel stays consistent | M | AI write path |
| **Route-level tests for the AI routes**: 403 for viewers, confirmation replay, subject mismatch, idempotent replay. Needs a route-handler test harness. | Guards the write path against regressions | M | Low (tests only) |
| **Budget the chat history too.** The farm context is capped at ~6k tokens (`ai-context-budget.ts`), but up to 20 history turns of 4000 chars are not. | Fewer Groq 413/429s on long chats | S | Low |
| **Concurrent `move_cattle` submissions.** The idempotency key covers sequential retries, not two simultaneous submits racing (needs claim-before-execute). | Rare double split | S | Migration, RPC lock order |
| **Cold function starts.** Auth and membership lookups are fixed (loops 2 and 4); the first request after idle still takes ~4 s on `/api/field-status`. Platform-bound on Hobby. | First load after idle | M | Low |
| **Fully re-runnable `full_setup.sql`.** Policies and functions are guarded; scattered `ALTER TABLE … ADD CONSTRAINT` statements are not. | Fresh installs, disaster recovery | S | Migrations (file only) |
| **Confirmation phrase lead-ins.** The WhatsApp/audio matcher allows one lead-in word ("Sí, confirmo" works, "Sí, dale, confirmá" does not). Widen the lead-in list if real Whisper transcripts get rejected; never widen the verb match. | Audio users | S | AI write path |

### Not yet verified in production

A logged-in walk of Sanidad (dates, "Vencida" on the due day), Agenda "Mañana" on an overdue task,
Pendientes after 21:00 local; the owner → invite → accept flow with two real accounts; offline cold
start and the offline field-status snapshot on a real device; phone-width layout; a real AI
auto-insert held by Jev in production (verified locally against the live TypeSafe API).

## Blocked

- ⛔ **Leaked-password protection** (Supabase Auth). Requires Supabase Pro; the budget is $0.
- ⛔ **Plan del día over WhatsApp** (a "plan" keyword replying with `dailyPlanText`). Production has
  only `WHATSAPP_VERIFY_TOKEN`; needs `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. The same
  blocker covers WhatsApp phone-ownership verification (OTP) and self-service phone linking, which
  would let the auto-create-farm-on-first-message path (rate-capped ~30/day) be removed.

## Accepted risks

- **Occupancy clock lock order (045) vs. opposite moves.** The trigger locks the departure potrero's
  clock before the arrival's. A UI move A→X racing an AI batch move X→A could in principle cycle on
  `section_occupancy`; both would need to empty/first-fill both potreros at once, which contradicts
  itself. If it ever fires, Postgres aborts one side (40P01) and the batch rolls back whole. A full
  fix locks both clocks in section-id order inside 045's trigger (review of #52).
- **`apply_ai_operations` has no SQL-side column allowlist.** TypeScript strips disallowed columns
  first and the RPC is service-role only; an unknown column fails closed. Add a per-table allowlist
  in SQL if another caller ever appears.

- **Advisors 0028/0029: `has_farm_role` / `is_farm_owner` are SECURITY DEFINER and executable by
  anon/authenticated.** Both key on `auth.uid()`: anon always gets false and a user only learns their
  own role, so no data is exposed. DEFINER is required to avoid RLS recursion (the `farm_members`
  policies call `has_farm_role`). Revisit only if either starts taking an arbitrary user id.
- **`inventory_items` staleness side effect.** Stock movements bump the item's `updated_at`, so an
  AI proposal to edit an item is rejected as stale if a movement touched it in between. Correct, if
  surprising.
