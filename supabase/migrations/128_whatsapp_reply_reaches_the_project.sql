-- =========================================================
-- 128  A WhatsApp reply reaches the project it is about
--
-- WHY
--
-- 126 made the WhatsApp route one-way. A project message now reaches the client's phone,
-- but a reply typed in WhatsApp comes back through the GHL webhook and is filed with a
-- `conversation_id` and NO `project_id` — because a WhatsApp conversation belongs to the
-- PERSON, not the build (091). So the reply landed in the admin Inbox and the contractor
-- who wrote the original never saw it.
--
-- That is a broadcast, not a chat. The client could read on their phone and not answer
-- there, which is the half of "talk to your contractor on WhatsApp" that was missing.
--
-- ── Exactly one project, or nobody guesses ──────────────────────────────────────────
-- A reply says "the slab is fine" and nothing about which build. Where the person has one
-- live project that is not ambiguous; where they have two it is, and filing it on the
-- wrong one puts a decision about one building into another building's record. So this
-- answers NULL for 0 or 2+, and those replies keep going to the Inbox exactly as they do
-- today, for a human to place.
--
-- `completed` and `archived` projects are excluded: a reply is about work in progress, and
-- counting a finished build would make a one-project client look ambiguous.
--
-- ── Why the mirror row is `whatsapp` and not `jalla` ────────────────────────────────
-- It says where the message came from, which the reader should see. It also closes the
-- loop by construction: 126's trigger fires only on `jalla`, so a mirrored reply is never
-- fanned back out to anybody's phone. The contractor still hears about it — 123 notifies
-- every participant of a project-linked message on any channel, in either direction.
--
-- Run in: Supabase Dashboard > SQL Editor (after 127)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.project_for_whatsapp_reply(p_person uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mine AS (
    -- Every live project this person has standing on, by the same three routes
    -- `project_participants` uses — so "who may read a thread" and "where a reply goes"
    -- cannot disagree about who belongs to a build.
    SELECT p.id
      FROM public.projects p
     WHERE p.user_id = p_person
       AND p.status NOT IN ('completed', 'archived')
    UNION
    SELECT p.id
      FROM public.projects p
      JOIN public.contractor_invites ci ON ci.project_id = p.id
     WHERE ci.contractor_user_id = p_person
       AND ci.status = 'accepted'
       AND p.status NOT IN ('completed', 'archived')
    UNION
    SELECT p.id
      FROM public.projects p
      JOIN public.project_verifiers pv ON pv.project_id = p.id
     WHERE pv.user_id = p_person
       AND pv.status = 'active'
       AND p.status NOT IN ('completed', 'archived')
  )
  -- One, or nothing. `LIMIT 1` would pick a building at random, which is the failure this
  -- function exists to avoid.
  SELECT id FROM mine
   WHERE (SELECT count(*) FROM mine) = 1;
$$;

REVOKE ALL ON FUNCTION public.project_for_whatsapp_reply(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_for_whatsapp_reply(uuid) IS
  'The single live project a person''s WhatsApp reply belongs to, or NULL when it cannot '
  'be known (128). NULL for none and for several: a reply carries no project, and filing '
  'it on the wrong build puts one building''s decision into another''s record. Service '
  'role only — the inbound webhook is its one caller.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- a client with one live build gets its id; with two, NULL
--   SELECT public.project_for_whatsapp_reply('<user uuid>');
--
--   -- how many people are unambiguous right now
--   SELECT count(*) FILTER (WHERE public.project_for_whatsapp_reply(id) IS NOT NULL) AS routable,
--          count(*) AS people
--     FROM public.profiles;
--
--   -- replies that made it onto a project thread
--   SELECT project_id, sender_name, channel, direction, left(content, 60)
--     FROM public.project_messages
--    WHERE channel = 'whatsapp' AND project_id IS NOT NULL
--    ORDER BY created_at DESC LIMIT 10;
