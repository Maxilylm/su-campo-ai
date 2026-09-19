-- Foundation for binding AI confirmation tokens to each target row's
-- updated_at (optimistic concurrency -- GOAL-audit-2026-09.md's "Bind
-- confirmation tokens to userId and each target row's updated_at").
-- Discovered while starting that work: only cattle and tasks (of the 10
-- AI update/delete-reachable tables -- inventory_movements and
-- weight_records are insert-only in executeOperations) had an updated_at
-- column at all, and even those two relied on API routes manually setting
-- it (cattle/route.ts:232, tasks/route.ts:194); the AI write path strips
-- any updated_at the model sends (ai.ts:982) and never re-sets it, so
-- every AI-driven update to cattle/tasks has been leaving updated_at
-- stale since the AI path shipped. A DB-level BEFORE UPDATE trigger fixes
-- that independently of the confirmation-binding work, and is required by
-- it: a reliable, DB-enforced updated_at is what "expected value changed"
-- detection anchors on. log_field_mutation() (035) logs one row-level
-- activity per mutation, not per changed column, so this doesn't add
-- history-feed noise.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

ALTER TABLE public.sections ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.vaccinations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.health_events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.crops ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.crop_applications ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.financial_transactions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_updated_at_sections ON public.sections;
CREATE TRIGGER set_updated_at_sections BEFORE UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_cattle ON public.cattle;
CREATE TRIGGER set_updated_at_cattle BEFORE UPDATE ON public.cattle FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_activities ON public.activities;
CREATE TRIGGER set_updated_at_activities BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_vaccinations ON public.vaccinations;
CREATE TRIGGER set_updated_at_vaccinations BEFORE UPDATE ON public.vaccinations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_health_events ON public.health_events;
CREATE TRIGGER set_updated_at_health_events BEFORE UPDATE ON public.health_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_crops ON public.crops;
CREATE TRIGGER set_updated_at_crops BEFORE UPDATE ON public.crops FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_crop_applications ON public.crop_applications;
CREATE TRIGGER set_updated_at_crop_applications BEFORE UPDATE ON public.crop_applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_inventory_items ON public.inventory_items;
CREATE TRIGGER set_updated_at_inventory_items BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_financial_transactions ON public.financial_transactions;
CREATE TRIGGER set_updated_at_financial_transactions BEFORE UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_tasks ON public.tasks;
CREATE TRIGGER set_updated_at_tasks BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
