-- =========================================================
-- 109  A partner brings their own client
--
-- WHY
--
-- There are two kinds of contractor and they are the same role on the same dashboard:
-- one is INVITED to somebody else's project, the other is a PARTNER who brings their own
-- clients. Until now only the first could actually do anything — a partner's client had
-- to be onboarded by an admin at /admin/projects/new, so the thing that makes a partner
-- a partner was the one thing the product could not do.
--
-- This lets a partner run the same wizard an admin runs, for a client they invited.
--
-- ── The client is invited, never provisioned ─────────────────────────────────────────
-- A contractor does NOT create credentials. The server invites the address (Supabase's
-- own invite, which creates the account and mails the only way into it in one step), and
-- the client sets their own password. The contractor never sees one.
--
-- That is the whole difference from /admin/users/new, which shows staff a temporary
-- password. Staff are accountable to Jalla; a contractor is a third party, and handing
-- them a working credential for somebody else's account would make every project that
-- client ever owns repudiable.
--
-- ── Why a link table and not a broad policy ──────────────────────────────────────────
-- 082 gives admins INSERT on the five project tables with a bare `is_admin()`. The same
-- shape for contractors — "a contractor may insert a project for anyone" — would let any
-- contractor create a project owned by any user on the platform, including staff.
--
-- So the right is scoped to people they actually brought: `contractor_clients` records
-- the invitation, the server writes it at invite time, and every policy below reads it.
-- A contractor with no clients can insert nothing.
--
-- ── What this does NOT give them ─────────────────────────────────────────────────────
-- No ability to read another contractor's clients, no ability to create an account, no
-- ability to change a project once the client owns it beyond what any contractor on a
-- project already has, and no money. Being primary on the project they created is the
-- point — that is who gets paid — but the staff check still gates every release (101).
--
-- Run in: Supabase Dashboard > SQL Editor (after 108)
-- =========================================================

BEGIN;

-- ── 1. Who a contractor brought on ───────────────────────
CREATE TABLE IF NOT EXISTS public.contractor_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_at    timestamptz NOT NULL DEFAULT now(),
  -- Null until they open the invitation; the contractor sees "invited" until then.
  accepted_at   timestamptz,
  UNIQUE (contractor_id, client_id),
  -- A contractor is not their own client, and the policies below would read oddly if so.
  CONSTRAINT contractor_client_not_self CHECK (contractor_id <> client_id)
);

CREATE INDEX IF NOT EXISTS contractor_clients_by_contractor
  ON public.contractor_clients (contractor_id);

COMMENT ON TABLE public.contractor_clients IS
  'A client a partner contractor brought onto Groundwork (109). Written by the server '
  'when it invites the address — a contractor cannot write it, and it is what scopes '
  'their right to create a project for somebody other than themselves.';

ALTER TABLE public.contractor_clients ENABLE ROW LEVEL SECURITY;

-- A contractor reads their own list; the client reads who brought them; staff read all.
-- Nobody writes: the server does, under the service role, at invite time.
DROP POLICY IF EXISTS "contractor_reads_own_clients" ON public.contractor_clients;
CREATE POLICY "contractor_reads_own_clients"
  ON public.contractor_clients FOR SELECT TO authenticated
  USING (contractor_id = auth.uid() OR client_id = auth.uid() OR public.is_admin());

-- ── 2. Is this project for a client I brought? ───────────
--
-- One definition, used by all five policies below, so they cannot drift apart.
CREATE OR REPLACE FUNCTION public.is_my_client(p_client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contractor_clients cc
     WHERE cc.contractor_id = auth.uid() AND cc.client_id = p_client
  );
$$;

CREATE OR REPLACE FUNCTION public.is_my_clients_project(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
      JOIN public.contractor_clients cc ON cc.client_id = p.user_id
     WHERE p.id = p_project AND cc.contractor_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_my_client(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_clients_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_client(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_clients_project(uuid) TO authenticated;

-- ── 3. The same five tables 082 opened for admins ────────
DROP POLICY IF EXISTS "contractor_insert_client_projects" ON public.projects;
CREATE POLICY "contractor_insert_client_projects"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.is_my_client(user_id));

DROP POLICY IF EXISTS "contractor_insert_client_stages" ON public.project_stages;
CREATE POLICY "contractor_insert_client_stages"
  ON public.project_stages FOR INSERT TO authenticated
  WITH CHECK (public.is_my_clients_project(project_id));

DROP POLICY IF EXISTS "contractor_insert_client_substages" ON public.project_substages;
CREATE POLICY "contractor_insert_client_substages"
  ON public.project_substages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.project_stages s
                       WHERE s.id = stage_id AND public.is_my_clients_project(s.project_id)));

