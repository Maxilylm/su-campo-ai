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
- Bound Supabase at the shared client boundary as well as farm lookup and client mutations: a slow
  database request should become a recoverable connection state, not a platform gateway timeout.
- Keep operational surfaces explicit: public health probes can support scheduled keep-alive jobs,
  but authenticated app pages and data APIs stay behind the proxy; public metadata files need an
  explicit allowlist entry. Contrast tokens should be verified as part of the same production pass
  because the login screen is the first surface every user sees.
