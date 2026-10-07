-- Proof for 054_caravanas.sql. Safe to run against production: it creates two
-- throwaway farms inside one DO block and ends with RAISE EXCEPTION
-- 'ROLLBACK_OK', so every row it writes is rolled back.
-- Expected outcome: the statement fails with exactly "ROLLBACK_OK".
-- Any other error is a failed assertion (its message says which).
DO $$
DECLARE
  v_farm UUID;
  v_other UUID;
  v_section UUID;
  v_other_section UUID;
  v_lote UUID;
  v_other_lote UUID;
  v_result JSONB;
  v_summary JSONB;
  v_rejected BOOLEAN;
  v_count INTEGER;
  v_status TEXT;
  v_breed TEXT;
BEGIN
  INSERT INTO farms (name, owner_phone) VALUES ('ROLLBACK TEST 054', 'rollback-test-054-' || gen_random_uuid()) RETURNING id INTO v_farm;
  INSERT INTO farms (name, owner_phone) VALUES ('ROLLBACK TEST 054 B', 'rollback-test-054b-' || gen_random_uuid()) RETURNING id INTO v_other;
  INSERT INTO sections (farm_id, name) VALUES (v_farm, 'Norte 054') RETURNING id INTO v_section;
  INSERT INTO sections (farm_id, name) VALUES (v_other, 'Ajeno 054') RETURNING id INTO v_other_section;
  INSERT INTO cattle (farm_id, section_id, category, count) VALUES (v_farm, v_section, 'novillo', 40) RETURNING id INTO v_lote;
  INSERT INTO cattle (farm_id, category, count) VALUES (v_other, 'vaca', 5) RETURNING id INTO v_other_lote;

  -- ── 1. Import into a lote; a repeated batch key is a replay. ──
  v_result := import_animal_tags(v_farm,
    '[{"tag_number":"858000012345678","sex":"macho","breed":"Angus","category":"novillo","birth_date":"2024-03-01"},
      {"tag_number":"858000012345679","sex":"hembra"}]'::jsonb,
    'rollback-054-k1', 'snig_import', v_lote, NULL);
  IF (v_result->>'inserted')::int <> 2 THEN RAISE EXCEPTION 'expected 2 inserted, got %', v_result; END IF;
  v_result := import_animal_tags(v_farm, '[{"tag_number":"858000012345670"}]'::jsonb, 'rollback-054-k1');
  IF NOT (v_result->>'replayed')::boolean THEN RAISE EXCEPTION 'batch key reuse should replay, got %', v_result; END IF;
  SELECT count(*) INTO v_count FROM animal_tags WHERE farm_id = v_farm;
  IF v_count <> 2 THEN RAISE EXCEPTION 'replay wrote rows: % tags', v_count; END IF;

  -- ── 2. Re-import keeps app-entered values the file does not carry. ──
  UPDATE animal_tags SET status = 'vendido' WHERE farm_id = v_farm AND tag_number = '858000012345679';
  v_result := import_animal_tags(v_farm, '[{"tag_number":"858000012345679","breed":"Hereford"},{"tag_number":"858000012345678"}]'::jsonb, 'rollback-054-k2');
  IF (v_result->>'updated')::int <> 2 THEN RAISE EXCEPTION 'expected 2 updated, got %', v_result; END IF;
  SELECT status, breed INTO v_status, v_breed FROM animal_tags WHERE farm_id = v_farm AND tag_number = '858000012345679';
  IF v_status <> 'vendido' OR v_breed <> 'Hereford' THEN RAISE EXCEPTION 'merge wrong: % %', v_status, v_breed; END IF;
  SELECT breed INTO v_breed FROM animal_tags WHERE farm_id = v_farm AND tag_number = '858000012345678';
  IF v_breed <> 'Angus' THEN RAISE EXCEPTION 'empty import field wiped breed: %', v_breed; END IF;
  -- k2 overwrote import_batch_key on k1's rows: retrying k1 must still be a replay.
  v_result := import_animal_tags(v_farm, '[{"tag_number":"858000012345670"}]'::jsonb, 'rollback-054-k1');
  IF NOT (v_result->>'replayed')::boolean THEN RAISE EXCEPTION 'k1 retry after k2 was not a replay: %', v_result; END IF;
  SELECT count(*) INTO v_count FROM animal_tag_import_batches WHERE farm_id = v_farm;
  IF v_count <> 2 THEN RAISE EXCEPTION 'expected 2 recorded batches, got %', v_count; END IF;

  -- ── 3. Summary: active only, effective potrero through the lote. ──
  v_summary := animal_tag_summary(v_farm);
  IF (v_summary->>'total')::int <> 2 OR (v_summary->>'active')::int <> 1 THEN RAISE EXCEPTION 'summary totals wrong: %', v_summary; END IF;
  IF (v_summary->'by_cattle'->>v_lote::text)::int <> 1 THEN RAISE EXCEPTION 'summary by_cattle wrong: %', v_summary; END IF;
  IF (v_summary->'by_section'->>v_section::text)::int <> 1 THEN RAISE EXCEPTION 'summary by_section wrong: %', v_summary; END IF;

  -- ── 4. Another farm's lote or potrero is refused on every path. ──
  v_rejected := false;
  BEGIN
    UPDATE animal_tags SET cattle_id = v_other_lote WHERE farm_id = v_farm AND tag_number = '858000012345678';
  EXCEPTION WHEN foreign_key_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'cross-farm lote accepted'; END IF;
  v_rejected := false;
  BEGIN
    PERFORM import_animal_tags(v_farm, '[{"tag_number":"858000099999999"}]'::jsonb, 'rollback-054-k3', 'excel', NULL, v_other_section);
  EXCEPTION WHEN foreign_key_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'cross-farm potrero accepted'; END IF;

  -- ── 5. Format checks and per-farm uniqueness. ──
  v_rejected := false;
  BEGIN
    INSERT INTO animal_tags (farm_id, tag_number) VALUES (v_farm, 'UY 012345678');
  EXCEPTION WHEN check_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'unnormalized tag accepted'; END IF;
  v_rejected := false;
  BEGIN
    INSERT INTO animal_tags (farm_id, tag_number) VALUES (v_farm, '858000012345678');
  EXCEPTION WHEN unique_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'duplicate tag accepted'; END IF;
  INSERT INTO animal_tags (farm_id, tag_number) VALUES (v_other, '858000012345678');
  v_rejected := false;
  BEGIN
    UPDATE farms SET dicose_number = '12.345' WHERE id = v_farm;
  EXCEPTION WHEN check_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'dicose with separators accepted'; END IF;
  UPDATE farms SET dicose_number = '213456789' WHERE id = v_farm;

  -- ── 6. Deleting the lote unassigns its animals; the farm cascade removes them. ──
  DELETE FROM cattle WHERE id = v_lote;
  SELECT count(*) INTO v_count FROM animal_tags WHERE farm_id = v_farm AND cattle_id IS NOT NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'lote delete left % assigned tags', v_count; END IF;

  -- ── 7. API roles cannot call the farm-id functions. ──
  IF has_function_privilege('authenticated', 'public.animal_tag_summary(uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.import_animal_tags(uuid, jsonb, text, text, uuid, uuid)', 'execute')
     OR has_function_privilege('anon', 'public.import_animal_tags(uuid, jsonb, text, text, uuid, uuid)', 'execute') THEN
    RAISE EXCEPTION 'farm-id functions are callable by API roles';
  END IF;
  IF has_table_privilege('authenticated', 'public.animal_tag_import_batches', 'select')
     OR has_table_privilege('anon', 'public.animal_tag_import_batches', 'insert') THEN
    RAISE EXCEPTION 'animal_tag_import_batches is readable/writable by API roles';
  END IF;

  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;
