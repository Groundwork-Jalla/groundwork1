-- An invited client can reply, but cannot say the first thing.
--
-- WHAT IS WRONG
--
-- 166 let an invited client into the project thread by adding the viewer arm to
-- `project_messaging_member()`, which gates reading conversations and posting
-- messages. It did not touch `ensure_project_conversation` (091), whose membership
-- test is still its own hand-written list:
--
--     is_admin() OR owns the project OR is_contractor_on(...)
--
-- A viewer is in none of those. So on a project whose thread does not exist yet, an
-- invited client pressing Send gets `not_member: not a member of this project` and the
-- message is lost. On a project where somebody else has already spoken they can reply
-- perfectly well — which is the worst shape for a bug, because it works in testing
-- wherever a contractor messaged first.
--
-- Favour, 2 Nov 2026, on what an invited client must be able to do: "They can be able
-- to initiate conversations, engage in conversations, ask questions in messaging."
-- Initiate is the half that was missing.
--
-- THE FIX
--
-- Use `project_messaging_member()` — the one function that already answers "who may
-- talk on this project", and the one 166 corrected. Starting a thread and posting in
-- it are the same permission, so they should not be two lists that can disagree. They
-- just did.
--
-- WHAT THIS DOES NOT GRANT
--
-- Nothing else. `project_member()` stays read-only, exactly as 112 insists. A viewer
-- still cannot approve a stage, move money, change a figure or invite anybody: each of
-- those is gated somewhere other than here. The only thing added is the ability to be
-- the first person to speak on a build they were invited to watch.
--
-- Run in: Supabase Dashboard > SQL Editor (after 166)

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_project_conversation(p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- One definition of who may talk here, shared with the read and send policies (122,
  -- 166). The hand-written list this replaces omitted the invited client.
  IF NOT (public.is_admin() OR public.project_messaging_member(p_project)) THEN
    RAISE EXCEPTION 'not_member: not a member of this project';
  END IF;
  RETURN public.project_conversation(p_project);
END $$;

REVOKE ALL ON FUNCTION public.ensure_project_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_project_conversation(uuid) TO authenticated;

COMMENT ON FUNCTION public.ensure_project_conversation(uuid) IS
  'Open (or find) a project thread. Admitted: staff, and anyone '
  'project_messaging_member() admits — owner, accepted contractor, active verifier, '
  'and (166) an invited client. Starting a thread and posting in it are one permission.';

COMMIT;
