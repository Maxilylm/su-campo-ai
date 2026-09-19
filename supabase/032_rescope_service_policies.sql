-- 032: close the anon-key exposure left by the early setup scripts.
--
-- 002, 003, 004 and 005 created "Service role full access" policies as
-- `FOR ALL USING (true)` without `TO service_role`, which applies them to every
-- role, including `anon`. Because the anon key ships in the browser bundle, that
-- made every farm's rows readable and writable without signing in. The service
-- role bypasses RLS anyway, so scoping these policies loses the server nothing.
--
-- Standalone and re-runnable: it does not depend on 031 and can be applied before it.

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'Service role full access%'
      AND roles <> '{service_role}'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', t.policyname, t.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t.policyname, t.tablename
    );
  END LOOP;
END $$;

-- The browser never queries tables directly (all data goes through the API with
-- the service role), so signed-out clients need no table access at all.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Trigger-only functions must not be callable through /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.log_field_mutation() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.update_inventory_stock() SET search_path = public;

-- Fresh installs get both the 010 (5-arg) and 017 (6-arg) record_weight
-- overloads, which makes 5-argument calls ambiguous (PGRST203).
DROP FUNCTION IF EXISTS public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT);
