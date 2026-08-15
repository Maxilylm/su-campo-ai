# CampoAI — Product learnings

## CampoAI features

- Operational features are most useful when they close the loop: alerts should deep-link to a
  resolver, tasks should appear in alerts/calendar/AI/export, and successful mutations should
  refresh shared dashboard state without a full reload.
- Keep slow providers outside the critical path. The AI insight is generated explicitly and then
  cached; the dashboard remains useful when Groq or the network is slow.
- Treat Supabase migrations as a compatibility boundary. Optional features degrade with an
  explicit migration notice rather than taking down the rest of the product.
- Field connectivity is intermittent by design: preserve the last private snapshot, show the
  connection state everywhere, and make stale data visible instead of presenting it as current.
- Offline readiness should be explicit: opportunistic snapshots keep the app resilient, but a
  single user-triggered sync is the reliable handoff before leaving coverage.
- Bound Supabase at the shared client boundary as well as farm lookup and client mutations: a slow
  database request should become a recoverable connection state, not a platform gateway timeout.
- Keep operational surfaces explicit: public health probes can support scheduled keep-alive jobs,
  but authenticated app pages and data APIs stay behind the proxy; public metadata files need an
  explicit allowlist entry. Contrast tokens should be verified as part of the same production pass
  because the login screen is the first surface every user sees.
- Bulk financial imports should be all-or-nothing: preview and normalize CSV rows in the browser,
  then revalidate values, farm ownership, and section consistency on the server before one batch
  insert. A downloadable template reduces support friction for historical data migration.
- A visible tab is not necessarily fresh: refresh page data after a bounded background interval and
  retry the shared farm snapshot faster when the last connection was unhealthy. Keep in-flight and
  focus events coalesced so resilience does not turn into a query storm.
- The service-health panel follows the same foreground policy as operational data, so an old
  Supabase/Auth/Groq diagnosis is rechecked when the operator returns to Mi campo without probing
  on every focus event.
- Error recovery should stay inside the current screen: retry the failed data request instead of
  reloading the whole app and sending the user through middleware again. Request IDs also prevent a
  slow retry from overwriting a newer session or connectivity state.
- CSV compatibility should be consistent across modules: use one localized-number parser on both
  the preview and the server so stock, weights, and financial amounts do not disagree about `1.250,50`.
- Core list endpoints should fail boundedly too: a 7-second Supabase read budget returns a recoverable
  504 before a Vercel invocation timeout, while the client can retry without reloading the app.
- Operational histories follow the same read budget: inventory movements and weight history now
  fail recoverably instead of holding the page until middleware or Vercel times out. Do not apply
  this blindly to writes: the current transactional RPCs cannot be cancelled safely, so idempotency
  must come before returning a timeout that could invite a duplicate retry.
- Map geometry and crop-application histories use the same bounded read path, keeping the map and
  agriculture screens responsive when Supabase is slow or the dataset has grown substantially.
- Independent farm-relation checks run concurrently before mutations, keeping tenant validation
  intact while preventing several slow optional lookups from stacking into a Vercel timeout.
- Critical weighing and inventory forms keep a stable retry key for the same draft, while migration
  017 enforces one database row per farm/key and returns the original row on a late-response retry.
- Padrón creation uses one database transaction for the padrón and its first section; legacy
  projects keep the existing rollback fallback until migration 018 is applied.
- The same padrón transaction carries a stable retry key after migration 019, so a lost response
  cannot create a duplicate map parcel and section.
- Chat history and cached AI summaries use the bounded read path too, so opening those screens
  fails recoverably instead of waiting for a platform-level timeout.
- Cattle ear-tag uniqueness checks are bounded before writes, so a degraded Supabase connection
  returns a retryable diagnostic instead of leaving a create/edit request hanging.
- Bulk CSV imports now receive a 30-second client/server window and bounded relation checks;
  an aborted request tells the operator to verify the result before submitting the same file again.
- CSV imports now carry one stable batch key plus row indexes. Migration 020 makes a committed
  batch replay-safe and rejects reusing that key for a different file, preventing duplicate loads
  after a lost response.
- Financial link checks and inventory movement preflights now use bounded reads too; a slow
  Supabase lookup returns a precise retryable response without putting the write itself on a timer.
- The public readiness probe now reports `ok: false` when required schema migrations are missing,
  so login and monitoring cannot mistake a partially upgraded database for a healthy deployment.
- The demo-data setup flow now has a 30-second window and bounded preflight reads, so a slow
  Supabase connection reports a recoverable state instead of looking like an incomplete setup.
- Shared fetches preserve caller cancellation as well as their timeout. Route changes can stop
  obsolete reads promptly, reducing stale work and avoiding unnecessary pressure on Supabase.
- AI chat and audio routes declare the same bounded 30-second window as their Groq calls, so the
  hosting platform does not terminate a valid, slow response before the upstream timeout settles.
- Deep links from búsqueda, actividad, agenda y mapa are repeatable even when the operator is
  already on the destination screen; query state stays synchronized with the router so the next
  selected record receives focus instead of being ignored by a one-shot mount flag.
- An explicit offline sync also emits the shared data-change event after all private snapshots are
  written, so an already-mounted search palette or dashboard cannot keep serving its old index.
- External SNIG padrón searches now distinguish a timeout from a generic server error and expose a
  retryable 504, keeping a slow cadastral provider from looking like a permanent map failure.
- The offline dashboard now hydrates its cattle and crop KPIs from the explicit entity snapshot,
  carries cattle truncation metadata across sync, and hides incomplete totals instead of silently
  presenting section-only counts.
