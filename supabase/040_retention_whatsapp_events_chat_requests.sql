-- 30-day retention for whatsapp_events and chat_requests, per the audit's
-- storage-budget concern (500 MB free tier). Both tables are pure
-- operational/idempotency bookkeeping (webhook dedupe and retry-safety
-- records) with no long-term value once a request has resolved and its
-- retry window (10 minutes, per AI_CONFIRMATION_TTL_MS) has long passed.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.purge_operational_retention_rows()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM whatsapp_events WHERE updated_at < now() - interval '30 days';
  DELETE FROM chat_requests WHERE updated_at < now() - interval '30 days';
END;
$function$;

SELECT cron.schedule(
  'purge-operational-retention-rows',
  '0 3 * * *',
  $$SELECT public.purge_operational_retention_rows();$$
);
