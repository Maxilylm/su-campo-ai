-- Replaces the in-memory per-serverless-instance rate limiter (rate-limit.ts)
-- with a shared, atomic token bucket in Postgres. The in-memory Map reset on
-- every cold start and was never shared across instances, so the real limit
-- was N-instances times higher than configured.
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.rate_limit_buckets;
CREATE POLICY "Service role full access" ON public.rate_limit_buckets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consume_rate_limit_token(
  p_key TEXT,
  p_capacity DOUBLE PRECISION,
  p_refill_per_sec DOUBLE PRECISION
)
RETURNS TABLE(allowed BOOLEAN, retry_after_sec INTEGER)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_tokens DOUBLE PRECISION;
  v_updated TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_elapsed_sec DOUBLE PRECISION;
BEGIN
  INSERT INTO rate_limit_buckets (key, tokens, updated_at)
  VALUES (p_key, p_capacity, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT b.tokens, b.updated_at INTO v_tokens, v_updated
  FROM rate_limit_buckets b WHERE b.key = p_key FOR UPDATE;

  v_elapsed_sec := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_updated)));
  v_tokens := LEAST(p_capacity, v_tokens + v_elapsed_sec * p_refill_per_sec);

  IF v_tokens >= 1 THEN
    v_tokens := v_tokens - 1;
    UPDATE rate_limit_buckets SET tokens = v_tokens, updated_at = v_now WHERE key = p_key;
    RETURN QUERY SELECT true, 0;
  ELSE
    UPDATE rate_limit_buckets SET tokens = v_tokens, updated_at = v_now WHERE key = p_key;
    RETURN QUERY SELECT false, CEIL((1 - v_tokens) / p_refill_per_sec)::INTEGER;
  END IF;
END;
$function$;
