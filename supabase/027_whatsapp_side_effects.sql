-- CampoAI WhatsApp retry safety.
-- Once AI database operations have run, retain the outbound response so a
-- provider retry can resend it without running those operations twice.

ALTER TABLE whatsapp_events
  ADD COLUMN IF NOT EXISTS response_text TEXT;
