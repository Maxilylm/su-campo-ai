# GOAL — CampoAI UI/UX, style & integration audit

The platform is feature-complete (see `GOAL-features.md`) and hardened (`GOAL-hardening.md`).
This goal is an **audit + remediation pass**: make the experience consistent, mobile-complete,
accessible, and cohesive — especially the 8 newly-added features, which were built desktop-first.

**Scope:** the app only. $0 (no new services). Keep `build`/`lint`/`test` green every iteration;
add a test when a fix introduces pure logic. One box per iteration: AUDIT (grep/read the relevant
files), identify concrete gaps, FIX them, verify, check the box, commit. Don't gold-plate — each box
has a clear "done when". WhatsApp Business API stays out of scope.

**Audit baseline (verified 2026-06-14):**
- Mobile bottom nav = Inicio / Produccion / Gestion / Mapa / Chat only. **Pesajes & Reportes are
  unreachable on mobile**; the alerts bell, export menu, and ⌘K palette are desktop-only (in the
  `sm:flex` bar). Gestion mobile icon is `BarChart3` (wrong metaphor).
- Missing states: `mapa` (no loading/empty), `metricas` (no empty), `reportes` (no empty).
- Several `size="icon"` / icon-only buttons lack `aria-label` (only the new Bell has one).
- Hardcoded status colors (emerald/red/amber) are scattered across ~19 files — many intentional
  (income/expense/severity) but not centralized; verify dark-mode safety.
- Home fires duplicate `/api/alerts` calls (NavBar badge + AlertsPanel) plus weather + insights.

---

## A. Navigation & mobile parity  (functional integration — do first)
- [x] **Mobile reachability.** Every route reachable on mobile. Add Pesajes & Reportes to the mobile
      experience (extend the bottom bar or add a "Más" sheet/menu). Surface the **alerts badge** and
      **export** on mobile too (they're desktop-only now). Fix the Gestion mobile icon.
      Done when: from a narrow viewport, every page + alerts + export is reachable; build green.
      ✓ Done 2026-06-14: added a mobile top bar (sticky) with Logo, alerts Bell+badge, ThemeToggle,
      and a "Menú" dropdown listing every page (op-type filtered) + export + logout. Deduped export
      links into a shared EXPORT_LINKS const (desktop + mobile). Bottom-bar Gestión icon → Layers.
- [x] **Command palette mobile trigger.** ⌘K is keyboard-only. Add a visible search affordance
      (e.g. a search button in the mobile header/bottom bar) that opens the same `CommandPalette`.
      Done when: mobile users can open the palette without a keyboard.
      ✓ Done 2026-06-14: CommandPalette also listens for a `campoai:open-palette` window event.
      Mobile top bar gets a Search icon button; desktop gets a "Buscar ⌘K" affordance for discovery.
- [ ] **Discoverability parity.** Confirm every page is in BOTH the nav and the command palette;
      reconcile any drift. Done when: nav routes == palette routes (minus intentional omissions).

## B. State consistency (loading / empty / error / feedback)
- [ ] **Fill missing states.** Add skeleton/loading + empty states to `mapa`, `metricas` (empty),
      `reportes` (empty when a report has no data), matching `LoadingPage`/`EmptyState` patterns.
- [ ] **Mutation feedback audit.** Every create/update/delete shows a `toast`; every destructive
      action uses `ConfirmDialog`. Audit all pages; fill gaps (esp. new `peso` page, export errors).

## C. Accessibility
- [ ] **Labels for icon-only controls.** Every `size="icon"` / bare-icon button gets an `aria-label`
      or `sr-only` text. Audit NavBar, ThemeToggle, finanzas, inventario, hacienda, agricultura.
- [ ] **Forms & semantics.** Every input has an associated `<Label>` (htmlFor/id); each page uses a
      single `<main>` landmark; interactive divs that act as buttons become `<button>`. Spot-fix gaps.
- [ ] **Status-color contrast & non-color cues.** Status badges/alerts don't rely on color alone
      (add icon/text); verify text-on-tint combos are legible in light AND dark mode.

## D. Visual consistency / design tokens
- [ ] **Centralize status colors.** Extract the repeated severity/status color logic (alert high/med,
      income/expense, water/pasture status, vaccination status) into one shared map/util so the
      palette is consistent and dark-mode-correct. Replace ad-hoc duplicates. Add a test if it's pure.
- [ ] **Card/spacing parity.** AlertsPanel, WeatherPanel, InsightsCard, StatCard, and the new report/
      peso cards share radius, padding, border, and heading style. Normalize the outliers.

## E. Integration cohesion & performance
- [ ] **Dedupe home data fetching.** NavBar badge and AlertsPanel both hit `/api/alerts`; share a
      source (lift into `FarmContext` or a tiny hook) so home loads it once. Note the home fetch fan-out.
- [ ] **Cross-linking & breadcrumbs.** Related modules link to each other (peso↔hacienda, reportes
      from finanzas/inventario headers); every subpage has correct breadcrumbs. Fill gaps.

## Done criteria (verify, then stop the loop)
- [ ] All A–E boxes checked; `build`/`lint`/`test` green.
- [ ] Deployed to Vercel prod; `/api/status` `{ok:true}`; spot-check a few pages respond.
- [ ] `strategy.md` gets a "CampoAI UI/UX audit" learnings entry.

---

## Loop protocol
Each iteration: read this file → first unchecked box → audit the named files → apply focused fixes →
`npm run build` + `npm run lint` + `npm test` (add a test for new pure logic) → check the box + commit
(one concern per commit). When all A–E boxes are checked: deploy to prod, update `strategy.md`, end
the loop. $0 only; never build WhatsApp Business API.
