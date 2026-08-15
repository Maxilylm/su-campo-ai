-- CampoAI cattle identity integrity.
-- Resolve any existing duplicate caravanas before applying this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cattle
    WHERE ear_tag IS NOT NULL AND trim(ear_tag) <> ''
    GROUP BY farm_id, lower(trim(ear_tag))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate cattle ear tags exist; resolve them before applying 016_cattle_ear_tags.sql';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cattle_farm_ear_tag_unique
  ON cattle(farm_id, lower(trim(ear_tag)))
  WHERE ear_tag IS NOT NULL AND trim(ear_tag) <> '';
