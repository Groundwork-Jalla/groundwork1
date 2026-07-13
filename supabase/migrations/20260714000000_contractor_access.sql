-- 007b_contractor_access.sql
-- Contractor scoped access: invite tokens, user_roles table, RLS policies, RPCs, invite limit trigger

-- ── Extend contractor_invites ─────────────────────────────────────────────
ALTER TABLE public.contractor_invites
  ADD COLUMN IF NOT EXISTS token              UUID DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN IF NOT EXISTS contractor_user_id UUID REFERENCES auth.users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contractor_invites_token_key'
  ) THEN
    ALTER TABLE public.contractor_invites
      ADD CONSTRAINT contractor_invites_token_key UNIQUE (token);
  END IF;
END $$;

-- ── user_roles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('homeowner', 'contractor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_roles" ON public.user_roles;
CREATE POLICY "users_read_own_roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- ── contractor_invites — contractors can see their own accepted invites ────
DROP POLICY IF EXISTS "contractors_read_own_invites" ON public.contractor_invites;
CREATE POLICY "contractors_read_own_invites"
  ON public.contractor_invites FOR SELECT
  USING (contractor_user_id = auth.uid());

-- ── projects — contractors can read projects they are accepted into ────────
DROP POLICY IF EXISTS "contractors_select_invited_projects" ON public.projects;
CREATE POLICY "contractors_select_invited_projects"
  ON public.projects FOR SELECT
  USING (
    id IN (
      SELECT project_id FROM public.contractor_invites
      WHERE contractor_user_id = auth.uid()
        AND status = 'accepted'
    )
  );

-- ── project_stages ────────────────────────────────────────────────────────
ALTER TABLE public.project_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all_stages" ON public.project_stages;
CREATE POLICY "owner_all_stages"
  ON public.project_stages FOR ALL
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "contractors_select_stages" ON public.project_stages;
CREATE POLICY "contractors_select_stages"
  ON public.project_stages FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM public.contractor_invites
      WHERE contractor_user_id = auth.uid()
        AND status = 'accepted'
    )
  );

-- ── project_substages ─────────────────────────────────────────────────────
ALTER TABLE public.project_substages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all_substages" ON public.project_substages;
CREATE POLICY "owner_all_substages"
  ON public.project_substages FOR ALL
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "contractors_select_substages" ON public.project_substages;
CREATE POLICY "contractors_select_substages"
  ON public.project_substages FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM public.contractor_invites
      WHERE contractor_user_id = auth.uid()
        AND status = 'accepted'
    )
  );

-- Contractors may update evidence_urls on substages for their invited projects
DROP POLICY IF EXISTS "contractors_update_evidence" ON public.project_substages;
CREATE POLICY "contractors_update_evidence"
  ON public.project_substages FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM public.contractor_invites
      WHERE contractor_user_id = auth.uid()
        AND status = 'accepted'
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM public.contractor_invites
      WHERE contractor_user_id = auth.uid()
        AND status = 'accepted'
    )
  );

-- ── project_messages ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contractors_read_invited_messages" ON public.project_messages;
CREATE POLICY "contractors_read_invited_messages"
  ON public.project_messages FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM public.contractor_invites
      WHERE contractor_user_id = auth.uid()
        AND status = 'accepted'
    )
  );

DROP POLICY IF EXISTS "contractors_send_invited_messages" ON public.project_messages;
CREATE POLICY "contractors_send_invited_messages"
  ON public.project_messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND project_id IN (
      SELECT project_id FROM public.contractor_invites
      WHERE contractor_user_id = auth.uid()
        AND status = 'accepted'
    )
  );

-- ── Storage: evidence bucket — contractors can upload & read ──────────────
DROP POLICY IF EXISTS "contractor_evidence_upload" ON storage.objects;
CREATE POLICY "contractor_evidence_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT ci.contractor_user_id
      FROM public.contractor_invites ci
      WHERE ci.project_id::text = (storage.foldername(name))[1]
        AND ci.status = 'accepted'
        AND ci.contractor_user_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "contractor_evidence_read" ON storage.objects;
CREATE POLICY "contractor_evidence_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT ci.contractor_user_id
      FROM public.contractor_invites ci
      WHERE ci.project_id::text = (storage.foldername(name))[1]
        AND ci.status = 'accepted'
        AND ci.contractor_user_id IS NOT NULL
    )
  );

-- ── RPC: get_invite_by_token (public — SECURITY DEFINER bypasses RLS) ─────
CREATE OR REPLACE FUNCTION public.get_invite_by_token(p_token UUID)
RETURNS TABLE (
  project_id   UUID,
  invite_email TEXT,
  status       TEXT,
  project_name TEXT,
  inviter_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ci.project_id,
    ci.email                                     AS invite_email,
    ci.status,
    p.name                                       AS project_name,
    COALESCE(
      u.raw_user_meta_data->>'full_name',
      u.email
    )                                            AS inviter_name
  FROM public.contractor_invites ci
  JOIN public.projects           p ON p.id  = ci.project_id
  LEFT JOIN auth.users           u ON u.id  = ci.invited_by
  WHERE ci.token = p_token;
END;
$$;

-- Allow unauthenticated visitors to look up invite details (token is the secret)
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(UUID) TO anon, authenticated;

-- ── RPC: accept_contractor_invite (authenticated, SECURITY DEFINER) ───────
CREATE OR REPLACE FUNCTION public.accept_contractor_invite(p_token UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
BEGIN
  UPDATE public.contractor_invites
  SET
    status             = 'accepted',
    accepted_at        = now(),
    contractor_user_id = auth.uid()
  WHERE token  = p_token
    AND status = 'pending'
  RETURNING project_id INTO v_project_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'invite_invalid: Invite not found or already used.';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'contractor')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_contractor_invite(UUID) TO authenticated;

-- ── Trigger: Starter plan allows only 1 contractor per project ────────────
CREATE OR REPLACE FUNCTION public.check_contractor_invite_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tier         TEXT;
  v_invite_count INTEGER;
BEGIN
  SELECT tier INTO v_tier
  FROM public.projects
  WHERE id = NEW.project_id;

  IF v_tier = 'starter' THEN
    SELECT COUNT(*) INTO v_invite_count
    FROM public.contractor_invites
    WHERE project_id = NEW.project_id
      AND status IN ('pending', 'accepted');

    IF v_invite_count >= 1 THEN
      RAISE EXCEPTION 'starter_limit: Starter plan allows 1 contractor per project. Upgrade to Pro for unlimited.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_contractor_invite_limit ON public.contractor_invites;
CREATE TRIGGER enforce_contractor_invite_limit
  BEFORE INSERT ON public.contractor_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.check_contractor_invite_limit();
