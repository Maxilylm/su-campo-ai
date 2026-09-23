-- LOOP iteration 1b: found by the live check of 047.
--
-- 047 recorded the heads present when a period opened. A whole-herd move
-- arrives as one batch at a time (one move_cattle call each), so the first
-- batch opened the period and later arrivals -- into an already-occupied
-- potrero -- never touched it: moving 48 head into I-995 recorded 3.
-- peak_heads keeps the most heads seen during the open period; a trigger on
-- cattle raises it on every arrival. Animal-days use it instead.
ALTER TABLE public.grazing_periods ADD COLUMN IF NOT EXISTS peak_heads INTEGER NOT NULL DEFAULT 0;
UPDATE public.grazing_periods SET peak_heads = heads_at_start WHERE peak_heads < heads_at_start;

-- Refresh the open period of each section a cattle row change touches.
-- Periods are opened by 047's trigger on section_occupancy; this only raises
-- the peak, so trigger order on cattle does not matter.
CREATE OR REPLACE FUNCTION public.track_grazing_peak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_section UUID := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.section_id END;
BEGIN
  IF v_section IS NOT NULL THEN
    UPDATE public.grazing_periods p
      SET peak_heads = GREATEST(p.peak_heads, (SELECT COALESCE(SUM(c.count), 0) FROM public.cattle c WHERE c.section_id = v_section AND c.count > 0))
      WHERE p.section_id = v_section AND p.ended_at IS NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.track_grazing_peak() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS track_grazing_peak ON public.cattle;
CREATE TRIGGER track_grazing_peak
  AFTER INSERT OR UPDATE OF section_id, count ON public.cattle
  FOR EACH ROW EXECUTE FUNCTION public.track_grazing_peak();

-- New periods start with their peak equal to the heads present.
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
    UPDATE public.grazing_periods SET ended_at = GREATEST(started_at, NEW.occupied_since)
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
    SELECT COALESCE(SUM(count), 0) INTO v_heads FROM public.cattle WHERE section_id = NEW.section_id AND count > 0;
    INSERT INTO public.grazing_periods (farm_id, section_id, started_at, heads_at_start, peak_heads)
      VALUES (NEW.farm_id, NEW.section_id, NEW.occupied_since, v_heads, v_heads);
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS NULL THEN
    UPDATE public.grazing_periods
      SET ended_at = GREATEST(started_at, COALESCE(NEW.last_vacated_at, now()))
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS DISTINCT FROM v_old_since THEN
    UPDATE public.grazing_periods SET started_at = NEW.occupied_since
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
