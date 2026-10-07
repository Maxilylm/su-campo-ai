-- 055: Aguadas as records, not map decoration.
--
-- Until now an aguada was a map_features row (type 'aguada') with a name and
-- a point: nothing said what kind it was, whether it had water, or which
-- potreros drink from it. water_points holds that:
--
-- * kind: tajamar, bebedero, pozo, molino, arroyo, cañada, tanque.
-- * status: ok / bajo / seco / roto. The app derives each potrero's water
--   from the aguadas that serve it (the best one wins; it can only make the
--   potrero's own water_status worse, never better), so a dry tajamar shows
--   up in the alerts, the Plan del día, the rotation and the assistant.
-- * section_ids: the potreros it supplies. An array (not a join table): the
--   API checks every id belongs to the farm, and readers ignore ids of
--   potreros deleted since. Kept small (≤ 50).
-- * location: a GeoJSON Point {type, coordinates:[lng, lat]}, nullable (an
--   aguada can be registered before it is placed).
-- * map_feature_id: the legacy map_features row it was backfilled from, so
--   the map draws one marker, not two. ON DELETE SET NULL; deleting the
--   aguada from the app also deletes that row.
-- * last_checked_at: "Marcar revisada".
--
-- Backfill: every map_features row of type 'aguada' becomes a water_points
-- row (kind 'tajamar', status 'ok', unchecked). The map_features rows are
-- kept, not deleted. Safe to re-run: rows already linked are skipped.
--
-- Access: member policies like the other farm tables (031/042 split);
-- updated_at trigger (043/046); audit trigger (012/035) so the activity feed
-- shows "Aguada registrada". No trigger here locks another table.

CREATE TABLE IF NOT EXISTS public.water_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  map_feature_id UUID NULL REFERENCES public.map_features(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  kind TEXT NOT NULL DEFAULT 'tajamar'
    CHECK (kind IN ('tajamar', 'bebedero', 'pozo', 'molino', 'arroyo', 'canada', 'tanque')),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'bajo', 'seco', 'roto')),
  capacity_liters NUMERIC NULL CHECK (capacity_liters IS NULL OR capacity_liters >= 0),
  location JSONB NULL CHECK (
    location IS NULL
    OR (location->>'type' = 'Point' AND jsonb_typeof(location->'coordinates') = 'array')
  ),
  section_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(section_ids) <= 50),
  last_checked_at TIMESTAMPTZ NULL,
  notes TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  idempotency_key TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_water_points_farm ON public.water_points (farm_id, created_at);
CREATE INDEX IF NOT EXISTS idx_water_points_map_feature ON public.water_points (map_feature_id) WHERE map_feature_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_water_points_idempotency
  ON public.water_points (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- One aguada per legacy map feature (makes the backfill re-runnable).
CREATE UNIQUE INDEX IF NOT EXISTS idx_water_points_map_feature_unique
  ON public.water_points (map_feature_id) WHERE map_feature_id IS NOT NULL;

ALTER TABLE public.water_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.water_points;
CREATE POLICY "Service role full access" ON public.water_points
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Members read shared water_points" ON public.water_points;
CREATE POLICY "Members read shared water_points" ON public.water_points
  FOR SELECT TO public USING (public.has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text, 'viewer'::text]));
DROP POLICY IF EXISTS "Editors insert shared water_points" ON public.water_points;
CREATE POLICY "Editors insert shared water_points" ON public.water_points
  FOR INSERT TO public WITH CHECK (public.has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared water_points" ON public.water_points;
CREATE POLICY "Editors update shared water_points" ON public.water_points
  FOR UPDATE TO public
  USING (public.has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]))
  WITH CHECK (public.has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared water_points" ON public.water_points;
CREATE POLICY "Editors delete shared water_points" ON public.water_points
  FOR DELETE TO public USING (public.has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

REVOKE ALL ON TABLE public.water_points FROM anon;

DROP TRIGGER IF EXISTS set_updated_at_water_points ON public.water_points;
CREATE TRIGGER set_updated_at_water_points
  BEFORE UPDATE ON public.water_points
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill from the decorative aguadas (before the audit trigger exists, so
-- the migration doesn't flood the activity feed). Only well-formed points keep their
-- location; anything else is registered without one (placeable later).
INSERT INTO public.water_points (farm_id, map_feature_id, name, kind, status, location, created_at)
SELECT
  f.farm_id,
  f.id,
  COALESCE(NULLIF(left(btrim(f.name), 120), ''), 'Aguada'),
  'tajamar',
  'ok',
  CASE
    WHEN f.geometry->>'type' = 'Point'
     AND jsonb_typeof(f.geometry->'coordinates') = 'array'
     AND jsonb_typeof(f.geometry->'coordinates'->0) = 'number'
     AND jsonb_typeof(f.geometry->'coordinates'->1) = 'number'
    THEN jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(f.geometry->'coordinates'->0, f.geometry->'coordinates'->1))
    ELSE NULL
  END,
  COALESCE(f.created_at, now())
FROM public.map_features f
WHERE f.type = 'aguada'
  AND NOT EXISTS (SELECT 1 FROM public.water_points w WHERE w.map_feature_id = f.id);

DROP TRIGGER IF EXISTS audit_water_points ON public.water_points;
CREATE TRIGGER audit_water_points
  AFTER INSERT OR UPDATE OR DELETE ON public.water_points
  FOR EACH ROW EXECUTE FUNCTION public.log_field_mutation();
