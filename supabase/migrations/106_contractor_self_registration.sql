-- =========================================================
-- 106  A partner contractor's own way in
--
-- WHY
--
-- Two kinds of contractor reach Groundwork, and 100 only built a door for one of them.
--
--   · An APPLICANT fills in /contractor-apply, is interviewed, and an admin accepts the
--     application. Acceptance publishes their directory listing and mails a claim token.
--     That is 100, and it still works exactly as before.
--
--   · A PARTNER is someone Jalla already knows and has interviewed — they bring their own
--     clients onto the platform. There is no application to accept, so there was no token
--     to mail, so there was no way for them to sign themselves up at all. The only option
--     was an admin typing their account in and choosing their password for them.
--
-- This gives the partner a bare URL — /contractor-signup, with nothing in the query — and
-- a function that grants the contractor role to whoever is signed in.
--
-- ── This is deliberately an open capability ──────────────────────────────────────────
-- Anyone who can sign in can call this and hold the contractor role. That is the decision
-- it implements, taken with the following in hand:
--
--   · The role grants access to NO project. Project access is
--     `contractor_invites.status = 'accepted'`, checked by `is_contractor_on()` (086).
--     A self-registered contractor who has not been invited to anything sees an empty
--     /work, which is the truth.
--   · The role does NOT put them in the client-facing directory. `public.contractors` is
--     admin-write-only (033 `admins_write_contractors`), and a listing is published by
--     `admin_promote_application`. Clients therefore still browse only vetted contractors.
--   · The role does NOT let them create a project for a client. That is
--     /admin/projects/new, behind is_admin().
--   · What it does open: /work, and the ability to record where they are paid (099). A
--     payout destination is their own, and a staff check still gates every release (101).
--
-- 100 warned that "contractors are about to be able to bring their own clients, and a
-- self-granted role must never reach that". That capability still does not exist — a
-- partner's client is onboarded by an admin creating the project. WHEN IT IS BUILT, it
-- must NOT be gated on the bare contractor role, because this migration makes that role
-- self-granted. Gate it on something an admin confers: the directory listing
-- (`contractors.user_id`), or a flag added for the purpose.
--
-- ── What this does NOT do ────────────────────────────────────────────────────────────
-- No application row, no directory listing, no project. It grants one role and records
-- that it did.
--
-- Run in: Supabase Dashboard > SQL Editor (after 105)
-- =========================================================

BEGIN;

-- ── The self-registration ────────────────────────────────
--
-- SECURITY DEFINER because `user_roles` has no INSERT policy for anybody: 001 grants the
-- owner SELECT on their own rows and nothing more. So the role cannot be inserted from a
-- browser directly, and every path that grants one is a function like this one that can be
-- read and audited.
--
-- The role is a LITERAL. It takes no argument and never will: a `p_role text` here would
-- be a way to ask for 'admin', and no amount of checking inside would make that a
-- sensible shape for a function any signed-in user may call.
CREATE OR REPLACE FUNCTION public.register_contractor_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_new   boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: create an account first';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_actor, 'contractor')
  ON CONFLICT (user_id, role) DO NOTHING;
  -- FOUND is false when the conflict clause swallowed the insert, which is how a second
  -- call becomes a no-op rather than a second audit row.
  v_new := FOUND;

  IF v_new THEN
    -- person = the new contractor, and log_activity fills actor_id from auth.uid() itself.
    -- No entity: 089 refuses an entity_type without an entity_id, and there is no row to
    -- point at — the role itself is the whole event.
    PERFORM public.log_activity(NULL, 'contractor.self_registered', NULL, NULL, v_actor,
      jsonb_build_object('via', 'contractor_signup'));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.register_contractor_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_contractor_account() TO authenticated;

COMMENT ON FUNCTION public.register_contractor_account() IS
  'Grants the caller the contractor role (106). Open to any signed-in user by decision: '
  'the role opens /work and payout details, never a project (086) and never the '
  'client-facing directory (033, admin-write-only). Do not gate a partner''s ability to '
  'bring their own clients on this role — gate it on something an admin confers.';

COMMIT;
