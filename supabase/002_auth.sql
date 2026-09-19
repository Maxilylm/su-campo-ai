-- CampoAI Auth Migration
-- Run this in Supabase SQL Editor AFTER schema.sql

-- Add user_id to farms (links Supabase Auth users to their farms)
ALTER TABLE farms ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_farms_user ON farms(user_id);

-- Drop old open-access policies
DROP POLICY IF EXISTS "Anon read farms" ON farms;
DROP POLICY IF EXISTS "Anon read sections" ON sections;
DROP POLICY IF EXISTS "Anon read cattle" ON cattle;
DROP POLICY IF EXISTS "Anon read activities" ON activities;
DROP POLICY IF EXISTS "Service role full access" ON farms;
DROP POLICY IF EXISTS "Service role full access" ON sections;
DROP POLICY IF EXISTS "Service role full access" ON cattle;
DROP POLICY IF EXISTS "Service role full access" ON activities;

-- Service role: full access (for WhatsApp webhook + server operations)
DROP POLICY IF EXISTS "Service role full access" ON farms;
CREATE POLICY "Service role full access" ON farms FOR ALL
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON sections;
CREATE POLICY "Service role full access" ON sections FOR ALL
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON cattle;
CREATE POLICY "Service role full access" ON cattle FOR ALL
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON activities;
CREATE POLICY "Service role full access" ON activities FOR ALL
  USING (true) WITH CHECK (true);

-- Authenticated users: can read/write their own farms
DROP POLICY IF EXISTS "Users read own farms" ON farms;
CREATE POLICY "Users read own farms" ON farms FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own farms" ON farms;
CREATE POLICY "Users update own farms" ON farms FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own farms" ON farms;
CREATE POLICY "Users insert own farms" ON farms FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users: access sections/cattle/activities for their farms
DROP POLICY IF EXISTS "Users read own sections" ON sections;
CREATE POLICY "Users read own sections" ON sections FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own sections" ON sections;
CREATE POLICY "Users manage own sections" ON sections FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users read own cattle" ON cattle;
CREATE POLICY "Users read own cattle" ON cattle FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own cattle" ON cattle;
CREATE POLICY "Users manage own cattle" ON cattle FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users read own activities" ON activities;
CREATE POLICY "Users read own activities" ON activities FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own activities" ON activities;
CREATE POLICY "Users manage own activities" ON activities FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));
