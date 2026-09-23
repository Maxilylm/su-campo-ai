-- LOOP iteration 1: grazing history per potrero.
--
-- section_occupancy (045) only holds the current clock, so the app cannot
-- say whether a potrero actually rested long enough last time, or how many
-- animal-days it carried this season. grazing_periods keeps one row per
-- occupation: opened when a potrero is stocked, closed when it is emptied.
--
-- It is driven by a trigger on section_occupancy rather than on cattle, so
-- every way the clock moves -- the 045 cattle trigger and the manual
-- "¿desde cuándo?" date -- lands here, and 045's proven function is not
-- touched. Same SECURITY DEFINER / fixed search_path / revoked EXECUTE
-- pattern as 045, and the same farm-exists guard for the delete cascade.
CREATE TABLE IF NOT EXISTS public.grazing_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  -- Heads present when the period opened: with the length, an animal-days
  -- estimate. Not updated for later arrivals (see summarizeGrazingHistory).
  heads_at_start INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- At most one open period per potrero.
CREATE UNIQUE INDEX IF NOT EXISTS idx_grazing_periods_open ON public.grazing_periods(section_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_grazing_periods_farm_section ON public.grazing_periods(farm_id, section_id, started_at DESC);

ALTER TABLE public.grazing_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.grazing_periods;
CREATE POLICY "Service role full access" ON public.grazing_periods
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.track_grazing_periods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_since TIMESTAMPTZ := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.occupied_since END;
  v_heads INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = NEW.farm_id) THEN
    RETURN NEW;
  END IF;

  IF v_old_since IS NULL AND NEW.occupied_since IS NOT NULL THEN
    -- Stocked: open a period. A stray open one (should not exist) is closed first.
    UPDATE public.grazing_periods SET ended_at = GREATEST(started_at, NEW.occupied_since)
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
    SELECT COALESCE(SUM(count), 0) INTO v_heads FROM public.cattle WHERE section_id = NEW.section_id AND count > 0;
    INSERT INTO public.grazing_periods (farm_id, section_id, started_at, heads_at_start)
      VALUES (NEW.farm_id, NEW.section_id, NEW.occupied_since, v_heads);
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS NULL THEN
    -- Emptied: close the open period.
    UPDATE public.grazing_periods
      SET ended_at = GREATEST(started_at, COALESCE(NEW.last_vacated_at, now()))
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS DISTINCT FROM v_old_since THEN
    -- Start corrected by hand while stocked.
    UPDATE public.grazing_periods SET started_at = NEW.occupied_since
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.track_grazing_periods() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS track_grazing_periods ON public.section_occupancy;
CREATE TRIGGER track_grazing_periods
  AFTER INSERT OR UPDATE OF occupied_since ON public.section_occupancy
  FOR EACH ROW EXECUTE FUNCTION public.track_grazing_periods();
