-- Proof for 052_chat_conversations.sql. Safe to run against production:
-- it creates two throwaway farms inside one DO block and ends with
-- RAISE EXCEPTION 'ROLLBACK_OK', so every row it writes is rolled back.
-- Expected outcome: the statement fails with exactly "ROLLBACK_OK".
-- Any other error is a failed assertion (its message says which).
DO $$
DECLARE
  v_farm UUID;
  v_other_farm UUID;
  v_legacy UUID;
  v_other_legacy UUID;
  v_new UUID;
  v_whatsapp UUID;
  v_count INTEGER;
  v_moved INTEGER;
  v_title TEXT;
  v_first TIMESTAMPTZ := now() - interval '3 days';
  v_last TIMESTAMPTZ := now() - interval '1 day';
  v_updated TIMESTAMPTZ;
BEGIN
  -- ── 0. Grants and RLS: server-only table, backfill callable by service_role only. ──
  IF has_table_privilege('anon', 'public.chat_conversations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.chat_conversations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.chat_conversations', 'INSERT') THEN
    RAISE EXCEPTION 'grants: chat_conversations must not be readable/writable by anon or authenticated';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chat_conversations'::regclass) THEN
    RAISE EXCEPTION 'rls: chat_conversations must have RLS enabled';
  END IF;
  IF has_function_privilege('anon', 'public.backfill_chat_conversations(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.backfill_chat_conversations(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants: backfill_chat_conversations must be service_role only';
  END IF;

  INSERT INTO farms (name, owner_phone) VALUES ('ROLLBACK TEST 052', 'rollback-test-052-' || gen_random_uuid()) RETURNING id INTO v_farm;
  INSERT INTO farms (name, owner_phone) VALUES ('ROLLBACK TEST 052 other', 'rollback-test-052-' || gen_random_uuid()) RETURNING id INTO v_other_farm;

  -- Legacy-shaped rows (no conversation), as an older deployment writes them.
  INSERT INTO chat_messages (farm_id, role, content, author_role, created_at) VALUES
    (v_farm, 'user', '¿Cuántos novillos hay?', 'owner', v_first),
    (v_farm, 'assistant', 'Hay 40 novillos.', 'owner', v_first + interval '1 second'),
    (v_farm, 'user', 'Gracias', 'owner', v_last),
    (v_farm, 'assistant', 'De nada.', 'owner', v_last + interval '1 second'),
    (v_other_farm, 'user', 'Hola', 'owner', v_first),
    (v_other_farm, 'assistant', 'Hola, ¿en qué te ayudo?', 'owner', v_first + interval '1 second');

  -- ── 1. Backfill is farm-scoped and puts every message in one conversation. ──
  v_moved := public.backfill_chat_conversations(v_farm);
  IF v_moved <> 4 THEN
    RAISE EXCEPTION 'backfill: expected 4 messages moved for the test farm, got %', v_moved;
  END IF;
  SELECT count(*) INTO v_count FROM chat_conversations WHERE farm_id = v_farm;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'backfill: expected 1 conversation for the test farm, got %', v_count;
  END IF;
  SELECT id, title, updated_at INTO v_legacy, v_title, v_updated FROM chat_conversations WHERE farm_id = v_farm;
  IF v_title <> 'Conversación anterior' THEN
    RAISE EXCEPTION 'backfill: expected title "Conversación anterior", got "%"', v_title;
  END IF;
  IF (SELECT created_at FROM chat_conversations WHERE id = v_legacy) <> v_first
     OR v_updated <> v_last + interval '1 second' THEN
    RAISE EXCEPTION 'backfill: conversation dates must span the first and last message';
  END IF;
  SELECT count(*) INTO v_count FROM chat_messages WHERE farm_id = v_farm AND conversation_id IS DISTINCT FROM v_legacy;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'backfill: % messages of the test farm left outside the conversation', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM chat_messages WHERE farm_id = v_other_farm AND conversation_id IS NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'scoping: backfilling one farm touched another farm''s messages';
  END IF;
  SELECT count(*) INTO v_count FROM chat_conversations WHERE farm_id = v_other_farm;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'scoping: backfilling one farm created a conversation for another farm';
  END IF;

  -- Running it again is a no-op.
  v_moved := public.backfill_chat_conversations(v_farm);
  SELECT count(*) INTO v_count FROM chat_conversations WHERE farm_id = v_farm;
  IF v_moved <> 0 OR v_count <> 1 THEN
    RAISE EXCEPTION 'backfill: second run must be a no-op (moved %, conversations %)', v_moved, v_count;
  END IF;

  v_moved := public.backfill_chat_conversations(v_other_farm);
  SELECT id INTO v_other_legacy FROM chat_conversations WHERE farm_id = v_other_farm;
  IF v_moved <> 2 OR v_other_legacy IS NULL THEN
    RAISE EXCEPTION 'backfill: other farm expected 2 messages moved, got %', v_moved;
  END IF;

  -- ── 2. Farm scoping at the FK: a message cannot point at another farm's conversation. ──
  BEGIN
    INSERT INTO chat_messages (farm_id, role, content, conversation_id)
      VALUES (v_farm, 'user', 'cruzado', v_other_legacy);
    RAISE EXCEPTION 'scoping: a message was attached to another farm''s conversation';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  -- ── 3. A new message moves its conversation to the top. ──
  INSERT INTO chat_conversations (farm_id, title, created_at, updated_at)
    VALUES (v_farm, 'Plan de pastoreo', now() - interval '2 hours', now() - interval '2 hours')
    RETURNING id INTO v_new;
  INSERT INTO chat_messages (farm_id, role, content, conversation_id, created_at)
    VALUES (v_farm, 'user', '¿Qué potrero descansa más?', v_new, now());
  SELECT updated_at INTO v_updated FROM chat_conversations WHERE id = v_new;
  IF v_updated < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'trigger: conversation updated_at was not moved to its newest message';
  END IF;
  IF (SELECT id FROM chat_conversations WHERE farm_id = v_farm ORDER BY updated_at DESC LIMIT 1) <> v_new THEN
    RAISE EXCEPTION 'order: the conversation with the newest message must list first';
  END IF;

  -- ── 4. One WhatsApp conversation per farm. ──
  INSERT INTO chat_conversations (farm_id, title, channel) VALUES (v_farm, 'WhatsApp', 'whatsapp') RETURNING id INTO v_whatsapp;
  BEGIN
    INSERT INTO chat_conversations (farm_id, title, channel) VALUES (v_farm, 'WhatsApp', 'whatsapp');
    RAISE EXCEPTION 'whatsapp: a second WhatsApp conversation was accepted for one farm';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  INSERT INTO chat_conversations (farm_id, title, channel) VALUES (v_other_farm, 'WhatsApp', 'whatsapp');

  -- Titles are bounded.
  BEGIN
    INSERT INTO chat_conversations (farm_id, title) VALUES (v_farm, '   ');
    RAISE EXCEPTION 'title: a blank title was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- ── 5. Deleting a conversation deletes its messages, and only its messages. ──
  DELETE FROM chat_conversations WHERE id = v_legacy AND farm_id = v_farm;
  SELECT count(*) INTO v_count FROM chat_messages WHERE conversation_id = v_legacy;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'cascade: % messages survived their conversation', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM chat_messages WHERE conversation_id = v_new;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'cascade: deleting one conversation touched another (% left, expected 1)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM chat_messages WHERE farm_id = v_other_farm;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'cascade: deleting a conversation touched another farm''s messages';
  END IF;

  -- ── 6. Deleting the farm still cascades through both paths. ──
  DELETE FROM farms WHERE id = v_farm;
  SELECT count(*) INTO v_count FROM chat_conversations WHERE farm_id = v_farm;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'farm delete: % conversations survived their farm', v_count;
  END IF;

  RAISE EXCEPTION 'ROLLBACK_OK';
END;
$$;
