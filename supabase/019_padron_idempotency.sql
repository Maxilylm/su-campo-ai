-- CampoAI padron retry safety.
-- Apply after 018_padron_transaction.sql. A lost response must not create a
-- second padron and section when the same map action is submitted again.

ALTER TABLE padrones
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_padrones_idempotency
  ON padrones(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB);

CREATE FUNCTION public.create_padron_with_section(
  p_farm_id UUID,
  p_padron_code TEXT,
  p_padron_number INTEGER,
  p_department_code TEXT DEFAULT NULL,
  p_department_name TEXT DEFAULT NULL,
  p_area_m2 NUMERIC DEFAULT NULL,
  p_geometry JSONB DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_padron padrones%ROWTYPE;
  v_section sections%ROWTYPE;
BEGIN
  IF p_padron_code IS NULL OR p_padron_code = '' THEN
    RAISE EXCEPTION 'padron code is required';
  END IF;
  IF p_padron_number IS NULL OR p_padron_number < 0 THEN
    RAISE EXCEPTION 'padron number must be non-negative';
  END IF;
  IF p_area_m2 IS NOT NULL AND p_area_m2 <= 0 THEN
    RAISE EXCEPTION 'padron area must be positive';
  END IF;
  IF p_geometry IS NULL OR p_geometry->>'type' IS NULL OR NOT (p_geometry ? 'coordinates') THEN
    RAISE EXCEPTION 'padron geometry is invalid';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_padron
    FROM padrones
    WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT * INTO v_section
      FROM sections
      WHERE farm_id = p_farm_id AND padron_id = v_padron.id
      ORDER BY created_at
      LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object('padron', to_jsonb(v_padron), 'section', to_jsonb(v_section));
      END IF;
      RAISE EXCEPTION 'idempotent padron has no section';
    END IF;
  END IF;

  INSERT INTO padrones (
    farm_id, padron_code, padron_number, department_code,
    department_name, area_m2, geometry, idempotency_key
  ) VALUES (
    p_farm_id, p_padron_code, p_padron_number, p_department_code,
    p_department_name, p_area_m2, p_geometry, p_idempotency_key
  )
  ON CONFLICT (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_padron;

  IF v_padron.id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_padron
    FROM padrones
    WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent padron could not be resolved'; END IF;
    SELECT * INTO v_section
    FROM sections
    WHERE farm_id = p_farm_id AND padron_id = v_padron.id
    ORDER BY created_at
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent padron has no section'; END IF;
    RETURN jsonb_build_object('padron', to_jsonb(v_padron), 'section', to_jsonb(v_section));
  END IF;

  INSERT INTO sections (
    farm_id, padron_id, name, size_hectares, color,
    water_status, pasture_status
  ) VALUES (
    p_farm_id,
    v_padron.id,
    p_padron_code,
    CASE WHEN p_area_m2 IS NULL THEN NULL ELSE round((p_area_m2 / 10000.0)::numeric, 1) END,
    '#22c55e',
    'bueno',
    'bueno'
  )
  RETURNING * INTO v_section;

  RETURN jsonb_build_object(
    'padron', to_jsonb(v_padron),
    'section', to_jsonb(v_section)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB, TEXT) TO service_role;
