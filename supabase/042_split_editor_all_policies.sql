-- Second half of the multiple_permissive_policies (advisor WARN) cleanup.
-- 041 dropped the pre-031 "own" policies that were fully subsumed by 031's
-- shared-farm policies; this migration addresses the remaining overlap
-- flagged by the advisor: each table's own "Editors manage shared X" policy
-- is FOR ALL (USING/WITH CHECK: has_farm_role(farm_id, ARRAY['owner',
-- 'editor'])), which implicitly includes SELECT -- redundant with, and
-- evaluated alongside, "Members read shared X" for every SELECT query
-- (both permissive, both OR'd in). Splitting the ALL policy into INSERT/
-- UPDATE/DELETE-only policies with the identical USING/WITH CHECK
-- expression preserves editor/owner write access exactly as before (their
-- SELECT access continues to come from "Members read shared X", which
-- already covers owner/editor/viewer), while eliminating the SELECT-path
-- overlap. Same pattern applied to farm_members' "Owners manage farm
-- memberships" vs "Members read farm memberships".
-- Verified via a dry run (BEGIN...ROLLBACK): every affected table retains
-- exactly one policy per command (SELECT/INSERT/UPDATE/DELETE) afterward.

DROP POLICY IF EXISTS "Editors manage shared activities" ON public.activities;
DROP POLICY IF EXISTS "Editors insert shared activities" ON public.activities;
CREATE POLICY "Editors insert shared activities" ON public.activities FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared activities" ON public.activities;
CREATE POLICY "Editors update shared activities" ON public.activities FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared activities" ON public.activities;
CREATE POLICY "Editors delete shared activities" ON public.activities FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared cattle" ON public.cattle;
DROP POLICY IF EXISTS "Editors insert shared cattle" ON public.cattle;
CREATE POLICY "Editors insert shared cattle" ON public.cattle FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared cattle" ON public.cattle;
CREATE POLICY "Editors update shared cattle" ON public.cattle FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared cattle" ON public.cattle;
CREATE POLICY "Editors delete shared cattle" ON public.cattle FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared chat_messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Editors insert shared chat_messages" ON public.chat_messages;
CREATE POLICY "Editors insert shared chat_messages" ON public.chat_messages FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared chat_messages" ON public.chat_messages;
CREATE POLICY "Editors update shared chat_messages" ON public.chat_messages FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared chat_messages" ON public.chat_messages;
CREATE POLICY "Editors delete shared chat_messages" ON public.chat_messages FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared chat_requests" ON public.chat_requests;
DROP POLICY IF EXISTS "Editors insert shared chat_requests" ON public.chat_requests;
CREATE POLICY "Editors insert shared chat_requests" ON public.chat_requests FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared chat_requests" ON public.chat_requests;
CREATE POLICY "Editors update shared chat_requests" ON public.chat_requests FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared chat_requests" ON public.chat_requests;
CREATE POLICY "Editors delete shared chat_requests" ON public.chat_requests FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared crop_applications" ON public.crop_applications;
DROP POLICY IF EXISTS "Editors insert shared crop_applications" ON public.crop_applications;
CREATE POLICY "Editors insert shared crop_applications" ON public.crop_applications FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared crop_applications" ON public.crop_applications;
CREATE POLICY "Editors update shared crop_applications" ON public.crop_applications FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared crop_applications" ON public.crop_applications;
CREATE POLICY "Editors delete shared crop_applications" ON public.crop_applications FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared crops" ON public.crops;
DROP POLICY IF EXISTS "Editors insert shared crops" ON public.crops;
CREATE POLICY "Editors insert shared crops" ON public.crops FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared crops" ON public.crops;
CREATE POLICY "Editors update shared crops" ON public.crops FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared crops" ON public.crops;
CREATE POLICY "Editors delete shared crops" ON public.crops FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared farm_insights" ON public.farm_insights;
DROP POLICY IF EXISTS "Editors insert shared farm_insights" ON public.farm_insights;
CREATE POLICY "Editors insert shared farm_insights" ON public.farm_insights FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared farm_insights" ON public.farm_insights;
CREATE POLICY "Editors update shared farm_insights" ON public.farm_insights FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared farm_insights" ON public.farm_insights;
CREATE POLICY "Editors delete shared farm_insights" ON public.farm_insights FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Owners manage farm memberships" ON public.farm_members;
DROP POLICY IF EXISTS "Owners insert farm memberships" ON public.farm_members;
CREATE POLICY "Owners insert farm memberships" ON public.farm_members FOR INSERT TO public WITH CHECK (is_farm_owner(farm_id));
DROP POLICY IF EXISTS "Owners update farm memberships" ON public.farm_members;
CREATE POLICY "Owners update farm memberships" ON public.farm_members FOR UPDATE TO public USING (is_farm_owner(farm_id)) WITH CHECK (is_farm_owner(farm_id));
DROP POLICY IF EXISTS "Owners delete farm memberships" ON public.farm_members;
CREATE POLICY "Owners delete farm memberships" ON public.farm_members FOR DELETE TO public USING (is_farm_owner(farm_id));

DROP POLICY IF EXISTS "Editors manage shared financial_transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Editors insert shared financial_transactions" ON public.financial_transactions;
CREATE POLICY "Editors insert shared financial_transactions" ON public.financial_transactions FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared financial_transactions" ON public.financial_transactions;
CREATE POLICY "Editors update shared financial_transactions" ON public.financial_transactions FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared financial_transactions" ON public.financial_transactions;
CREATE POLICY "Editors delete shared financial_transactions" ON public.financial_transactions FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared health_events" ON public.health_events;
DROP POLICY IF EXISTS "Editors insert shared health_events" ON public.health_events;
CREATE POLICY "Editors insert shared health_events" ON public.health_events FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared health_events" ON public.health_events;
CREATE POLICY "Editors update shared health_events" ON public.health_events FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared health_events" ON public.health_events;
CREATE POLICY "Editors delete shared health_events" ON public.health_events FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared inventory_items" ON public.inventory_items;
DROP POLICY IF EXISTS "Editors insert shared inventory_items" ON public.inventory_items;
CREATE POLICY "Editors insert shared inventory_items" ON public.inventory_items FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared inventory_items" ON public.inventory_items;
CREATE POLICY "Editors update shared inventory_items" ON public.inventory_items FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared inventory_items" ON public.inventory_items;
CREATE POLICY "Editors delete shared inventory_items" ON public.inventory_items FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared inventory_movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "Editors insert shared inventory_movements" ON public.inventory_movements;
CREATE POLICY "Editors insert shared inventory_movements" ON public.inventory_movements FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared inventory_movements" ON public.inventory_movements;
CREATE POLICY "Editors update shared inventory_movements" ON public.inventory_movements FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared inventory_movements" ON public.inventory_movements;
CREATE POLICY "Editors delete shared inventory_movements" ON public.inventory_movements FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared map_features" ON public.map_features;
DROP POLICY IF EXISTS "Editors insert shared map_features" ON public.map_features;
CREATE POLICY "Editors insert shared map_features" ON public.map_features FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared map_features" ON public.map_features;
CREATE POLICY "Editors update shared map_features" ON public.map_features FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared map_features" ON public.map_features;
CREATE POLICY "Editors delete shared map_features" ON public.map_features FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared padrones" ON public.padrones;
DROP POLICY IF EXISTS "Editors insert shared padrones" ON public.padrones;
CREATE POLICY "Editors insert shared padrones" ON public.padrones FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared padrones" ON public.padrones;
CREATE POLICY "Editors update shared padrones" ON public.padrones FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared padrones" ON public.padrones;
CREATE POLICY "Editors delete shared padrones" ON public.padrones FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared sections" ON public.sections;
DROP POLICY IF EXISTS "Editors insert shared sections" ON public.sections;
CREATE POLICY "Editors insert shared sections" ON public.sections FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared sections" ON public.sections;
CREATE POLICY "Editors update shared sections" ON public.sections FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared sections" ON public.sections;
CREATE POLICY "Editors delete shared sections" ON public.sections FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared tasks" ON public.tasks;
DROP POLICY IF EXISTS "Editors insert shared tasks" ON public.tasks;
CREATE POLICY "Editors insert shared tasks" ON public.tasks FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared tasks" ON public.tasks;
CREATE POLICY "Editors update shared tasks" ON public.tasks FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared tasks" ON public.tasks;
CREATE POLICY "Editors delete shared tasks" ON public.tasks FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared vaccinations" ON public.vaccinations;
DROP POLICY IF EXISTS "Editors insert shared vaccinations" ON public.vaccinations;
CREATE POLICY "Editors insert shared vaccinations" ON public.vaccinations FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared vaccinations" ON public.vaccinations;
CREATE POLICY "Editors update shared vaccinations" ON public.vaccinations FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared vaccinations" ON public.vaccinations;
CREATE POLICY "Editors delete shared vaccinations" ON public.vaccinations FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared weight_records" ON public.weight_records;
DROP POLICY IF EXISTS "Editors insert shared weight_records" ON public.weight_records;
CREATE POLICY "Editors insert shared weight_records" ON public.weight_records FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared weight_records" ON public.weight_records;
CREATE POLICY "Editors update shared weight_records" ON public.weight_records FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared weight_records" ON public.weight_records;
CREATE POLICY "Editors delete shared weight_records" ON public.weight_records FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
