-- CampoAI chat retry safety.
-- Keep a request claim and its final response separate from chat history so a
-- lost HTTP response cannot cause the AI's database operations to run twice.

CREATE TABLE IF NOT EXISTS chat_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'side_effects_done', 'completed', 'failed')),
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (farm_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_requests_updated
  ON chat_requests(farm_id, updated_at DESC);

ALTER TABLE chat_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON chat_requests FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users manage own chat requests" ON chat_requests FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));
