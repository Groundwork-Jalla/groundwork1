-- =========================================================
-- 077  Mirror project chat into GoHighLevel, and let replies come back
--
-- WHAT THIS JOINS UP
--
-- Two complete systems that did not know about each other:
--
--   · `project_messages` + ProjectChat — realtime chat between an owner and the
--     contractors invited to their project. Platform-only; nothing reached the CRM.
--   · The GHL conversation provider — `ensureConversation` / `addConversationEmail`
--     push our side into a contact's thread, and `conversation-delivery.ts` receives a
--     reply typed into GHL. Built for email; never wired to chat.
--
-- After this, a message sent in Groundwork appears on the owner's GHL thread, and a
-- reply typed in GHL appears in the Groundwork chat. The conversation stays in the
-- product; GHL is where the team works it.
--
-- ── THE ECHO ────────────────────────────────────────────────────────────────────────
--
-- The obvious failure, and the reason `origin` exists. A reply from GHL becomes a
-- `project_messages` row; a `project_messages` row gets mirrored to GHL; that mirror
-- arrives as a new message; and the thread fills forever. Only rows written HERE are
-- mirrored, and `origin` is what says so.
--
-- It is not a column the browser may set. A BEFORE INSERT trigger forces it for anyone
-- with a session, so the only writer that can say 'ghl' is the service role — which is
-- the inbound handler and nothing else.
-- =========================================================

ALTER TABLE public.project_messages
  ADD COLUMN IF NOT EXISTS origin         TEXT NOT NULL DEFAULT 'platform'
                                            CHECK (origin IN ('platform', 'ghl')),
  -- Null means "not mirrored yet, or the mirror failed". A reconcile can find them.
  ADD COLUMN IF NOT EXISTS ghl_message_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_synced_at  TIMESTAMPTZ;

-- A reply typed in GoHighLevel is written by a Jalla staff member who may have no
-- Groundwork account at all, so there is no user id to attribute it to. `sender_name`
-- carries who said it; the chat UI compares `sender_id` only to decide whose side of the
-- bubble it goes on, and a null is correctly "not yours".
ALTER TABLE public.project_messages ALTER COLUMN sender_id DROP NOT NULL;

-- The browser can still never write one: the INSERT policy requires
-- `auth.uid() = sender_id`, which no session satisfies with a null.

-- The backlog a reconcile would drain: ours, never mirrored.
CREATE INDEX IF NOT EXISTS project_messages_unmirrored_idx
  ON public.project_messages (created_at)
  WHERE origin = 'platform' AND ghl_message_id IS NULL;

-- ── Which project a GHL reply belongs to ─────────────────
--
-- A GHL conversation is per CONTACT, not per project, so a homeowner with three projects
-- has one thread for all three and a reply carries no project with it.
--
-- The rule: a reply lands in the project whose message was last mirrored to that thread —
-- you are answering the thing you were just shown. Recorded here each time we mirror.
-- It is a heuristic and it is the honest limit of a per-contact thread; a genuine
-- per-project thread needs the `conversations` generalisation, not this column.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ghl_thread_project_id UUID
    REFERENCES public.projects(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.ghl_thread_project_id IS
  'The project most recently mirrored to this contact''s GHL conversation. A reply typed '
  'in GHL is filed against it, because a per-contact thread carries no project of its own.';

-- ── The browser does not get to say where a message came from ──
CREATE OR REPLACE FUNCTION public.pin_project_message_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- A real session has an auth.uid(); the service role does not. So this pins the three
  -- CRM columns for every browser writer and leaves the inbound handler free to set them.
  IF auth.uid() IS NOT NULL THEN
    NEW.origin         := 'platform';
    NEW.ghl_message_id := NULL;
    NEW.ghl_synced_at  := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pin_project_message_origin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pin_project_message_origin ON public.project_messages;
CREATE TRIGGER trg_pin_project_message_origin
  BEFORE INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.pin_project_message_origin();
