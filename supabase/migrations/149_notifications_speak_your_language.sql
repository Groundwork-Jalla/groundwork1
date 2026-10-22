-- =========================================================
-- 149 — A notification is read in the reader's language
--
-- `notifications.title` and `body` are plain TEXT, written in English by whichever
-- writer fired. The bell renders them verbatim, so a francophone client on an
-- otherwise French screen reads "Your budget is confirmed".
--
-- This is the same problem migration 024 solved for stage names, and it gets the same
-- shape: a stable KEY into the dictionary beside the stored English, with the English
-- kept as the fallback. A row whose key is NULL still renders its stored text — never
-- a blank bell, never a raw key.
--
-- ── Only three types reach a person ─────────────────────────────────────────────────
-- Of the sixteen writers, fourteen are notifyAdmins: staff-facing, and English there is
-- correct — it matches the row an admin will open. What reaches a client or contractor
-- is message_received, budget_confirmed, and the tracking notice.
--
-- ── Why a trigger rather than editing every writer ──────────────────────────────────
-- The two message notifications are written from inside `notify_client_of_message`
-- (123), a two-hundred-line trigger function. Recreating all of it here to change two
-- INSERT statements would copy far more than it changed, and every line copied is a
-- line that can drift from 123.
--
-- So the keys are filled by a BEFORE INSERT trigger that runs only when the writer did
-- not set them. App code that knows its own key passes it and the trigger leaves it
-- alone; SQL writers that know nothing about this file are covered anyway; and a writer
-- added later gets the behaviour for free rather than silently shipping English.
--
-- ── The body is not always ours to translate ────────────────────────────────────────
-- A message notification's body is an excerpt of what somebody actually typed. That is
-- user content: it gets no body_key and is never passed through the dictionary.
--
-- Run in: Supabase Dashboard > SQL Editor (after 148)
-- =========================================================

BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS title_key TEXT,
  ADD COLUMN IF NOT EXISTS body_key  TEXT,
  ADD COLUMN IF NOT EXISTS params    JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.notifications.title_key IS
  'Dictionary key for the title (149). NULL falls back to the stored English title.';
COMMENT ON COLUMN public.notifications.body_key IS
  'Dictionary key for the body (149). NULL falls back to the stored body — which is '
  'correct for a message excerpt, where the body is user content, not our copy.';
COMMENT ON COLUMN public.notifications.params IS
  'Interpolation values for those keys: the project name, the sender, the stage number.';


-- ── The mapping, in one place ────────────────────────────
--
-- Deliberately a closed set of the titles this product actually writes. Anything it
-- does not recognise returns NULLs, and that row keeps rendering its English — the
-- failure mode is "no worse than today", never a raw key on screen.
CREATE OR REPLACE FUNCTION public.notification_keys(
  p_type text, p_title text, p_body text,
  OUT title_key text, OUT body_key text, OUT params jsonb
) LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  title_key := NULL; body_key := NULL; params := '{}'::jsonb;

  IF p_type = 'message_received' THEN
    IF p_title = 'New message from Groundwork' THEN
      title_key := 'notifications.item.newMessageFromGroundwork';
    ELSIF p_title LIKE 'New message about %' THEN
      title_key := 'notifications.item.newMessageAbout';
      params := jsonb_build_object('project', substring(p_title from 19));
    ELSIF p_title = 'New message' THEN
      title_key := 'notifications.item.newMessage';
      -- "<name> sent a message" — the only part that is ours to translate is the frame.
      IF p_body LIKE '% sent a message' THEN
        body_key := 'notifications.item.newMessageBody';
        params := jsonb_build_object('name', left(p_body, length(p_body) - 15));
      END IF;
    END IF;

  -- Title only, deliberately. These bodies interpolate a stage number and a project
  -- name that cannot be recovered from the English sentence, so the body keeps its
  -- stored text rather than rendering a half-filled one. App code passes both keys
  -- and the values with them; this is only the net under a writer that forgets.
  ELSIF p_type = 'stage_approved' AND p_title = 'Stage approved' THEN
    title_key := 'notifications.item.stageApproved';

  ELSIF p_type = 'stage_rework_requested' AND p_title = 'Changes requested' THEN
    title_key := 'notifications.item.stageRework';

  ELSIF p_type = 'budget_confirmed' THEN
    IF p_title = 'Your budget is confirmed' THEN
      title_key := 'notifications.item.budgetConfirmed';
    ELSIF p_title = 'Your project is now being tracked' THEN
      title_key := 'notifications.item.trackingStarted';
    END IF;
  END IF;
