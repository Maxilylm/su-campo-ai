-- Fixes a real bug: DELETE FROM farms on a farm with any audited child rows
-- (cattle, sections, ...) failed with a foreign key violation, because
-- log_field_mutation() unconditionally inserted an activities row on every
-- child DELETE -- including ones fired by the cascade from the farm's own
-- deletion, by which point farms.id no longer exists. This is exactly the
-- sample-data rollback path (api/sample-data/route.ts deletes the farm to
-- undo a partial create on error), so a failed sample-data generation with
-- any cattle/sections already created could not be cleaned up.
-- Repro'd and fix verified via BEGIN/ROLLBACK against live data before
-- applying.
CREATE OR REPLACE FUNCTION public.log_field_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_farm_id uuid;
  v_id uuid;
  v_action text := lower(TG_OP);
BEGIN
  IF TG_TABLE_NAME = 'activities' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  v_farm_id := COALESCE(NEW.farm_id, OLD.farm_id);
  v_id := COALESCE(NEW.id, OLD.id);
  IF v_farm_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM farms WHERE id = v_farm_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  INSERT INTO public.activities (farm_id, type, description, message_type, metadata)
  VALUES (
    v_farm_id,
    'registration',
    format('%s %s (%s)', initcap(v_action), replace(TG_TABLE_NAME, '_', ' '), v_id),
    'text',
    jsonb_build_object('table', TG_TABLE_NAME, 'action', v_action, 'record_id', v_id)
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
