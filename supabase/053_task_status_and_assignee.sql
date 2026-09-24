-- Loop 31: tasks become tickets — an "En curso" status and an assignee.
--
-- 1. status gains 'in_progress'. It is still open work: alerts, agenda, the
--    daily plan, the calendar and the AI deadlines all read
--    status IN ('pending', 'in_progress'). The original CHECK was declared
--    inline in 014 (auto-named tasks_status_check); it is dropped by lookup
--    rather than by name so a hand-renamed constraint cannot survive.
-- 2. assigned_to: the auth user id of a farm member. The API validates
--    membership first (clear 400); the BEFORE trigger enforces the same rule
--    for every other write path (AI RPC 051, SQL editor, a future route).
--    It only checks when assigned_to changes, so a task assigned to someone
--    who later left the farm can still be completed or edited.
-- 3. Removing a member unassigns their tasks in that farm (AFTER DELETE on
--    farm_members). Deleting the auth user does the same through the FK.
--
-- Lock order: the tasks trigger reads farm_members without locking it; the
-- farm_members trigger locks the member row (the DELETE) and then the task
-- rows. Nothing locks tasks → farm_members, so no A→X / X→A cycle. The cost
-- is a benign race: an assignment committed while the same member is being
-- removed can survive; the UI shows it as "Ex miembro" and lets you reassign.

DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.tasks'::regclass
       AND contype = 'c'
       -- Only the status value list itself; another CHECK that merely mentions
       -- status (e.g. a completed_at rule) must survive.
       AND pg_get_constraintdef(oid) ~ '^CHECK \(\(status = ANY \(ARRAY\['
  LOOP
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check CHECK (status IN ('pending', 'in_progress', 'completed'));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_to UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

-- FK side of auth user deletion, the member-removal cleanup and "Asignadas a mí".
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks (assigned_to) WHERE assigned_to IS NOT NULL;

-- The task detail's "Historial" reads the audit rows (012/035) of one record.
CREATE INDEX IF NOT EXISTS idx_activities_farm_record ON public.activities (farm_id, (metadata->>'record_id'));

CREATE OR REPLACE FUNCTION public.check_task_assignee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to AND NEW.farm_id = OLD.farm_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM farm_members WHERE farm_id = NEW.farm_id AND user_id = NEW.assigned_to)
     AND NOT EXISTS (SELECT 1 FROM farms WHERE id = NEW.farm_id AND user_id = NEW.assigned_to) THEN
    RAISE EXCEPTION 'assigned_to is not a member of this farm' USING ERRCODE = '23503', HINT = 'task_assignee_not_member';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_task_assignee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_task_assignee ON public.tasks;
CREATE TRIGGER check_task_assignee
  BEFORE INSERT OR UPDATE OF assigned_to, farm_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.check_task_assignee();

CREATE OR REPLACE FUNCTION public.unassign_tasks_of_removed_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A farm deletion cascades here after the farm row is gone; its tasks go too.
  IF NOT EXISTS (SELECT 1 FROM farms WHERE id = OLD.farm_id) THEN
    RETURN OLD;
  END IF;
  -- The owner keeps farms.user_id access even without a membership row.
  IF EXISTS (SELECT 1 FROM farms WHERE id = OLD.farm_id AND user_id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  UPDATE tasks SET assigned_to = NULL
   WHERE farm_id = OLD.farm_id AND assigned_to = OLD.user_id;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.unassign_tasks_of_removed_member() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS unassign_tasks_of_removed_member ON public.farm_members;
CREATE TRIGGER unassign_tasks_of_removed_member
  AFTER DELETE ON public.farm_members
  FOR EACH ROW EXECUTE FUNCTION public.unassign_tasks_of_removed_member();
