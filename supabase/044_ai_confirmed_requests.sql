-- Completes GOAL-audit-2026-09.md's confirmation-token binding item: a
-- confirmed AI write proposal's requestId must never be re-executed, but
-- the existing single-use guard (chat_requests, keyed by farm_id+request_id
-- via claim/complete) is deleted along with chat_messages whenever the user
-- clicks "Limpiar historial" in the chat UI. Within the confirmation
-- token's 10-minute TTL, that silently re-enables replay: verifyAIConfirmation
-- only checks the token's signature/expiry/farm/subject, not whether it was
-- already applied. This table is a separate, minimal consumption record
-- that "Limpiar historial" never touches (it only deletes chat_messages and
-- chat_requests), so a confirmed proposal stays single-use for its whole
-- signed lifetime regardless of history clearing.
CREATE TABLE IF NOT EXISTS public.ai_confirmed_requests (
  request_id TEXT PRIMARY KEY,
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_confirmed_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.ai_confirmed_requests;
CREATE POLICY "Service role full access" ON public.ai_confirmed_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Extend 040's daily purge job to also clean this table. A 1-day window is
-- generous given the signed token itself expires after 10 minutes -- rows
-- here are never useful past that, this just avoids unbounded growth.
CREATE OR REPLACE FUNCTION public.purge_operational_retention_rows()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM whatsapp_events WHERE updated_at < now() - interval '30 days';
  DELETE FROM chat_requests WHERE updated_at < now() - interval '30 days';
  DELETE FROM ai_confirmed_requests WHERE confirmed_at < now() - interval '1 day';
END;
$function$;
