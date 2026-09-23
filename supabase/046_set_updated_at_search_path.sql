-- Supabase advisor 0011 (function_search_path_mutable) flagged set_updated_at
-- (043): a trigger function without a fixed search_path resolves names
-- through the caller's path. It only assigns NEW.updated_at := now(), but
-- pinning the path is free and matches every other function in the schema.
ALTER FUNCTION public.set_updated_at() SET search_path = public;
