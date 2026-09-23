# LOOP — continuous improvement for CampoAI

One iteration = one pull request: **audit → pick → execute → review → merge → verify → record.**
The backlog and the per-item history live in `GOAL-field-ops.md` (and the older `GOAL-*.md` files);
this file is only the protocol and the iteration ledger.

Constraints that never bend: $0 (no new paid services without the owner saying so), Spanish UI
(es-UY), never force-push `main`, never delete farm data outside a rolled-back test, one migration =
one ledger entry.

---

## 1. Audit — collect signals, update the backlog

Run every signal, not just the one you expect to matter. Each finding becomes a backlog line with
**value** (who is hurt, how often), **effort** (S/M/L) and **risk** (touches auth, money, migrations,
the AI write path?).

| Signal | How |
|---|---|
| Production errors | Vercel MCP `get_runtime_errors` (7d) and `get_runtime_logs` with `statusCode: 5xx` (24h) |
| Liveness | `curl https://campo-ai-mlx.vercel.app/api/status` → `{"ok":true}` (includes the Groq model probe) |
| Database | Supabase MCP `get_advisors` security + performance; `npm run check:supabase` |
| Dependencies | `npm audit --omit=dev` (high/critical only) |
| Code health | `npm run verify` on `main` must be green before anything else |
| Product | walk `/`, `/gestion/plan`, `/mapa`, `/chat` in the logged-in browser; anything confusing is a finding |
| Owner requests | new asks from the owner go to the top of the ranking |

## 2. Pick — one item, written down before any code

Rank by value ÷ effort, break ties toward lower risk. Before writing code, add to the item in
`GOAL-field-ops.md`: **done when** (observable in production) and **verify by** (the exact live check).
Items blocked on the owner (credentials, paid services, dashboard toggles) are marked ⛔ and skipped.

## 3. Execute — on a branch

- Branch `loop/<n>-<slug>` from an up-to-date `main`.
- Pure logic goes in `src/lib/*.ts` with a test next to it, written first when the behavior is new.
- Migrations: file in `supabase/`, section appended to `full_setup.sql`, row in `supabase/README.md`,
  applied with Supabase MCP `apply_migration`, then proven with a `DO` block that ends in
  `RAISE EXCEPTION 'ROLLBACK_OK'` (see migration 045 in `GOAL-field-ops.md`).
- Anything that reads farm data into the AI prompt is escaped; anything the AI can write is validated.

## 4. Review — gates, then an independent reader

1. `npm run verify` (typecheck, lint, tests, Supabase ledger, build). Red = not done.
2. Push the branch and open a PR. GitHub Actions (`.github/workflows/verify.yml`) re-runs the gates on
   a clean machine; Vercel builds a preview from the same branch.
3. An independent reviewer agent reads the PR diff with no context from the implementation and
   reports correctness bugs only. Each finding is checked against the code; confirmed ones are fixed
   on the branch, the rest get a one-line reason in the PR.
   Docs-only PRs (no code, SQL or config) skip this step.
   **Anything that adds or changes a database trigger or RPC** also gets a lock-order question in the
   review brief: which rows each path locks, in what order, and whether two concurrent opposite
   operations can wait on each other (loop 1b: a trigger on `cattle` deadlocked A→X / X→A moves).
4. UI changes: WCAG AA contrast measured for every new color pair (light and dark tokens in
   `src/app/globals.css`), ≥ 4.5:1 for text.

## 5. Merge

Squash-merge when CI is green and review findings are resolved. Pushing uses the `Maxilylm` token
(the active `gh` account on this machine cannot write to the repo):

```
GH_TOKEN=$(gh auth token --user Maxilylm) gh pr merge <n> --squash --delete-branch
```

The merge to `main` triggers the production deploy. Do not also run `vercel deploy`. Merges that change
only Markdown files skip the build (`ignoreCommand` in `vercel.json`), so recording costs no deploy.

## 6. Verify in production

- Wait for the newest Production row in `vercel ls` to be Ready.
- `/api/status` is `{"ok":true}`; no new 5xx in `get_runtime_logs` for the touched routes.
- Perform the item's **verify by** step in the logged-in browser. Changes to demo data made while
  testing are reverted, and the revert is checked with SQL.
- **Regression → revert first** (`gh pr revert` or a revert commit), investigate second.

## 7. Record

- Check the item in `GOAL-field-ops.md` with what shipped and what was *not* verified.
- Add a ledger row below.
- New non-obvious operational facts go to Claude's memory, not here.

---

## Ledger

| # | Date | PR | Item | Verified live |
|---|---|---|---|---|
| 0 | 2026-09-22 | #17 | The loop itself: `LOOP.md`, `npm run verify`, CI on every PR | CI green on the PR and on `main` |
| 1 | 2026-09-23 | #18 | Grazing history per potrero (migration 047) | Real whole-herd move opened/closed periods; panel "Historial" line; data reverted |
| 1b | 2026-09-23 | #19 | Peak herd per period (048) + lock-order fix (049) | Live check found 48 head recorded as 3; review found a swap-move deadlock in the fix; after 049 the same move recorded a running peak of 48; data reverted |
| 2 | 2026-09-23 | #21 | Verify API sessions locally with `getClaims` (ES256 JWKS) | Signed-out and forged `alg:none` → 401; logged-in medians 979→391, 475→341, 883→470 ms, worst case 5.2 s→0.6 s; review caught expired-token 503 before merge |
| 3 | 2026-09-23 | #22 | Skip Vercel builds for Markdown-only merges (`VERCEL_GIT_PREVIOUS_SHA`) | Config merge deployed; the #24 docs-only merge created no deployment; review caught the multi-commit-push skip |
| 4 | 2026-09-23 | #23 | Share the membership lookup across a page's API burst (15 s per-user cache, 5 s cold timeout) | Cold load after deploy: no 503, no banner; 5-endpoint burst 400-830 ms; review caught stale re-cache after invalidation (regression test) |
| 5 | 2026-09-23 | #25 | Readable activity feed (found in the product walk: raw "Update cattle (<uuid>)" rows on the home page) | Home feed shows only readable entries, no ids; Registro humanized |
| 6 | 2026-09-23 | #27 | Next spray window from hourly wind/rain (plan, weather card, assistant) | Home card: "No pulverizar" + "Próxima ventana: hoy 15–20 h", matching an independent computation from the live API |
| 7 | 2026-09-23 | #29 | One wind number, one spray verdict (walk found "15 km/h" labeled both apto and no) | Home, Agricultura and Plan del día all read "apto, viento 15 km/h" at the same moment |
| 8 | 2026-09-23 | #31 | "Esta semana" in Plan del día + vaccine supply check (doses vs inventory) | Plan shows "Aftosa: 146 dosis para todo el campo; hay 200 en stock" and Lunes 28; review caught substring matching ("IBR" ~ "Fibra") |
| 9 | 2026-09-23 | #33 | Weather route: 5 s cold-start lookup + client retry | Cold page after deploy: weather card loaded, 0 × 5xx |
