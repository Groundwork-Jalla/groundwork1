-- =========================================================
-- 115  Delete means delete
--
-- WHY
--
-- 113 and 114 refused to delete a contractor who had done anything, because nine columns
-- reference `auth.users` without a cascade and Postgres will not drop a row somebody
-- still points at. That refusal was the right default and it is not what was asked for:
-- pressing Delete is meant to end in the account being gone.
--
-- So this clears the references first. Stated plainly, because it is irreversible and it
-- reaches other people's projects:
--
-- ── ERASED, including from builds that are not theirs ────────────────────────────────
--   · site updates they posted                    (site_updates)
--   · stage verifications they signed             (stage_verifications)
--   · documents they uploaded                     (project_documents)
--   · take-offs they created                      (project_takeoffs)
--   · messages they sent                          (project_messages)
--   · invitations they issued                     (contractor_invites)
--
-- A client whose stage this person verified loses that verification. A project they
-- uploaded the bill of quantities to loses the file. That is the cost of a true delete,
-- and the confirmation screen says so before anybody presses it.
--
-- ── DETACHED, not erased ─────────────────────────────────────────────────────────────
--   · audit rows keep the event and forget who did it   (project_audit_log.actor_id)
--   · substage approvals keep the approval              (project_substages.approved_by)
--   · projects keep "created on someone's behalf"       (projects.created_by)
--
-- These are nullable, so the fact survives without the name. An audit log that loses the
-- entry entirely would be worse than one that says the actor is gone.
--
-- ── THEIR OWN, by cascade, once the row goes ────────────────────────────────────────
--   · profile, roles, payout destinations, client links
--   · any project they OWN, and everything on it
--
-- ── The one thing still refused ──────────────────────────────────────────────────────
-- Money already on its way to them. `payments.beneficiary_id` carries no foreign key
-- (089's rule), so a delete would not fail — it would silently leave a live release
-- addressed to somebody who no longer exists. That is not tidiness, it is a payment with
-- no payee. Settle or fail it, then delete.
--
-- Run in: Supabase Dashboard > SQL Editor (after 114)
-- =========================================================

BEGIN;

-- ── What a delete would erase ────────────────────────────
--
-- For the confirmation, so nobody discovers the cost afterwards.
CREATE OR REPLACE FUNCTION public.admin_contractor_delete_impact(p_user uuid)
RETURNS TABLE (
  site_updates    integer,
  verifications   integer,
  documents       integer,
  takeoffs        integer,
  messages        integer,
  invites_issued  integer,
  own_projects    integer,
  money_in_flight integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*)::int FROM public.site_updates        WHERE submitted_by = p_user),
    (SELECT count(*)::int FROM public.stage_verifications WHERE verifier_id  = p_user),
    (SELECT count(*)::int FROM public.project_documents   WHERE uploaded_by  = p_user),
    (SELECT count(*)::int FROM public.project_takeoffs    WHERE created_by   = p_user),
    (SELECT count(*)::int FROM public.project_messages    WHERE sender_id    = p_user),
    (SELECT count(*)::int FROM public.contractor_invites  WHERE invited_by   = p_user),
    (SELECT count(*)::int FROM public.projects            WHERE user_id      = p_user),
    (SELECT count(*)::int FROM public.payments
      WHERE beneficiary_id = p_user AND direction = 'out'
        AND state IN ('release_authorised', 'initiated', 'reconciling'))
  WHERE public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.admin_contractor_delete_impact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_contractor_delete_impact(uuid) TO authenticated;

-- ── Clear everything pointing at them ────────────────────
--
-- Runs immediately before the Admin API removes the auth row. Separate from that call
-- because `postgres` owns these tables and `supabase_auth_admin` owns `auth.users` —
-- neither can do the other's half, which is the lesson 113 learned the hard way.
CREATE OR REPLACE FUNCTION public.admin_purge_contractor(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_n     integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator deletes an account';
  END IF;
  IF p_user IS NULL   THEN RAISE EXCEPTION 'no_user: nobody named'; END IF;
  IF p_user = v_actor THEN RAISE EXCEPTION 'self_removal: you cannot delete your own account'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = 'admin') THEN
    RAISE EXCEPTION 'is_admin_account: that is a staff account; it is not deleted from here';
  END IF;

  SELECT count(*) INTO v_n FROM public.payments
   WHERE beneficiary_id = p_user AND direction = 'out'
     AND state IN ('release_authorised', 'initiated', 'reconciling');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'money_in_flight: % release(s) are on their way to this contractor; settle or fail them first', v_n;
  END IF;

  -- Detach what can survive without a name.
  UPDATE public.project_audit_log  SET actor_id    = NULL WHERE actor_id    = p_user;
  UPDATE public.project_substages  SET approved_by = NULL WHERE approved_by = p_user;
  UPDATE public.projects           SET created_by  = NULL WHERE created_by  = p_user;

  -- Erase what cannot. Each of these columns is NOT NULL, so there is no middle ground:
  -- the row goes or the delete fails.
  DELETE FROM public.site_updates        WHERE submitted_by = p_user;
  DELETE FROM public.stage_verifications WHERE verifier_id  = p_user;
  DELETE FROM public.project_documents   WHERE uploaded_by  = p_user;
  DELETE FROM public.project_takeoffs    WHERE created_by   = p_user;
  DELETE FROM public.project_messages    WHERE sender_id    = p_user;
  DELETE FROM public.contractor_invites  WHERE invited_by   = p_user
                                            OR contractor_user_id = p_user;

  -- Recorded here, while there is still something to describe. The audit row survives the
  -- delete: its own actor_id is the ADMIN, not the person going.
  PERFORM public.log_activity(NULL, 'contractor.deleted', NULL, NULL, NULL,
    jsonb_build_object('deleted_user', p_user,
                       'email', (SELECT email FROM public.profiles WHERE id = p_user),
                       'by', 'admin'));
END $$;

REVOKE ALL ON FUNCTION public.admin_purge_contractor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_contractor(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_purge_contractor(uuid) IS
  'Clears every reference to a contractor so the Admin API can delete the auth row '
  '(115). Irreversible, and it reaches other people''s projects: site updates, '
  'verifications, documents, take-offs and messages they made are erased. Refuses only '
  'for staff, yourself, and money already on its way to them.';

COMMIT;
