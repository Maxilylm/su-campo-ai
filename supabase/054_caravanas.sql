-- 054: Caravanas — a registry of individual animals by official ear tag (SNIG).
--
-- Uruguay's SNIG identifies each bovine by an official caravana: a 15-digit
-- electronic number (ISO 11784, country code 858) with a visual "UY" tag.
-- SNIG has no public animal API, so the registry is filled by hand or from the
-- SNIG/DICOSE exports the producer downloads, and is exported back in a
-- SNIG-friendly layout.
--
-- * animal_tags: one row per animal. tag_number is the normalized 15-digit
--   number (the app normalizes "UY 012345678", spaces and dashes before
--   writing), unique per farm. Assigning an animal to a lote (cattle row, a
--   batch with a head count) or to a potrero (section) is optional. When it
--   has a lote, its potrero is the lote's (section_id is kept null by the
--   app so a lote move never leaves it stale).
-- * A BEFORE trigger refuses a cattle_id/section_id of another farm, for every
--   write path (the API also validates first, with a clear 400).
-- * import_animal_tags(farm, rows, batch_key, cattle_id, section_id): bulk
--   upsert in one transaction. Imported values only fill or replace fields the
--   file actually carries (COALESCE), so re-importing a SNIG export never wipes
--   a breed or an assignment typed in the app. Each batch key is recorded in
--   animal_tag_import_batches when the import starts; a key already there (or
--   being inserted by a concurrent identical request, which waits for it) is a
--   replay: nothing is written again.
-- * animal_tag_summary(farm): counts for the page, the lote reconciliation
--   ("40 cabezas, 32 caravanas") and the assistant, without shipping rows.
-- * farms.dicose_number: the establishment's DICOSE number, digits only.
--
-- Lock order: the import upserts animal_tags rows in tag_number order (so two
-- overlapping imports queue instead of deadlocking) and then takes KEY SHARE
-- on the referenced cattle/section rows through the foreign keys. Deleting a
-- lote locks the cattle row and then sets its animal_tags rows' cattle_id to
-- null; a delete of that same lote racing an import that assigns to it can be
-- aborted by the deadlock detector (one side fails and is retried by the user).
-- The API's bulk PATCH/DELETE (UPDATE/DELETE ... WHERE id IN (...)) lock the
-- selected rows in scan order, not tag_number order, so one racing an import
-- over the same animals can also deadlock; the API answers 40P01 with a 409
-- "Reintentá" and nothing is half-written (each statement is atomic).
--
-- RLS like the other shared tables (031/042): members read, owners/editors
-- write; API routes use the service role. The two functions take a farm id,
-- so they are service-role only.

ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS dicose_number TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'farms_dicose_number_format'
      AND conrelid = 'public.farms'::regclass
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_dicose_number_format
      CHECK (dicose_number IS NULL OR dicose_number ~ '^[0-9]{4,15}$');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.animal_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  tag_number TEXT NOT NULL CHECK (tag_number ~ '^[0-9]{15}$'),
  visual_tag TEXT CHECK (visual_tag IS NULL OR char_length(visual_tag) <= 40),
  sex TEXT CHECK (sex IS NULL OR sex IN ('macho', 'hembra')),
  breed TEXT CHECK (breed IS NULL OR char_length(breed) <= 100),
  category TEXT CHECK (category IS NULL OR char_length(category) <= 40),
  birth_date DATE,
  cattle_id UUID REFERENCES public.cattle(id) ON DELETE SET NULL,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'vendido', 'muerto', 'faltante')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'snig_import', 'excel')),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000),
  idempotency_key TEXT,
  import_batch_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_animal_tags_farm_tag ON public.animal_tags (farm_id, tag_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_animal_tags_idempotency
  ON public.animal_tags (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_animal_tags_cattle ON public.animal_tags (cattle_id) WHERE cattle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_animal_tags_section ON public.animal_tags (section_id) WHERE section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_animal_tags_farm_status ON public.animal_tags (farm_id, status);

-- One row per import batch key (Idempotency-Key of /api/caravanas/import).
-- animal_tags.import_batch_key only records the last import that touched a
-- row, so it cannot tell whether a batch already ran. Server-only.
CREATE TABLE IF NOT EXISTS public.animal_tag_import_batches (
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  batch_key TEXT NOT NULL CHECK (char_length(batch_key) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, batch_key)
);

ALTER TABLE public.animal_tag_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.animal_tag_import_batches;
CREATE POLICY "Service role full access" ON public.animal_tag_import_batches
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.animal_tag_import_batches FROM anon, authenticated;

ALTER TABLE public.animal_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.animal_tags;
CREATE POLICY "Service role full access" ON public.animal_tags
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Members read shared animal_tags" ON public.animal_tags;
CREATE POLICY "Members read shared animal_tags" ON public.animal_tags FOR SELECT TO public
  USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text, 'viewer'::text]));
