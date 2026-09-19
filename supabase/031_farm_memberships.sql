-- CampoAI farm sharing.
-- Owners keep the legacy farms.user_id link; memberships add editor/viewer
-- access without breaking deployments that have not applied this migration yet.

CREATE TABLE IF NOT EXISTS farm_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (farm_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_farm_members_user ON farm_members(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_farm_members_farm ON farm_members(farm_id, created_at);

INSERT INTO farm_members (farm_id, user_id, email, role)
SELECT f.id, f.user_id, u.email, 'owner'
FROM farms f
LEFT JOIN auth.users u ON u.id = f.user_id
WHERE f.user_id IS NOT NULL
ON CONFLICT (farm_id, user_id) DO UPDATE
SET role = 'owner', email = COALESCE(EXCLUDED.email, farm_members.email);

CREATE TABLE IF NOT EXISTS farm_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_invites_farm ON farm_invites(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_farm_invites_email ON farm_invites(lower(email), expires_at);

ALTER TABLE farm_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_invites ENABLE ROW LEVEL SECURITY;

-- Older setup scripts used this policy name without `TO service_role`, which
-- makes it apply to every role. Recreate those policies with the intended
-- scope before adding the shared-access policies below.
DO $$
DECLARE
  table_name TEXT;
  service_tables CONSTANT TEXT[] := ARRAY[
    'farms', 'sections', 'cattle', 'activities', 'chat_messages',
    'vaccinations', 'health_events', 'padrones', 'map_features',
    'chat_requests', 'whatsapp_events', 'sample_data_requests'
  ];
BEGIN
  FOREACH table_name IN ARRAY service_tables LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Service role full access', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role full access', table_name
    );
  END LOOP;

  DROP POLICY IF EXISTS "Anon read farms" ON farms;
  DROP POLICY IF EXISTS "Anon read sections" ON sections;
  DROP POLICY IF EXISTS "Anon read cattle" ON cattle;
  DROP POLICY IF EXISTS "Anon read activities" ON activities;
END $$;

CREATE OR REPLACE FUNCTION public.is_farm_owner(p_farm_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM farms WHERE id = p_farm_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_farm_role(p_farm_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM farm_members WHERE farm_id = p_farm_id AND user_id = auth.uid() AND role = ANY(p_roles));
$$;

REVOKE ALL ON FUNCTION public.is_farm_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_farm_role(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_farm_owner(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_farm_role(UUID, TEXT[]) TO authenticated, service_role;

DROP POLICY IF EXISTS "Members read farm memberships" ON farm_members;
CREATE POLICY "Members read farm memberships" ON farm_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_farm_owner(farm_id)
  );

DROP POLICY IF EXISTS "Owners manage farm memberships" ON farm_members;
CREATE POLICY "Owners manage farm memberships" ON farm_members FOR ALL
  USING (public.is_farm_owner(farm_id))
  WITH CHECK (public.is_farm_owner(farm_id));

DROP POLICY IF EXISTS "Owners manage farm invites" ON farm_invites;
CREATE POLICY "Owners manage farm invites" ON farm_invites FOR ALL
  USING (public.is_farm_owner(farm_id))
  WITH CHECK (public.is_farm_owner(farm_id));

-- Direct Supabase clients receive the same read/write boundary as the API.
-- The API still performs its own role check because it intentionally uses the
-- service-role client for bounded, cross-table operations.
DO $$
DECLARE
  table_name TEXT;
  shared_tables CONSTANT TEXT[] := ARRAY[
    'sections', 'cattle', 'activities', 'vaccinations', 'health_events',
    'chat_messages', 'padrones', 'map_features', 'crops', 'crop_applications',
    'inventory_items', 'inventory_movements', 'financial_transactions',
    'farm_insights', 'weight_records', 'tasks', 'chat_requests'
  ];
BEGIN
  FOREACH table_name IN ARRAY shared_tables LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Members read shared ' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.has_farm_role(public.%I.farm_id, ARRAY[''owner'', ''editor'', ''viewer'']))',
      'Members read shared ' || table_name, table_name, table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Editors manage shared ' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.has_farm_role(public.%I.farm_id, ARRAY[''owner'', ''editor''])) WITH CHECK (public.has_farm_role(public.%I.farm_id, ARRAY[''owner'', ''editor'']))',
      'Editors manage shared ' || table_name, table_name, table_name, table_name
    );
  END LOOP;

  DROP POLICY IF EXISTS "Members read shared farms" ON farms;
  CREATE POLICY "Members read shared farms" ON farms FOR SELECT
    USING (public.has_farm_role(farms.id, ARRAY['owner', 'editor', 'viewer']));

  DROP POLICY IF EXISTS "Editors update shared farms" ON farms;
  CREATE POLICY "Editors update shared farms" ON farms FOR UPDATE
    USING (public.has_farm_role(farms.id, ARRAY['owner', 'editor']))
    WITH CHECK (public.has_farm_role(farms.id, ARRAY['owner', 'editor']));
END $$;

-- Ownership and the WhatsApp routing phone are server-managed. Without this
-- guard, "Editors update shared farms" would let an editor PATCH farms.user_id
-- through the REST API (making themselves owner), and any signed-in user could
-- claim another person's owner_phone. The API uses the service role, which keeps
-- full control; direct clients running as anon/authenticated do not.
CREATE OR REPLACE FUNCTION public.guard_farm_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := auth.uid();
    NEW.owner_phone := 'web-' || auth.uid();
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.owner_phone IS DISTINCT FROM OLD.owner_phone THEN
    RAISE EXCEPTION 'farm owner and phone can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_farm_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_farm_identity ON farms;
CREATE TRIGGER guard_farm_identity
  BEFORE INSERT OR UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION public.guard_farm_identity();
