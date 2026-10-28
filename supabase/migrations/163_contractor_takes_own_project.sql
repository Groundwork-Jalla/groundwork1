-- Let a contractor take their place on a project they built for themselves.
--
-- 109 wrote this for a partner who brings a client: the guard asks
-- `is_my_clients_project`, which is false for a contractor's OWN build, so the call
-- was simply never made for them — `Step11ConfirmBudget` only invoked it for
-- `onBehalfOf.by === 'partner'`.
--
-- The result, reported 29 October: a contractor created three projects, held the
-- contractor role, and had no `contractor_invites` row for any of them. They were
-- therefore not the contractor on their own builds — /work could not open them, the
-- project page showed them the CLIENT's view, and it offered to invite a contractor
-- to a job they had just created themselves.
--
-- Nothing else changes. Membership is still one accepted `contractor_invites` row,
-- still primary (which is who a release pays, 101), and still idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.contractor_take_own_client_project(p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_id    uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF NOT (
       public.is_my_clients_project(p_project)
    -- Or it is simply THEIRS. A contractor building their own project is still the
    -- contractor on it, and `is_my_clients_project` only ever meant "a client I
    -- brought on" — a test that a contractor's own build can never pass.
    OR EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = p_project AND p.user_id = v_actor)
  ) THEN
    RAISE EXCEPTION 'not_mine: this project is neither yours nor your client''s';
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

COMMIT;