DROP POLICY IF EXISTS "Editors insert shared animal_tags" ON public.animal_tags;
CREATE POLICY "Editors insert shared animal_tags" ON public.animal_tags FOR INSERT TO public
  WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared animal_tags" ON public.animal_tags;
CREATE POLICY "Editors update shared animal_tags" ON public.animal_tags FOR UPDATE TO public
  USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]))
  WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared animal_tags" ON public.animal_tags;
CREATE POLICY "Editors delete shared animal_tags" ON public.animal_tags FOR DELETE TO public
  USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
REVOKE ALL ON TABLE public.animal_tags FROM anon;

DROP TRIGGER IF EXISTS set_updated_at_animal_tags ON public.animal_tags;
CREATE TRIGGER set_updated_at_animal_tags BEFORE UPDATE ON public.animal_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.check_animal_tag_farm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cattle_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.cattle_id IS DISTINCT FROM OLD.cattle_id OR NEW.farm_id IS DISTINCT FROM OLD.farm_id)
     AND NOT EXISTS (SELECT 1 FROM cattle WHERE id = NEW.cattle_id AND farm_id = NEW.farm_id) THEN
    RAISE EXCEPTION 'cattle_id belongs to another farm' USING ERRCODE = '23503', HINT = 'animal_tag_cattle_other_farm';
  END IF;
  IF NEW.section_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.section_id IS DISTINCT FROM OLD.section_id OR NEW.farm_id IS DISTINCT FROM OLD.farm_id)
     AND NOT EXISTS (SELECT 1 FROM sections WHERE id = NEW.section_id AND farm_id = NEW.farm_id) THEN
    RAISE EXCEPTION 'section_id belongs to another farm' USING ERRCODE = '23503', HINT = 'animal_tag_section_other_farm';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_animal_tag_farm() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_animal_tag_farm ON public.animal_tags;
CREATE TRIGGER check_animal_tag_farm
  BEFORE INSERT OR UPDATE OF cattle_id, section_id, farm_id ON public.animal_tags
  FOR EACH ROW EXECUTE FUNCTION public.check_animal_tag_farm();

