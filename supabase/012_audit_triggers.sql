-- CampoAI: database-level audit history for mutations.
-- Apply after 010_integrity.sql and 011_whatsapp_events.sql.

CREATE OR REPLACE FUNCTION public.log_field_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sections', 'cattle', 'crops', 'crop_applications',
    'inventory_items', 'inventory_movements', 'financial_transactions',
    'vaccinations', 'health_events', 'weight_records', 'padrones', 'map_features'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', table_name, table_name);
      EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_field_mutation()', table_name, table_name);
    END IF;
  END LOOP;
END;
$$;
