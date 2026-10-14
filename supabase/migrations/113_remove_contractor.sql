-- =========================================================
-- 113  Removing a contractor from the platform
--
-- WHY
--
-- /admin/contractors can delete a DIRECTORY LISTING, which takes somebody out of the list
-- clients browse and does nothing else: they keep the role, keep their projects, and keep
-- /work. And a partner who signed themselves up (106) often has no listing at all, so
-- there was nothing on that page to remove — no way to take back access once given.
--
-- ── Why "delete the account" is the wrong tool ───────────────────────────────────────
-- Deleting the auth user cascades: their stage approvals, site updates, audit rows and
-- the invites naming them all reference it. The record of who built a house would go with
-- them, and that record is the point of Groundwork. So this removes STANDING and keeps
-- the person: the account stays, the history stays, and they can be given the role again
-- without rebuilding anything.
--
-- ── Both halves, or it does nothing ──────────────────────────────────────────────────
-- `holdsContractorAccess` is "the role OR an accepted assignment". Revoking the role on
-- its own leaves anybody who is on a project still able to sign in and work, which is the
-- opposite of what an admin pressing Remove expects. So assignments are withdrawn too.
--
-- ── What it refuses ──────────────────────────────────────────────────────────────────
-- Money already on its way to them. A release at `release_authorised`, `initiated` or
-- `reconciling` is a payment the platform has committed to and, for the last two, one the
-- provider may already be moving. Withdrawing the person it is addressed to would leave a
-- payment with no payee and a stage nobody is accountable for. Settle or fail it first.
--
-- `disbursed` and `failed` are final and do not block: the money has arrived, or it has
-- not and will not.
--
-- Run in: Supabase Dashboard > SQL Editor (after 112)
-- =========================================================

BEGIN;

-- ── 1. What would happen if I removed this person? ───────
--
-- So the confirmation can say "this takes them off 3 projects, 1 as the contractor who
-- gets paid" instead of asking somebody to press Remove and find out.
CREATE OR REPLACE FUNCTION public.admin_contractor_removal_check(p_user uuid)
RETURNS TABLE (
  full_name        text,
  email            text,
  active_projects  integer,
  primary_on       integer,
  money_in_flight  integer,
  has_listing      boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.full_name,
    p.email,
    (SELECT count(*)::int FROM public.contractor_invites ci
      WHERE ci.contractor_user_id = p_user AND ci.status = 'accepted'),
    (SELECT count(*)::int FROM public.contractor_invites ci
      WHERE ci.contractor_user_id = p_user AND ci.status = 'accepted' AND ci.is_primary),
    (SELECT count(*)::int FROM public.payments pay
      WHERE pay.beneficiary_id = p_user
        AND pay.direction = 'out'
        AND pay.state IN ('release_authorised', 'initiated', 'reconciling')),
    EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = p_user)
  FROM public.profiles p
  WHERE p.id = p_user AND public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.admin_contractor_removal_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_contractor_removal_check(uuid) TO authenticated;

-- ── 2. Remove them ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_remove_contractor(p_user uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_inflight integer;
  v_projects integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator removes a contractor';
  END IF;
  IF p_user IS NULL THEN RAISE EXCEPTION 'no_user: nobody named'; END IF;
  -- Removing your own standing by accident, in a screen full of other people's names, is
  -- a mistake worth one extra click elsewhere rather than a silent success here.
  IF p_user = v_actor THEN
    RAISE EXCEPTION 'self_removal: you cannot remove your own contractor standing here';
  END IF;

  SELECT count(*) INTO v_inflight
    FROM public.payments
   WHERE beneficiary_id = p_user
     AND direction = 'out'
     AND state IN ('release_authorised', 'initiated', 'reconciling');

  IF v_inflight > 0 THEN
    RAISE EXCEPTION 'money_in_flight: % release(s) are on their way to this contractor; settle or fail them first', v_inflight;
  END IF;

  -- Both halves. `is_primary` is cleared in the same statement because 101's CHECK ties
  -- it to `status = 'accepted'` — setting one without the other violates it.
  SELECT count(*) INTO v_projects
    FROM public.contractor_invites
   WHERE contractor_user_id = p_user AND status IN ('accepted', 'pending');

  UPDATE public.contractor_invites
     SET status = 'rejected', is_primary = false
   WHERE contractor_user_id = p_user AND status IN ('accepted', 'pending');

  DELETE FROM public.user_roles WHERE user_id = p_user AND role = 'contractor';

  -- Taken down, not deleted: reviews, ratings and the link to the application that
  -- published it are the record of a decision somebody made, and a later reinstatement
  -- should not have to rebuild them.
  UPDATE public.contractors SET active = false WHERE user_id = p_user;

  -- The clients a partner brought stay with their own projects; what ends is the
  -- partner's standing to create more for them.
  PERFORM public.log_activity(NULL, 'contractor.removed', 'profile', p_user, p_user,
    jsonb_strip_nulls(jsonb_build_object(
      'projects_withdrawn', v_projects,
      'reason', NULLIF(btrim(coalesce(p_reason, '')), ''),
      'by', 'admin')));
END $$;

REVOKE ALL ON FUNCTION public.admin_remove_contractor(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_contractor(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_remove_contractor(uuid, text) IS
  'Ends a contractor''s standing (113): revokes the role, withdraws their project '
  'assignments and takes their directory entry down. The ACCOUNT and all history stay — '
  'deleting the user would cascade through every approval and audit row that names them. '
  'Refuses while a release is on its way to them.';

COMMIT;