-- p_rows: [{tag_number, visual_tag, sex, breed, category, birth_date, status, notes}]
-- already validated by the API; the table CHECKs are the last line.
-- Returns {"inserted": n, "updated": n, "replayed": bool}.
CREATE OR REPLACE FUNCTION public.import_animal_tags(
  p_farm_id UUID,
  p_rows JSONB,
  p_batch_key TEXT,
  p_source TEXT DEFAULT 'snig_import',
  p_cattle_id UUID DEFAULT NULL,
  p_section_id UUID DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
  v_total integer := 0;
BEGIN
  -- Claim the batch key first. A concurrent request with the same key blocks
  -- on this primary key until the first commits (then conflicts: replay) or
  -- rolls back (then it proceeds and does the work itself).
  IF p_batch_key IS NOT NULL THEN
    INSERT INTO animal_tag_import_batches (farm_id, batch_key)
      VALUES (p_farm_id, p_batch_key)
      ON CONFLICT (farm_id, batch_key) DO NOTHING;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('inserted', 0, 'updated', 0, 'replayed', true);
    END IF;
  END IF;

  WITH input AS (
    SELECT DISTINCT ON (r.tag_number)
      r.tag_number, NULLIF(btrim(r.visual_tag), '') AS visual_tag, r.sex,
      NULLIF(btrim(r.breed), '') AS breed, r.category, r.birth_date,
      r.status, NULLIF(btrim(r.notes), '') AS notes
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
      tag_number TEXT, visual_tag TEXT, sex TEXT, breed TEXT, category TEXT,
      birth_date DATE, status TEXT, notes TEXT
    )
    WHERE r.tag_number IS NOT NULL
    ORDER BY r.tag_number
  ),
  upserted AS (
    INSERT INTO animal_tags AS t (
      farm_id, tag_number, visual_tag, sex, breed, category, birth_date,
      cattle_id, section_id, status, source, notes, import_batch_key
    )
    SELECT p_farm_id, i.tag_number, i.visual_tag, i.sex, i.breed, i.category, i.birth_date,
      p_cattle_id, CASE WHEN p_cattle_id IS NULL THEN p_section_id ELSE NULL END,
      COALESCE(i.status, 'activo'), p_source, i.notes, p_batch_key
    FROM input i
    ORDER BY i.tag_number
    ON CONFLICT (farm_id, tag_number) DO UPDATE SET
      visual_tag = COALESCE(EXCLUDED.visual_tag, t.visual_tag),
      sex = COALESCE(EXCLUDED.sex, t.sex),
      breed = COALESCE(EXCLUDED.breed, t.breed),
      category = COALESCE(EXCLUDED.category, t.category),
      birth_date = COALESCE(EXCLUDED.birth_date, t.birth_date),
      cattle_id = CASE WHEN p_cattle_id IS NOT NULL THEN p_cattle_id
                       WHEN p_section_id IS NOT NULL THEN NULL
                       ELSE t.cattle_id END,
      section_id = CASE WHEN p_cattle_id IS NOT NULL THEN NULL
                        WHEN p_section_id IS NOT NULL THEN p_section_id
                        ELSE t.section_id END,
      -- An explicit status column in the file wins; otherwise keep the app's.
      status = CASE WHEN (SELECT i2.status FROM input i2 WHERE i2.tag_number = EXCLUDED.tag_number) IS NOT NULL
                    THEN EXCLUDED.status ELSE t.status END,
      notes = COALESCE(EXCLUDED.notes, t.notes),
      import_batch_key = EXCLUDED.import_batch_key
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) INTO v_inserted, v_total FROM upserted;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_total - v_inserted, 'replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_animal_tags(UUID, JSONB, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_animal_tags(UUID, JSONB, TEXT, TEXT, UUID, UUID) TO service_role;

-- Counts of a farm's registry. by_cattle/by_section/by_category/by_sex count
-- active animals only; by_section uses the effective potrero (the lote's when
-- the animal has one).
CREATE OR REPLACE FUNCTION public.animal_tag_summary(p_farm_id UUID)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH tags AS (
    SELECT t.status, t.sex, t.category, t.cattle_id,
           CASE WHEN t.cattle_id IS NOT NULL THEN c.section_id ELSE t.section_id END AS section_id
    FROM animal_tags t
    LEFT JOIN cattle c ON c.id = t.cattle_id
    WHERE t.farm_id = p_farm_id
  ),
  active AS (SELECT * FROM tags WHERE status = 'activo')
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM tags),
    'active', (SELECT count(*) FROM active),
    'unassigned', (SELECT count(*) FROM active WHERE cattle_id IS NULL AND section_id IS NULL),
    'without_lote', (SELECT count(*) FROM active WHERE cattle_id IS NULL),
    'by_status', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) AS n FROM tags GROUP BY status) s), '{}'::jsonb),
    'by_category', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT COALESCE(category, 'sin_categoria') AS k, count(*) AS n FROM active GROUP BY 1) s), '{}'::jsonb),
    'by_sex', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT COALESCE(sex, 'sin_dato') AS k, count(*) AS n FROM active GROUP BY 1) s), '{}'::jsonb),
    'by_cattle', COALESCE((SELECT jsonb_object_agg(cattle_id::text, n) FROM (SELECT cattle_id, count(*) AS n FROM active WHERE cattle_id IS NOT NULL GROUP BY 1) s), '{}'::jsonb),
    'by_section', COALESCE((SELECT jsonb_object_agg(section_id::text, n) FROM (SELECT section_id, count(*) AS n FROM active WHERE section_id IS NOT NULL GROUP BY 1) s), '{}'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.animal_tag_summary(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.animal_tag_summary(UUID) TO service_role;
