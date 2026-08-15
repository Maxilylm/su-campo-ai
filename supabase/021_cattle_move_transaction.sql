-- CampoAI atomic cattle moves.
-- Apply after 020_import_idempotency.sql. A partial move must reduce the
-- source batch and create its destination batch in the same transaction.

CREATE OR REPLACE FUNCTION public.move_cattle(
  p_farm_id UUID,
  p_source_cattle_id UUID,
  p_destination_section_id UUID,
  p_move_count INTEGER
)
RETURNS TABLE (
  source_id UUID,
  destination_id UUID,
  moved_count INTEGER,
  move_mode TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source cattle%ROWTYPE;
  v_destination_id UUID;
BEGIN
  IF p_move_count IS NULL OR p_move_count <= 0 THEN
    RAISE EXCEPTION 'move count must be positive';
  END IF;

  SELECT * INTO v_source
  FROM cattle
  WHERE id = p_source_cattle_id AND farm_id = p_farm_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source cattle batch not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sections
    WHERE id = p_destination_section_id AND farm_id = p_farm_id
  ) THEN
    RAISE EXCEPTION 'destination section does not belong to farm';
  END IF;

  IF v_source.section_id = p_destination_section_id THEN
    RETURN QUERY SELECT v_source.id, NULL::UUID, 0, 'noop'::TEXT;
    RETURN;
  END IF;

  IF p_move_count >= v_source.count THEN
    UPDATE cattle
    SET section_id = p_destination_section_id,
        updated_at = now()
    WHERE id = v_source.id AND farm_id = p_farm_id;

    RETURN QUERY SELECT v_source.id, NULL::UUID, v_source.count, 'all'::TEXT;
    RETURN;
  END IF;

  UPDATE cattle
  SET count = v_source.count - p_move_count,
      updated_at = now()
  WHERE id = v_source.id AND farm_id = p_farm_id;

  INSERT INTO cattle (
    farm_id, section_id, category, breed, count, tag_range,
    health_status, notes, weight_kg, birth_date, origin,
    vaccination_status, last_vaccinated, reproductive_status, ear_tag
  ) VALUES (
    p_farm_id, p_destination_section_id, v_source.category, v_source.breed,
    p_move_count, v_source.tag_range, v_source.health_status, NULL,
    v_source.weight_kg, v_source.birth_date, v_source.origin,
    v_source.vaccination_status, v_source.last_vaccinated,
    v_source.reproductive_status, NULL
  )
  RETURNING id INTO v_destination_id;

  RETURN QUERY SELECT v_source.id, v_destination_id, p_move_count, 'split'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.move_cattle(UUID, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_cattle(UUID, UUID, UUID, INTEGER) TO service_role;
