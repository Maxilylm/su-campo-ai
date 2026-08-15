-- CampoAI sample-data retry safety.
-- A slow response or a double click must not seed the same farm twice.

CREATE TABLE IF NOT EXISTS sample_data_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_data_active_user
  ON sample_data_requests(user_id)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_sample_data_requests_updated
  ON sample_data_requests(user_id, updated_at DESC);

ALTER TABLE sample_data_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON sample_data_requests FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users manage own sample data requests" ON sample_data_requests FOR ALL
  USING (user_id = auth.uid());
