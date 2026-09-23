-- GOAL-field-ops.md B: the grazing/rest clock per potrero.
--
-- move_cattle and every other cattle write rewrite cattle.section_id in
-- place, so nothing records when a potrero was stocked or emptied, and days
-- grazed / days rested (the basis of any rotation) are unknowable. A trigger
-- on cattle keeps that clock for every write path at once: the UI routes,
-- the AI executor, move_cattle, CSV import and sample data.
--
-- It lives in its own table rather than on sections because sections has a
-- BEFORE UPDATE updated_at trigger (043) that anchors the AI confirmation's
-- optimistic-concurrency check, and an audit trigger (012) that logs every
-- update. Stamping sections on each move would invalidate pending AI
-- proposals about that potrero and flood the activity feed.
--
-- The clock moves only on a real transition. A potrero that already held
-- animals when this shipped has no row (start unknown) until it is emptied;
-- any inferred date would be a guess shown as fact.
CREATE TABLE IF NOT EXISTS public.section_occupancy (
  section_id UUID PRIMARY KEY REFERENCES public.sections(id) ON DELETE CASCADE,
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  occupied_since TIMESTAMPTZ,
  last_vacated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_section_occupancy_farm ON public.section_occupancy(farm_id);

ALTER TABLE public.section_occupancy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.section_occupancy;
CREATE POLICY "Service role full access" ON public.section_occupancy
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- p_arrived / p_departed: heads that entered or left this section in the
-- triggering row change. The clock moves only on a real transition: the
-- section was empty before these arrivals, or is empty after these
-- departures. Touching a zero-count row in a resting potrero changes nothing.
--
-- SECURITY DEFINER with a fixed search_path, mirroring log_field_mutation
-- (012/035): the trigger must write this service-role-only table whichever
-- role wrote cattle. Execution is revoked from every API role below.
CREATE OR REPLACE FUNCTION public.refresh_section_occupancy(p_section_id UUID, p_arrived INTEGER, p_departed INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_farm_id UUID;
  v_heads BIGINT;
BEGIN
  IF p_section_id IS NULL THEN
    RETURN;
  END IF;
  -- Missing when the section itself is being deleted (cascade).
  SELECT farm_id INTO v_farm_id FROM public.sections WHERE id = p_section_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Same guard as 035: during DELETE FROM farms the cascade can reach cattle
  -- before sections, and inserting a row for a deleted farm would abort it.
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(count), 0) INTO v_heads
  FROM public.cattle
  WHERE section_id = p_section_id AND count > 0;

  IF v_heads > 0 AND p_arrived > 0 AND v_heads - p_arrived <= 0 THEN
    INSERT INTO public.section_occupancy (section_id, farm_id, occupied_since)
    VALUES (p_section_id, v_farm_id, now())
    ON CONFLICT (section_id) DO UPDATE
      SET occupied_since = now(), updated_at = now();
  ELSIF v_heads = 0 AND p_departed > 0 THEN
    INSERT INTO public.section_occupancy (section_id, farm_id, occupied_since, last_vacated_at)
    VALUES (p_section_id, v_farm_id, NULL, now())
    ON CONFLICT (section_id) DO UPDATE
      SET occupied_since = NULL, last_vacated_at = now(), updated_at = now();
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.track_section_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_count INTEGER := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE GREATEST(COALESCE(OLD.count, 0), 0) END;
  v_new_count INTEGER := CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE GREATEST(COALESCE(NEW.count, 0), 0) END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.refresh_section_occupancy(NEW.section_id, v_new_count, 0);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_section_occupancy(OLD.section_id, 0, v_old_count);
  ELSIF OLD.section_id IS DISTINCT FROM NEW.section_id THEN
    PERFORM public.refresh_section_occupancy(OLD.section_id, 0, v_old_count);
    PERFORM public.refresh_section_occupancy(NEW.section_id, v_new_count, 0);
  ELSIF v_old_count <> v_new_count THEN
    PERFORM public.refresh_section_occupancy(
      NEW.section_id,
      GREATEST(v_new_count - v_old_count, 0),
      GREATEST(v_old_count - v_new_count, 0)
    );
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_section_occupancy(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.track_section_occupancy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS track_section_occupancy ON public.cattle;
CREATE TRIGGER track_section_occupancy
  AFTER INSERT OR DELETE OR UPDATE OF section_id, count ON public.cattle
  FOR EACH ROW EXECUTE FUNCTION public.track_section_occupancy();
