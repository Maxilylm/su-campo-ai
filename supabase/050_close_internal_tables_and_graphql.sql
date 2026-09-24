-- 050: Close service-role-only tables to API roles; drop unused pg_graphql.
--
-- These tables are written and read only by server routes through the
-- service-role client (see supabase/README.md "RLS"). Their only policy is
-- "Service role full access", so RLS already returns zero rows to anon and
-- authenticated — but the table grants still let every signed-in account
-- discover them (advisor 0027). Revoking the grants makes the intent explicit.
--
-- pg_graphql is unused (the app talks to PostgREST and Auth only) and exposes
-- the schema of every table to any signed-in account. Re-enable with
-- `CREATE EXTENSION pg_graphql;` if GraphQL is ever needed.

REVOKE ALL ON TABLE
  public.ai_confirmed_requests,
  public.cattle_move_idempotency,
  public.grazing_period_peaks,
  public.grazing_periods,
  public.rate_limit_buckets,
  public.section_occupancy,
  public.whatsapp_events
FROM anon, authenticated;

-- ai_confirmed_requests is deleted with its farm (FK cascade); without an
-- index every farm delete scans the table (advisor 0001).
CREATE INDEX IF NOT EXISTS idx_ai_confirmed_requests_farm_id
  ON public.ai_confirmed_requests (farm_id);

DROP EXTENSION IF EXISTS pg_graphql;
