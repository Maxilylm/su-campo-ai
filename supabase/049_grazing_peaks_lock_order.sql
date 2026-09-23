-- LOOP iteration 1b, review finding on 048.
--
-- 048's trigger on cattle raised grazing_periods.peak_heads directly. That
-- locks an arrival potrero's open period BEFORE the departure potrero's
-- clock and period (045/047 lock section_occupancy -> grazing_periods).
-- Two opposite moves at once (A->X and X->A) then each hold one period and
-- wait for the other: a deadlock that aborts a user's move.
--
-- Running peaks move to their own table. Global lock order becomes
-- section_occupancy -> grazing_periods -> grazing_period_peaks:
--   * the arrival trigger touches only grazing_period_peaks, and fires last
--     on cattle (name sorts after track_section_occupancy);
--   * opening a period (047 trigger, already holding clock and period)
--     resets the peak row; closing copies the peak into the period.
-- Nothing ever waits for a clock or period row while holding a peak row.
CREATE TABLE IF NOT EXISTS public.grazing_period_peaks (
  section_id UUID PRIMARY KEY REFERENCES public.sections(id) ON DELETE CASCADE,
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  peak_heads INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grazing_period_peaks_farm ON public.grazing_period_peaks(farm_id);
ALTER TABLE public.grazing_period_peaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.grazing_period_peaks;
CREATE POLICY "Service role full access" ON public.grazing_period_peaks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed from open periods so the switch loses nothing.
INSERT INTO public.grazing_period_peaks (section_id, farm_id, peak_heads)
  SELECT section_id, farm_id, GREATEST(heads_at_start, peak_heads) FROM public.grazing_periods WHERE ended_at IS NULL
  ON CONFLICT (section_id) DO NOTHING;

DROP TRIGGER IF EXISTS track_grazing_peak ON public.cattle;
DROP FUNCTION IF EXISTS public.track_grazing_peak();

CREATE OR REPLACE FUNCTION public.track_zz_grazing_peak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_heads INTEGER;
BEGIN
  -- Only arrivals can raise a peak: a new batch, a batch moved in, a count up.
  IF NEW.section_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.section_id IS NOT DISTINCT FROM NEW.section_id AND COALESCE(NEW.count, 0) <= COALESCE(OLD.count, 0) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = NEW.farm_id) THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(count), 0) INTO v_heads FROM public.cattle WHERE section_id = NEW.section_id AND count > 0;
  INSERT INTO public.grazing_period_peaks (section_id, farm_id, peak_heads)
    VALUES (NEW.section_id, NEW.farm_id, v_heads)
    ON CONFLICT (section_id) DO UPDATE
      SET peak_heads = GREATEST(public.grazing_period_peaks.peak_heads, EXCLUDED.peak_heads), updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.track_zz_grazing_peak() FROM PUBLIC, anon, authenticated;

-- Named to fire after track_section_occupancy (triggers run in name order).
DROP TRIGGER IF EXISTS track_zz_grazing_peak ON public.cattle;
CREATE TRIGGER track_zz_grazing_peak
  AFTER INSERT OR UPDATE OF section_id, count ON public.cattle
  FOR EACH ROW EXECUTE FUNCTION public.track_zz_grazing_peak();

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
    -- A new period starts its peak from the heads present (lock order: peak last).
    INSERT INTO public.grazing_period_peaks (section_id, farm_id, peak_heads)
      VALUES (NEW.section_id, NEW.farm_id, v_heads)
      ON CONFLICT (section_id) DO UPDATE SET peak_heads = EXCLUDED.peak_heads, updated_at = now();
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS NULL THEN
    -- Closing: keep the running peak on the period (read without locking).
    UPDATE public.grazing_periods
      SET ended_at = GREATEST(started_at, COALESCE(NEW.last_vacated_at, now())),
          peak_heads = GREATEST(peak_heads, COALESCE((SELECT k.peak_heads FROM public.grazing_period_peaks k WHERE k.section_id = NEW.section_id), 0))
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS DISTINCT FROM v_old_since THEN
    UPDATE public.grazing_periods SET started_at = NEW.occupied_since
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