DROP POLICY IF EXISTS "contractor_insert_client_fees" ON public.project_fees;
CREATE POLICY "contractor_insert_client_fees"
  ON public.project_fees FOR INSERT TO authenticated
  WITH CHECK (public.is_my_clients_project(project_id));

DROP POLICY IF EXISTS "contractor_insert_client_documents" ON public.project_documents;
CREATE POLICY "contractor_insert_client_documents"
  ON public.project_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_my_clients_project(project_id));

-- ── 4. The partner takes their place on it ───────────────
--
-- Creating the project does not put them on it: membership is `contractor_invites`
-- (086's `is_contractor_on`), and being primary is what decides who a release pays (101).
-- Both are set here, in one act, for a project they just created for their own client.
--
-- Idempotent, so a retry after a dropped connection is not an error.
CREATE OR REPLACE FUNCTION public.contractor_take_own_client_project(p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_id    uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF NOT public.is_my_clients_project(p_project) THEN
    RAISE EXCEPTION 'not_my_client: this project does not belong to a client you brought on';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_actor;
  IF v_email IS NULL THEN RAISE EXCEPTION 'no_email: your account has no address on file'; END IF;

  -- `invited_by` is the contractor: nobody else asked for this, and recording an admin
  -- would say a member of staff put them there.
  INSERT INTO public.contractor_invites
    (project_id, invited_by, email, role, status, accepted_at, is_primary)
  VALUES (p_project, v_actor, v_email, 'contractor', 'accepted', now(), true)
  ON CONFLICT (project_id, email) DO UPDATE
     SET status = 'accepted', accepted_at = COALESCE(public.contractor_invites.accepted_at, now())
  RETURNING id INTO v_id;

  -- 004 has no contractor_user_id; 20260714000000 added it. Set separately so this file
  -- does not assume a column order.
  UPDATE public.contractor_invites SET contractor_user_id = v_actor WHERE id = v_id;

  PERFORM public.log_activity(p_project, 'contractor.took_own_client_project',
    'contractor_invite', v_id, v_actor, jsonb_build_object('primary', true));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.contractor_take_own_client_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contractor_take_own_client_project(uuid) TO authenticated;

-- ── 5. The creator stamp now has two possible authors ────
COMMENT ON COLUMN public.projects.created_by IS
  'Whoever created this project on the owner''s behalf — an admin (082) or the partner '
  'contractor who brought the client on (109). Null when the owner created it themselves.';

-- ── 6. The partner may finish the wizard they are allowed to start ───────────────────
--
-- Reproduced from 072 with ONE line changed: the gate. Everything else is that file's
-- body verbatim, and `109_tracking_gate.test.ts` fails if the two ever drift apart —
-- a copied function that quietly falls behind its original is worse than no copy.
CREATE OR REPLACE FUNCTION public.admin_start_project_tracking(
  p_project_id       uuid,
  p_final_budget     numeric,
  p_construction_fee numeric,
  p_design_fee       numeric,
  p_permit_fee       numeric,
  p_professional_fee numeric,
  p_verification_fee numeric,
  p_contingency_fee  numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Widened by 109. Was `is_admin()` alone, which meant a partner contractor could
  -- create their own client's project (109's policies) and then not be allowed to
  -- confirm its budget — the wizard would stop one step from the end.
  --
  -- `is_my_clients_project` is narrow: true only for a project whose owner this caller
  -- invited onto Groundwork. A contractor with no clients can still call nothing.
  IF NOT (public.is_admin() OR public.is_my_clients_project(p_project_id)) THEN
    RAISE EXCEPTION 'admins only';
  END IF;

  UPDATE public.projects
    SET budget_usd          = p_final_budget,
        tracking_started_at = now(),
        updated_at          = now()
    WHERE id = p_project_id
      AND tracking_started_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or tracking already started';
  END IF;

  PERFORM public.apply_budget_milestones(
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee,
    p_professional_fee, p_verification_fee, p_contingency_fee
  );

  UPDATE public.project_stages
    SET status = 'active'
    WHERE project_id = p_project_id
      AND stage_number = 1;

  UPDATE public.project_substages sub
    SET status = 'pending'
    FROM public.project_stages ps
    WHERE sub.stage_id = ps.id
      AND ps.project_id = p_project_id
      AND ps.stage_number = 1
      AND sub.status = 'locked';
END;
$$;

COMMIT;
