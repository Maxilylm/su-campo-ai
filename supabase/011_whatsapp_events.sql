-- Idempotency and retry state for incoming WhatsApp messages.
CREATE TABLE IF NOT EXISTS whatsapp_events (
  message_id TEXT PRIMARY KEY,
  sender_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_created ON whatsapp_events(created_at);
ALTER TABLE whatsapp_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON whatsapp_events FOR ALL TO service_role USING (true) WITH CHECK (true);