END $$;

COMMENT ON FUNCTION public.notification_keys(text, text, text) IS
  'Maps a written notification back to its dictionary keys (149). Used by the BEFORE '
  'INSERT trigger and by the backfill, so both cannot disagree.';


-- ── Fill the keys the writer did not ─────────────────────
CREATE OR REPLACE FUNCTION public.stamp_notification_keys()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k record;
BEGIN
  -- A writer that set its own key knows better than this mapping; leave it alone.
  IF NEW.title_key IS NOT NULL THEN RETURN NEW; END IF;

  SELECT * INTO k FROM public.notification_keys(NEW.type, NEW.title, NEW.body);
  NEW.title_key := k.title_key;
  IF NEW.body_key IS NULL THEN NEW.body_key := k.body_key; END IF;
  IF NEW.params = '{}'::jsonb THEN NEW.params := k.params; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamp_notification_keys ON public.notifications;
CREATE TRIGGER stamp_notification_keys
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.stamp_notification_keys();


-- ── Everything already in the bell ───────────────────────
-- The mapping is joined in a plain SELECT first: an UPDATE ... FROM cannot
-- lateral-reference its own target, so the match is made here and applied by id.
WITH mapped AS (
  SELECT n.id, k.title_key, k.body_key, k.params
    FROM public.notifications n,
         LATERAL public.notification_keys(n.type, n.title, n.body) k
   WHERE n.title_key IS NULL
     AND k.title_key IS NOT NULL
)
UPDATE public.notifications n
   SET title_key = m.title_key,
       body_key  = COALESCE(n.body_key, m.body_key),
       params    = CASE WHEN n.params = '{}'::jsonb THEN m.params ELSE n.params END
  FROM mapped m
 WHERE m.id = n.id;


-- ── Let app code be explicit ─────────────────────────────
--
-- Dropped first, not replaced: adding parameters changes the signature, so CREATE OR
-- REPLACE would leave the six-argument version in place beside this one. PostgREST
-- resolves by argument name, and a six-named-argument call would then match both — an
-- ambiguity that surfaces as a runtime failure, not a migration error.
DROP FUNCTION IF EXISTS public.notify_project_members(uuid, uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.notify_project_members(
  p_project_id uuid,
  p_sender_id  uuid,
  p_type       text,
  p_title      text,
  p_body       text,
  p_data       jsonb DEFAULT '{}',
  p_title_key  text  DEFAULT NULL,
  p_body_key   text  DEFAULT NULL,
  p_params     jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The project owner, unless they are the one who wrote it.
  INSERT INTO public.notifications (user_id, type, title, body, data, title_key, body_key, params)
  SELECT user_id, p_type, p_title, p_body, p_data, p_title_key, p_body_key, p_params
  FROM   public.projects
  WHERE  id = p_project_id
    AND  user_id != p_sender_id;

  -- Accepted contractors on the project, likewise.
  INSERT INTO public.notifications (user_id, type, title, body, data, title_key, body_key, params)
  SELECT cc.contractor_id, p_type, p_title, p_body, p_data, p_title_key, p_body_key, p_params
  FROM   public.contractor_clients cc
  JOIN   public.projects p ON p.user_id = cc.client_id
  WHERE  p.id = p_project_id
    AND  cc.accepted_at IS NOT NULL
    AND  cc.contractor_id != p_sender_id;
END $$;

REVOKE ALL ON FUNCTION public.notify_project_members(uuid, uuid, text, text, text, jsonb, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_project_members(uuid, uuid, text, text, text, jsonb, text, text, jsonb) TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Everything a person can actually read now carries a key:
--     SELECT type, title, title_key, params FROM public.notifications
--      WHERE type IN ('message_received','budget_confirmed') ORDER BY created_at DESC;
--   And a new one gets its key without the writer knowing:
--     INSERT INTO public.notifications (user_id, type, title, body)
--     VALUES ('<uuid>', 'budget_confirmed', 'Your budget is confirmed', 'x');
--     → title_key = notifications.item.budgetConfirmed
