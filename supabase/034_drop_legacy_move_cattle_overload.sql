-- CREATE OR REPLACE FUNCTION with an added parameter creates a new overload
-- instead of replacing the old one (signatures differ). The app always calls
-- move_cattle with all 5 named args (033 added p_idempotency_key), so the
-- old 4-arg overload is now dead and would only recreate the ambiguous-
-- overload class of bug 032 already fixed for record_weight.
DROP FUNCTION IF EXISTS public.move_cattle(uuid, uuid, uuid, integer);
