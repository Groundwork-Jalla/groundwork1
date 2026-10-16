-- =========================================================
-- 125  A message link opens the message
--
-- WHY
--
-- 123's `message_link_for` sent a contractor to `/work/projects/<id>` and a verifier
-- to `/verifiers/projects/<id>` — the project, with no tab named. The client's link
-- did carry `?tab=messages`, so the three were already inconsistent.
--
-- Reported from testing, and it is the same complaint either way: somebody is told
-- they have a message, presses the button that says "Read it in Groundwork", and
-- arrives at a project overview that does not show it. They then have to find the
-- Messages tab themselves, which is the one thing the email existed to save them.
--
-- ── The other half of this fix is not in SQL ────────────────────────────────────────
-- Both project pages held the open tab in component state and never read `?tab=` at
-- all, so even the client's correct link landed on the overview. Naming the tab here
-- only works because those pages now read it.
--
-- Run in: Supabase Dashboard > SQL Editor (after 124)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.message_link_for(p_role text, p_project uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_role
           WHEN 'contractor' THEN
             'https://www.tryjalla.com/work/projects/' || p_project::text || '?tab=messages'
           WHEN 'verifier'   THEN
             'https://www.tryjalla.com/verifiers/projects/' || p_project::text || '?tab=messages'
           ELSE
             'https://www.tryjalla.com/projects/' || p_project::text || '?tab=messages'
         END;
$$;

COMMENT ON FUNCTION public.message_link_for(text, uuid) IS
  'Where a given role reads a message (125). Every one names the messages tab: a link '
  'that lands on the project overview makes the reader hunt for the thing they were '
  'just told about. The project pages read `?tab=` for this to mean anything.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT public.message_link_for('contractor', gen_random_uuid());
--     → /work/projects/<id>?tab=messages
--   SELECT public.message_link_for('owner', gen_random_uuid());
--     → /projects/<id>?tab=messages
