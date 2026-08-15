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
