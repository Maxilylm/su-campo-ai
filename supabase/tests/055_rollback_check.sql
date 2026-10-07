-- Proof for 055_aguadas.sql. Safe to run against production: it creates a
-- throwaway farm inside one DO block and ends with RAISE EXCEPTION
-- 'ROLLBACK_OK', so every row it writes is rolled back.
-- Expected outcome: the statement fails with exactly "ROLLBACK_OK".
-- Any other error is a failed assertion (its message says which).
DO $$
DECLARE
  v_farm UUID;
  v_feature UUID;
  v_point UUID;
  v_status TEXT;
  v_count INTEGER;
  v_rejected BOOLEAN;
  v_updated TIMESTAMPTZ;
  v_value TEXT;
BEGIN
  INSERT INTO farms (name, owner_phone) VALUES ('ROLLBACK TEST 055', 'rollback-test-055-' || gen_random_uuid()) RETURNING id INTO v_farm;

  -- ── 1. Defaults and the audit trigger. ──
  INSERT INTO water_points (farm_id, name) VALUES (v_farm, 'Tajamar prueba') RETURNING id, status INTO v_point, v_status;
  IF v_status <> 'ok' THEN RAISE EXCEPTION 'default status should be ok, got %', v_status; END IF;
  SELECT count(*) INTO v_count FROM activities WHERE farm_id = v_farm AND metadata->>'table' = 'water_points';
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected one audit row for the insert, found %', v_count; END IF;

  -- ── 2. updated_at moves on update. ──
  UPDATE water_points SET updated_at = now() - interval '1 day' WHERE id = v_point;
  UPDATE water_points SET status = 'seco' WHERE id = v_point RETURNING updated_at INTO v_updated;
  IF v_updated < now() - interval '1 minute' THEN RAISE EXCEPTION 'updated_at trigger did not fire'; END IF;

  -- ── 3. CHECKs reject bad values. ──
  FOREACH v_value IN ARRAY ARRAY['vacio', 'OK', ''] LOOP
    v_rejected := false;
    BEGIN
      UPDATE water_points SET status = v_value WHERE id = v_point;
    EXCEPTION WHEN check_violation THEN v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'status % should be rejected', v_value; END IF;
  END LOOP;
  v_rejected := false;
  BEGIN
    UPDATE water_points SET kind = 'laguna' WHERE id = v_point;
  EXCEPTION WHEN check_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'kind laguna should be rejected'; END IF;
  v_rejected := false;
  BEGIN
    UPDATE water_points SET location = '{"type":"LineString","coordinates":[]}'::jsonb WHERE id = v_point;
  EXCEPTION WHEN check_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'non-point location should be rejected'; END IF;
  v_rejected := false;
  BEGIN
    UPDATE water_points SET capacity_liters = -1 WHERE id = v_point;
  EXCEPTION WHEN check_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'negative capacity should be rejected'; END IF;

  -- ── 4. Backfill statement links a legacy aguada once. ──
  INSERT INTO map_features (farm_id, type, name, geometry)
    VALUES (v_farm, 'aguada', 'Vieja', '{"type":"Point","coordinates":[-56.1,-33.2]}'::jsonb)
    RETURNING id INTO v_feature;
  FOR v_count IN 1..2 LOOP
    INSERT INTO water_points (farm_id, map_feature_id, name, kind, status, location)
    SELECT f.farm_id, f.id, COALESCE(NULLIF(btrim(f.name), ''), 'Aguada'), 'tajamar', 'ok',
           jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(f.geometry->'coordinates'->0, f.geometry->'coordinates'->1))
      FROM map_features f
     WHERE f.id = v_feature
       AND NOT EXISTS (SELECT 1 FROM water_points w WHERE w.map_feature_id = f.id);
  END LOOP;
  SELECT count(*) INTO v_count FROM water_points WHERE map_feature_id = v_feature;
  IF v_count <> 1 THEN RAISE EXCEPTION 'backfill should link exactly once, found %', v_count; END IF;

  -- ── 5. Deleting the map feature keeps the aguada, unlinked. ──
  DELETE FROM map_features WHERE id = v_feature;
  SELECT count(*) INTO v_count FROM water_points WHERE farm_id = v_farm AND map_feature_id IS NULL AND name = 'Vieja';
  IF v_count <> 1 THEN RAISE EXCEPTION 'aguada should survive its map feature, found %', v_count; END IF;

  -- ── 6. Farm deletion cascades. ──
  DELETE FROM farms WHERE id = v_farm;
  SELECT count(*) INTO v_count FROM water_points WHERE farm_id = v_farm;
  IF v_count <> 0 THEN RAISE EXCEPTION 'water_points should cascade with the farm, found %', v_count; END IF;

  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;
