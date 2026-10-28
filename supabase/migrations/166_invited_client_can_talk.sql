-- Let the client a contractor invited speak in the project thread.
--
-- WHY THIS EXISTS NOW
--
-- A contractor can set up a build themselves, and then they own it: the project row's
-- `user_id` is the contractor, because the client often is not reachable and the
-- contractor is running the job from beginning to end. The client is still the person
-- the house is for, so the contractor invites them to it — `invite_project_viewer`
-- (112), which already permits exactly this, since its one rule is "only the owner may
-- share" and here the owner IS the contractor.
--
-- Philip, 29 October: the client "can drop comments, observe, chat, communicate,
-- upload documents... just there to see what's going on and observe the progress".
--
-- Of that list, only talking was missing. An accepted viewer already reads everything
-- through `project_member()` (112), and already uploads documents, because 131 wrote
-- its INSERT policy against that same function. Messaging is the one surface gated on
-- `project_messaging_member()`, which 122 wrote with three arms and no viewer.
--
-- WHAT THIS DOES NOT DO
--
-- 112 is emphatic that a viewer is read-only and that widening `project_member()` with
-- a write would be a mistake — "and it would be a mistake for contractors and
-- verifiers too". That warning is respected: `project_member()` is untouched. The arm
-- is added to `project_messaging_member()` alone, which gates one thing — the project
-- thread. A viewer still cannot approve a stage, release money, change a budget, or
-- invite anybody.
--
-- A client asking their contractor how the roof is going is the whole point of showing
-- them the build. Letting them watch and not reply would be a worse product than not
-- showing them at all.
--
-- The viewer arm is the same four conditions 112 uses: accepted, not revoked, matched
-- on the signed-in user.

BEGIN;

CREATE OR REPLACE FUNCTION public.project_messaging_member(p_project uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = p_project AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.contractor_invites ci
                WHERE ci.project_id = p_project
                  AND ci.contractor_user_id = auth.uid()
                  AND ci.status = 'accepted')
    OR EXISTS (SELECT 1 FROM public.project_verifiers pv
                WHERE pv.project_id = p_project
                  AND pv.user_id = auth.uid()
                  AND pv.status = 'active')
    -- 166: a client the owner invited to watch their build. Reading the thread and
    -- answering in it, and nothing else — every other write on this project is gated
    -- somewhere other than here.
    OR EXISTS (SELECT 1 FROM public.project_viewers v
                WHERE v.project_id = p_project
                  AND v.user_id = auth.uid()
                  AND v.accepted_at IS NOT NULL
                  AND v.revoked_at IS NULL);
$$;

REVOKE ALL ON FUNCTION public.project_messaging_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_messaging_member(uuid) TO authenticated;

COMMENT ON FUNCTION public.project_messaging_member(uuid) IS
  'Who may read and post in a project thread: the owner, an accepted contractor, an '
  'active verifier, and (166) a viewer the owner invited. Distinct from project_member() '
  'on purpose — that one gates reads across the whole project and must not gain writes.';

COMMIT;
