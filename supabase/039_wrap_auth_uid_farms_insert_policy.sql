-- Follow-up to 038: "Users insert own farms" is an INSERT-only policy (no
-- USING clause, only WITH CHECK), so it was excluded by a NULL-handling bug
-- in the query that generated 038's DROP/CREATE list (qual IS NULL for a
-- pure INSERT policy made the WHERE clause evaluate to NULL for that row).
DROP POLICY "Users insert own farms" ON public.farms;
CREATE POLICY "Users insert own farms" ON public.farms AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = user_id));
