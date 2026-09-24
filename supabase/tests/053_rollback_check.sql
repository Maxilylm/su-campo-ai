-- Proof for 053_task_status_and_assignee.sql. Safe to run against production:
-- it creates a throwaway farm inside one DO block and ends with
-- RAISE EXCEPTION 'ROLLBACK_OK', so every row it writes is rolled back.
-- Expected outcome: the statement fails with exactly "ROLLBACK_OK".
-- Any other error is a failed assertion (its message says which).
--
-- Needs two existing auth users (any two; neither is changed). With fewer,
-- the assignee checks are skipped with a NOTICE and the status checks still run.
-- The API-level rule (PUT/POST /api/tasks with a non-member assignedTo →
-- 400 "La persona asignada no es miembro de este campo.") is verified live
-- by the coordinator; this file proves the database backstop.
DO $$
DECLARE
  v_farm UUID;
  v_task UUID;
  v_member UUID;
  v_outsider UUID;
  v_status TEXT;
  v_assignee UUID;
  v_rejected BOOLEAN;
  v_state TEXT;
  v_count INTEGER;
BEGIN
  INSERT INTO farms (name, owner_phone) VALUES ('ROLLBACK TEST 053', 'rollback-test-053-' || gen_random_uuid()) RETURNING id INTO v_farm;
  INSERT INTO tasks (farm_id, title) VALUES (v_farm, 'Prueba 053') RETURNING id, status INTO v_task, v_status;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'default status should stay pending, got %', v_status; END IF;

  -- ── 1. The three statuses are accepted. ──
  UPDATE tasks SET status = 'in_progress' WHERE id = v_task;
  UPDATE tasks SET status = 'completed', completed_at = now() WHERE id = v_task;
  UPDATE tasks SET status = 'pending', completed_at = NULL WHERE id = v_task;
  INSERT INTO tasks (farm_id, title, status) VALUES (v_farm, 'Prueba 053 en curso', 'in_progress');

  -- ── 2. Anything else is rejected. ──
  FOREACH v_status IN ARRAY ARRAY['done', 'blocked', 'IN_PROGRESS', ''] LOOP
    v_rejected := false;
    BEGIN
      UPDATE tasks SET status = v_status WHERE id = v_task;
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'status % should be rejected', v_status; END IF;
  END LOOP;

  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid = 'public.tasks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected exactly one status CHECK on tasks, found %', v_count; END IF;

  -- ── 3. Assignee: members only. ──
  SELECT id INTO v_member FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_outsider FROM auth.users WHERE id <> v_member ORDER BY created_at LIMIT 1;
  IF v_member IS NULL OR v_outsider IS NULL THEN
    RAISE NOTICE 'fewer than two auth users: assignee checks skipped';
  ELSE
    INSERT INTO farm_members (farm_id, user_id, role) VALUES (v_farm, v_member, 'editor');

    UPDATE tasks SET assigned_to = v_member WHERE id = v_task;

    v_rejected := false;
    BEGIN
      UPDATE tasks SET assigned_to = v_outsider WHERE id = v_task;
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_state = PG_EXCEPTION_HINT;
      v_rejected := v_state = 'task_assignee_not_member';
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'a non-member assignee should be rejected with hint task_assignee_not_member'; END IF;

    v_rejected := false;
    BEGIN
      INSERT INTO tasks (farm_id, title, assigned_to) VALUES (v_farm, 'Prueba 053 ajena', v_outsider);
    EXCEPTION WHEN foreign_key_violation THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'insert with a non-member assignee should be rejected'; END IF;

    -- Unchanged assignee does not re-check: other edits keep working.
    UPDATE tasks SET status = 'in_progress', title = 'Prueba 053 editada' WHERE id = v_task;

    -- Removing the member unassigns their tasks in this farm.
    DELETE FROM farm_members WHERE farm_id = v_farm AND user_id = v_member;
    SELECT assigned_to INTO v_assignee FROM tasks WHERE id = v_task;
    IF v_assignee IS NOT NULL THEN RAISE EXCEPTION 'removing a member should unassign their tasks'; END IF;
  END IF;

  -- ── 4. Farm deletion still cascades cleanly (035 path). ──
  DELETE FROM farms WHERE id = v_farm;
  SELECT count(*) INTO v_count FROM tasks WHERE farm_id = v_farm;
  IF v_count <> 0 THEN RAISE EXCEPTION 'farm delete should cascade its tasks'; END IF;

  -- ── 5. Trigger functions are not callable by API roles. ──
  IF has_function_privilege('anon', 'public.check_task_assignee()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.unassign_tasks_of_removed_member()', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants: trigger functions must not be executable by anon/authenticated';
  END IF;

  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;
