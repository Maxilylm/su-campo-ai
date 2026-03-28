-- CampoAI Database Schema
-- Run this in Supabase SQL Editor to set up all tables

-- Farms
CREATE TABLE IF NOT EXISTS farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_phone TEXT NOT NULL UNIQUE,
  total_hectares NUMERIC,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sections (potreros/paddocks)
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size_hectares NUMERIC,
  capacity INTEGER,
  description TEXT,
  color TEXT DEFAULT '#22c55e',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(farm_id, name)
);

-- Cattle groups (batch tracking, not individual animals)
CREATE TABLE IF NOT EXISTS cattle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'vaca',
  breed TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  tag_range TEXT,
  health_status TEXT DEFAULT 'healthy',
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Activity log (every change is recorded)
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  raw_message TEXT,
  message_type TEXT DEFAULT 'text',
  reported_by TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sections_farm ON sections(farm_id);
CREATE INDEX IF NOT EXISTS idx_cattle_farm ON cattle(farm_id);
CREATE INDEX IF NOT EXISTS idx_cattle_section ON cattle(section_id);
CREATE INDEX IF NOT EXISTS idx_activities_farm ON activities(farm_id);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_farms_phone ON farms(owner_phone);

-- Enable RLS (Row Level Security) - disabled for server-side access
ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cattle ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Service role policies (full access for server)
CREATE POLICY "Service role full access" ON farms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON cattle FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON activities FOR ALL USING (true) WITH CHECK (true);

-- Anon read access for dashboard
CREATE POLICY "Anon read farms" ON farms FOR SELECT USING (true);
CREATE POLICY "Anon read sections" ON sections FOR SELECT USING (true);
CREATE POLICY "Anon read cattle" ON cattle FOR SELECT USING (true);
CREATE POLICY "Anon read activities" ON activities FOR SELECT USING (true);

-- Seed a default farm (replace phone with your WhatsApp number)
-- INSERT INTO farms (name, owner_phone, total_hectares, location)
-- VALUES ('Mi Campo', '+5491112345678', 500, 'Buenos Aires');
