-- Drops the pre-031 "own farm" policies (farms.user_id = auth.uid()) that
-- migration 031's "shared farm" policies (has_farm_role(...)) now fully
-- subsume: every farm's owner is backfilled into farm_members with
-- role='owner' (verified: 0 of 5 farms missing that row), and new farm
-- creation inserts the owner's membership row atomically (api/farm/route.ts
-- POST), so has_farm_role(farm_id, ARRAY['owner','editor']) is true
-- whenever farms.user_id = auth.uid() would have been, plus it correctly
-- extends the same access to editors (and viewers for SELECT). Having both
-- policies live side by side is exactly the multiple_permissive_policies
-- (259) the performance advisor flags -- Postgres evaluates and ORs every
-- permissive policy on every query. farms.user_id itself, and "Users insert
-- own farms" (no shared equivalent -- farm creation isn't a shared action),
-- are untouched.
-- Verified via a dry run (BEGIN...ROLLBACK): every affected table retains
-- exactly one non-service-role policy per command after these drops.

DROP POLICY "Users manage own activities" ON public.activities;
DROP POLICY "Users read own activities" ON public.activities;
DROP POLICY "Users manage own cattle" ON public.cattle;
DROP POLICY "Users read own cattle" ON public.cattle;
DROP POLICY "Users manage own chat messages" ON public.chat_messages;
DROP POLICY "Users manage own chat requests" ON public.chat_requests;
DROP POLICY "Users access own crop_applications" ON public.crop_applications;
DROP POLICY "Users access own crops" ON public.crops;
DROP POLICY "Users access own farm_insights" ON public.farm_insights;
DROP POLICY "Users access own financial_transactions" ON public.financial_transactions;
DROP POLICY "Users manage own health events" ON public.health_events;
DROP POLICY "Users access own inventory_items" ON public.inventory_items;
DROP POLICY "Users access own inventory_movements" ON public.inventory_movements;
DROP POLICY "Users manage own map features" ON public.map_features;
DROP POLICY "Users manage own padrones" ON public.padrones;
DROP POLICY "Users manage own sections" ON public.sections;
DROP POLICY "Users read own sections" ON public.sections;
DROP POLICY "Users access own tasks" ON public.tasks;
DROP POLICY "Users manage own vaccinations" ON public.vaccinations;
DROP POLICY "Users access own weight_records" ON public.weight_records;
DROP POLICY "Users read own farms" ON public.farms;
DROP POLICY "Users update own farms" ON public.farms;
