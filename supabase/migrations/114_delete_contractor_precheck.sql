-- =========================================================
-- 114  Deleting a contractor account, through the one door that can
--
-- WHY — 113's DELETE COULD NEVER HAVE WORKED
--
-- `admin_delete_contractor` (113) ended with `DELETE FROM auth.users`. In Supabase the
-- `auth` schema belongs to `supabase_auth_admin`, not to `postgres` — so a SECURITY
-- DEFINER function owned by postgres has no DELETE privilege there. Every call raised
-- `insufficient_privilege`, which 113's handler did not catch (it only caught
-- `foreign_key_violation`), and the browser showed a generic "Not removed".
--
-- Deleting an auth user is done through the Admin API with the service role, which is
-- what `admin-provision-user.ts` has always used to roll back a half-made account. So the
-- delete moves to the server, and what stays here is the part that belongs in SQL: the
-- decision about whether this person MAY be deleted.
--
-- ── Why the checks stay in the database ──────────────────────────────────────────────
-- They are about data the server would otherwise have to re-derive — money in flight,
-- staff standing, and work on other people's projects. Keeping them here means one
-- answer, reviewable, and the handler cannot forget one.
--
-- Run in: Supabase Dashboard > SQL Editor (after 113)
-- =========================================================

BEGIN;

-- The old one cannot work. Removing it rather than leaving a function that always fails.
DROP FUNCTION IF EXISTS public.admin_delete_contractor(uuid, text);

-- ── May this account be deleted? ─────────────────────────
--
-- NULL means yes. Anything else is the reason, and the app turns it into a sentence.
--
-- The history check is the interesting one. These six columns reference `auth.users` with
-- no cascade, by design: they are the record of who did what on somebody else's build.
-- Deleting the account would either fail on the foreign key or, if somebody ever
-- "fixed" that by detaching them, quietly rewrite who did the work. So this refuses
-- first, and says so.
CREATE OR REPLACE FUNCTION public.admin_can_delete_contractor(p_user uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_n     integer;
BEGIN
  IF NOT public.is_admin()    THEN RETURN 'not_admin'; END IF;
  IF p_user IS NULL           THEN RETURN 'no_user'; END IF;
  IF p_user = v_actor         THEN RETURN 'self_removal'; END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = 'admin') THEN
    RETURN 'is_admin_account';
  END IF;

  SELECT count(*) INTO v_n FROM public.payments
   WHERE beneficiary_id = p_user AND direction = 'out'
     AND state IN ('release_authorised', 'initiated', 'reconciling');
  IF v_n > 0 THEN RETURN 'money_in_flight'; END IF;

  -- Work on somebody else's build. Each of these is a NOT NULL or no-cascade reference.
  SELECT
    (SELECT count(*) FROM public.site_updates       WHERE submitted_by = p_user)
  + (SELECT count(*) FROM public.stage_verifications WHERE verifier_id  = p_user)
  + (SELECT count(*) FROM public.project_documents  WHERE uploaded_by  = p_user)
  + (SELECT count(*) FROM public.project_takeoffs   WHERE created_by   = p_user)
  + (SELECT count(*) FROM public.contractor_invites WHERE invited_by   = p_user)
  INTO v_n;
  IF v_n > 0 THEN RETURN 'has_history'; END IF;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.admin_can_delete_contractor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_can_delete_contractor(uuid) TO authenticated;

-- ── Record it ────────────────────────────────────────────
--
-- Called by the server immediately BEFORE the Admin API deletes the row, because
-- afterwards there is no row to describe. `person_id` is left null for the same reason:
-- it would point at an account that no longer exists.
CREATE OR REPLACE FUNCTION public.admin_log_contractor_deleted(p_user uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator deletes an account';
  END IF;
  SELECT email INTO v_email FROM public.profiles WHERE id = p_user;
  PERFORM public.log_activity(NULL, 'contractor.deleted', NULL, NULL, p_user,
    jsonb_strip_nulls(jsonb_build_object(
      'deleted_user', p_user, 'email', v_email,
      'reason', NULLIF(btrim(coalesce(p_reason, '')), ''), 'by', 'admin')));
END $$;

REVOKE ALL ON FUNCTION public.admin_log_contractor_deleted(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_log_contractor_deleted(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_can_delete_contractor(uuid) IS
  'NULL if this account may be deleted, otherwise the reason (114). The delete itself '
  'runs through the Admin API with the service role — postgres has no DELETE on '
  'auth.users, which is why 113''s version always failed.';

COMMIT;
