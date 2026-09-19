-- Wraps every bare auth.uid() call in RLS USING/WITH CHECK clauses as
-- (select auth.uid()) across the 24 policies the performance advisor flagged
-- (auth_rls_initplan). This is a pure query-plan optimization, not an access-
-- control change: (select auth.uid()) evaluates to the exact same value as
-- auth.uid(), it just lets Postgres cache it once per query (an InitPlan)
-- instead of re-evaluating it once per row. Generated from pg_policies and
-- verified with a dry run (BEGIN...ROLLBACK) before applying.

DROP POLICY "Users manage own activities" ON public.activities;
CREATE POLICY "Users manage own activities" ON public.activities AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users read own activities" ON public.activities;
CREATE POLICY "Users read own activities" ON public.activities AS PERMISSIVE FOR SELECT TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own cattle" ON public.cattle;
CREATE POLICY "Users manage own cattle" ON public.cattle AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users read own cattle" ON public.cattle;
CREATE POLICY "Users read own cattle" ON public.cattle AS PERMISSIVE FOR SELECT TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own chat messages" ON public.chat_messages;
CREATE POLICY "Users manage own chat messages" ON public.chat_messages AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own chat requests" ON public.chat_requests;
CREATE POLICY "Users manage own chat requests" ON public.chat_requests AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own crop_applications" ON public.crop_applications;
CREATE POLICY "Users access own crop_applications" ON public.crop_applications AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own crops" ON public.crops;
CREATE POLICY "Users access own crops" ON public.crops AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own farm_insights" ON public.farm_insights;
CREATE POLICY "Users access own farm_insights" ON public.farm_insights AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Members read farm memberships" ON public.farm_members;
CREATE POLICY "Members read farm memberships" ON public.farm_members AS PERMISSIVE FOR SELECT TO public USING (((user_id = (select auth.uid())) OR is_farm_owner(farm_id)));

DROP POLICY "Users read own farms" ON public.farms;
CREATE POLICY "Users read own farms" ON public.farms AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = user_id));

DROP POLICY "Users update own farms" ON public.farms;
CREATE POLICY "Users update own farms" ON public.farms AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = user_id));

DROP POLICY "Users access own financial_transactions" ON public.financial_transactions;
CREATE POLICY "Users access own financial_transactions" ON public.financial_transactions AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own health events" ON public.health_events;
CREATE POLICY "Users manage own health events" ON public.health_events AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own inventory_items" ON public.inventory_items;
CREATE POLICY "Users access own inventory_items" ON public.inventory_items AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own inventory_movements" ON public.inventory_movements;
CREATE POLICY "Users access own inventory_movements" ON public.inventory_movements AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own map features" ON public.map_features;
CREATE POLICY "Users manage own map features" ON public.map_features AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own padrones" ON public.padrones;
CREATE POLICY "Users manage own padrones" ON public.padrones AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own sample data requests" ON public.sample_data_requests;
CREATE POLICY "Users manage own sample data requests" ON public.sample_data_requests AS PERMISSIVE FOR ALL TO public USING ((user_id = (select auth.uid())));

DROP POLICY "Users manage own sections" ON public.sections;
CREATE POLICY "Users manage own sections" ON public.sections AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users read own sections" ON public.sections;
CREATE POLICY "Users read own sections" ON public.sections AS PERMISSIVE FOR SELECT TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own tasks" ON public.tasks;
CREATE POLICY "Users access own tasks" ON public.tasks AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own vaccinations" ON public.vaccinations;
CREATE POLICY "Users manage own vaccinations" ON public.vaccinations AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own weight_records" ON public.weight_records;
CREATE POLICY "Users access own weight_records" ON public.weight_records AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));
