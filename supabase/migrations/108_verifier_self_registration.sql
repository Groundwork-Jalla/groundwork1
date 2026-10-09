-- =========================================================
-- 108  A verifier's own way in, matching the contractor's
--
-- WHY
--
-- 105 gave verifiers an invitation: an admin enters the engineer's address, we mail a
-- token, and claiming it grants the role. 106 then gave contractors the other door — a
-- bare /contractor-signup that anyone can open — because a partner is somebody Jalla
-- already knows and there is no application to accept.
--
-- The same is true of verifiers, and more often: most are engineers Jalla has already
-- met. Making them wait for an email before they can create an account is friction with
-- nothing behind it. This gives them the same bare URL the contractor has.
--
-- 105's invitation is NOT removed. It is still the right tool when you want the page to
-- greet somebody by name, or when you are reaching out first rather than being asked.
-- Both doors lead to the same place.
--
-- ── Why this is safe, which 105 was too cautious about ───────────────────────────────
-- 105's header argued the role is "never self-served" because a verifier's signature
-- releases a stage payment. That is true of an ASSIGNED verifier. Holding the bare role
-- grants none of it:
--
--   · Seeing a project needs a `project_verifiers` row. That table has SELECT policies
--     and NOTHING else — no INSERT, UPDATE or DELETE policy for any role — so the only
--     way onto a project is `assign_verifier` (086), which refuses anyone who is not an
--     admin. A self-registered verifier sees an empty /verifiers and nothing more.
--   · Recording a decision needs the assignment first, for the same reason.
--   · There is no client-facing verifier directory to appear in.
--
-- So the act that matters — putting a named verifier on a named project — stays entirely
-- with staff, exactly as it was. What changes is only who may create the account.
--
-- ── What an admin still sees ─────────────────────────────────────────────────────────
-- `listVerifierDirectory` reads `user_roles`, so somebody who signs up this way DOES
-- appear in /admin/verifiers, with their credentials blank. That is the intended
-- behaviour: staff can see who has arrived and decide whether to assign them anything.
--
-- ── The rule that follows ────────────────────────────────────────────────────────────
-- As with 106: never gate a capability on the bare `verifier` role, because this makes
-- that role self-granted. Gate it on the assignment (`project_verifiers.status`), which
-- an admin confers.
--
-- Run in: Supabase Dashboard > SQL Editor (after 107)
-- =========================================================

BEGIN;

-- The twin of 106's `register_contractor_account`, and deliberately the same shape: no
-- argument, a literal role, idempotent, one audit row the first time only.
--
-- SECURITY DEFINER because `user_roles` has no INSERT policy for anybody (001).
CREATE OR REPLACE FUNCTION public.register_verifier_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_new   boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: create an account first';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_actor, 'verifier')
  ON CONFLICT (user_id, role) DO NOTHING;
  -- False when the conflict clause swallowed the insert: a second call is a no-op, not a
  -- second audit row.
  v_new := FOUND;

  IF v_new THEN
    PERFORM public.log_activity(NULL, 'verifier.self_registered', NULL, NULL, v_actor,
      jsonb_build_object('via', 'verifier_signup'));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.register_verifier_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_verifier_account() TO authenticated;

COMMENT ON FUNCTION public.register_verifier_account() IS
  'Grants the caller the verifier role (108). Open to any signed-in user by decision: '
  'the role shows an empty /verifiers and nothing else, because reaching a project needs '
  'an assignment and project_verifiers has no write policy — only assign_verifier (086), '
  'which is admin-only. Never gate a capability on this role; gate it on the assignment.';

COMMIT;
