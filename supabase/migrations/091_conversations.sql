-- =========================================================
-- 091  Conversations, decisions, support links: every contact has a thread
--
-- Phase 4 of the admin re-architecture, migration 7 of 7
-- (docs/groundwork-admin/04-implementation-plan.md §2; Phase 2 §2.3; Phase 3 §3.12,
-- §3.13, §4, §5). Depends on 085 (ghl_message_id unique), 086 (project_member,
-- is_contractor_on), 089 (log_activity).
--
-- WHAT WAS MISSING. `project_messages` is a flat list per project: no thread, no notion
-- of who is waiting on whom, no way to hold a conversation with a person who has no
-- project yet, no place to write a note the client must not see, and a GHL reply is
-- filed by a per-profile heuristic (`ghl_thread_project_id`, 077) rather than by the
-- conversation it belongs to. Decisions taken in those threads live nowhere.
--
-- THE MODEL.
--   conversations     — the thread: a person, optionally a project, a channel, a status
--                       (open ⇄ waiting_on_us ⇄ waiting_on_them → resolved → open), who is
--                       on it, and GHL's identity for it. `ghl_conversation_id` IS the
--                       conversation's identity across the boundary — UNIQUE where set.
--   project_messages  — EXTENDED, not replaced: every row gains a conversation, a
--                       direction, a channel, a delivery status, attachments. project_id
--                       becomes nullable so a pre-project conversation can carry messages.
--   decisions         — what was decided, where, by whom, with what cost/schedule impact.
--   support_tickets   — gain project_id / conversation_id links.
--
-- DIRECTION, FROM GROUNDWORK'S SIDE. inbound = written by the person we serve (owner,
-- contractor); outbound = written by staff (in the app, or in GHL and delivered by the
-- crm-delivery webhook); internal = a staff note, never mirrored, never shown to a
-- non-staff reader. The plan's backfill line reads "origin = 'ghl' → inbound"; the handler
-- shows the opposite: the delivery webhook carries messages STAFF write in GHL to the
-- client (filed as sender "Jalla", then emailed to the client). So direction is derived
-- from the author: origin ghl → outbound; author is an admin → outbound; else inbound.
--
-- IDEMPOTENCY. Inbound messages: 085's UNIQUE on ghl_message_id, unchanged. Inbound
-- conversations: ensure_inbound_conversation() resolves by ghl_conversation_id, then
-- ghl_contact_id, then the person's newest open thread, and creates one only when none
-- exists — under an advisory lock keyed on the identity, with ON CONFLICT on the unique
-- index as the last word. Two concurrent first-contact deliveries produce one thread.
--
-- BACKFILL, DERIVABLE AND IDEMPOTENT. One `jalla` conversation per project that has
-- messages (person = owner, last_message_at = newest message); every message joined to
-- it; direction from its author. conversation_id then becomes NOT NULL, and a BEFORE
-- INSERT trigger fills it from project_id for any writer that predates 091 (the deployed
-- app inserts by project until its own deploy lands). Dropping the table and the columns
-- restores today exactly: project_id stays populated on every backfilled row.
--
-- WRITES. Staff acts — assign, link, resolve, record a decision, link a ticket — are
-- SECURITY DEFINER RPCs that re-check is_admin() and audit through 089's log_activity.
-- Sending a message: send_message() for the app; the existing owner/contractor INSERT
-- policies survive for the not-yet-redeployed client, tightened so a non-staff row can
-- never be `internal`. Reading: existing readers keep their project arm, gain the
-- person arm, and lose `internal` unless admin. Nothing here creates a second activity
-- table; message rows are their own record, and the audit log carries only internal
-- notes, links, assignments, resolutions and decisions.
--
-- THRESHOLDS live in app_config (058: RLS on, no policies, read by definer functions
-- only): unanswered_conversation_hours = 4, unanswered_bands medium 4h · high 8h ·
-- critical 24h. unanswered_conversations() is the one reader; no screen carries a number.
--
-- Run in: Supabase Dashboard > SQL Editor (after 090)
-- =========================================================

-- ── 1. conversations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who the thread is with. No FK (089's rule): the thread outlives the account.
  person_id           uuid,
  project_id          uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  channel             text NOT NULL DEFAULT 'jalla' CHECK (channel IN ('jalla', 'whatsapp', 'email', 'call')),
  subject             text,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting_on_us', 'waiting_on_them', 'resolved')),
  -- Staff member on it. No FK, same rule.
  assigned_to         uuid,
  ghl_conversation_id text,
  ghl_contact_id      text,
  last_message_at     timestamptz,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_has_subject CHECK (person_id IS NOT NULL OR project_id IS NOT NULL),
  CONSTRAINT conversations_resolved_iff CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_ghl_conversation_id_key
  ON public.conversations (ghl_conversation_id) WHERE ghl_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_project_idx ON public.conversations (project_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_person_idx  ON public.conversations (person_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_status_idx  ON public.conversations (status, last_message_at);
CREATE INDEX IF NOT EXISTS conversations_ghl_contact_idx ON public.conversations (ghl_contact_id) WHERE ghl_contact_id IS NOT NULL;

-- ── 2. project_messages, extended ────────────────────────
ALTER TABLE public.project_messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS direction       text CHECK (direction IN ('inbound', 'outbound', 'internal')),
  ADD COLUMN IF NOT EXISTS channel         text NOT NULL DEFAULT 'jalla' CHECK (channel IN ('jalla', 'whatsapp', 'email', 'call')),
  ADD COLUMN IF NOT EXISTS status          text CHECK (status IN ('sent', 'delivered', 'failed')),
  ADD COLUMN IF NOT EXISTS attachments     jsonb;
ALTER TABLE public.project_messages ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.project_messages DROP CONSTRAINT IF EXISTS project_messages_attachments_is_array;
ALTER TABLE public.project_messages ADD CONSTRAINT project_messages_attachments_is_array
  CHECK (attachments IS NULL OR jsonb_typeof(attachments) = 'array');
CREATE INDEX IF NOT EXISTS project_messages_conversation_idx ON public.project_messages (conversation_id, created_at);

-- ── 3. Backfill ──────────────────────────────────────────
-- (a) One jalla conversation per project that has messages.
INSERT INTO public.conversations (person_id, project_id, channel, status, last_message_at, created_at)
SELECT p.user_id, m.project_id, 'jalla', 'open', max(m.created_at), min(m.created_at)
  FROM public.project_messages m
  JOIN public.projects p ON p.id = m.project_id
 WHERE m.project_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.project_id = m.project_id)
 GROUP BY p.user_id, m.project_id;

-- (b) Every message joins its project's (earliest) conversation.
UPDATE public.project_messages m
   SET conversation_id = c.id
  FROM (SELECT DISTINCT ON (project_id) id, project_id FROM public.conversations
         WHERE project_id IS NOT NULL ORDER BY project_id, created_at) c
 WHERE m.conversation_id IS NULL AND m.project_id = c.project_id;

-- (c) Direction from the author (see header).
UPDATE public.project_messages m
   SET direction = CASE
         WHEN m.origin = 'ghl' THEN 'outbound'
         WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = m.sender_id AND r.role = 'admin') THEN 'outbound'
         ELSE 'inbound'
       END
 WHERE m.direction IS NULL;
UPDATE public.project_messages SET status = 'sent' WHERE status IS NULL;

-- (d) Now every row has a thread and a direction.
ALTER TABLE public.project_messages ALTER COLUMN conversation_id SET NOT NULL;
ALTER TABLE public.project_messages ALTER COLUMN direction SET NOT NULL;
ALTER TABLE public.project_messages ALTER COLUMN status SET DEFAULT 'sent';

-- ── 4. Message triggers ──────────────────────────────────

-- A project's jalla thread, created if it has none. Definer: the caller may not be able
-- to see conversations yet (RLS), and the row must exist for the message to land.
CREATE OR REPLACE FUNCTION public.project_conversation(p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.conversations
   WHERE project_id = p_project AND channel = 'jalla'
   ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('conversation:project:' || p_project::text));
  SELECT id INTO v_id FROM public.conversations
   WHERE project_id = p_project AND channel = 'jalla'
   ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.conversations (person_id, project_id, channel)
  SELECT user_id, id, 'jalla' FROM public.projects WHERE id = p_project
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'not_found: no such project'; END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.project_conversation(uuid) FROM PUBLIC, anon, authenticated;

-- Before a message lands: thread and project agree, direction is set from the author
-- when the writer did not say (the pre-091 client), and a non-staff author is never
-- `internal`. Runs after 077's origin pin.
CREATE OR REPLACE FUNCTION public.messages_default_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv   public.conversations%ROWTYPE;
  v_owner  uuid;
  v_actor  uuid := auth.uid();
BEGIN
  IF NEW.conversation_id IS NULL THEN
    IF NEW.project_id IS NULL THEN
      RAISE EXCEPTION 'no_thread: a message belongs to a conversation or a project';
    END IF;
    NEW.conversation_id := public.project_conversation(NEW.project_id);
  END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such conversation'; END IF;
  IF NEW.project_id IS NULL THEN
    NEW.project_id := v_conv.project_id;
  ELSIF v_conv.project_id IS NOT NULL AND v_conv.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'thread_mismatch: that conversation belongs to another project';
  END IF;

  IF NEW.direction IS NULL THEN
    -- origin = 'ghl' is trusted only without a session: 077's pin trigger resets a browser
    -- writer's origin to 'platform', but it runs after this one (name order).
    IF NEW.origin = 'ghl' AND v_actor IS NULL THEN
      NEW.direction := 'outbound';
    ELSIF NEW.sender_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.sender_id AND r.role = 'admin') THEN
      NEW.direction := 'outbound';
    ELSE
      NEW.direction := 'inbound';
    END IF;
  END IF;
  -- A browser session that is not staff cannot write a note. (RLS says so too; this is
  -- the answer that names the reason.)
  IF NEW.direction = 'internal' AND v_actor IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: an internal note is written by staff';
  END IF;
  IF NEW.status IS NULL THEN NEW.status := 'sent'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_default_conversation ON public.project_messages;
CREATE TRIGGER messages_default_conversation BEFORE INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_default_conversation();

-- After a message lands: the thread moves. inbound → waiting_on_us; outbound →
-- waiting_on_them; an internal note moves nothing. A resolved thread reopens.
CREATE OR REPLACE FUNCTION public.messages_advance_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
     SET last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at),
         status = CASE
                    WHEN NEW.direction = 'internal' THEN status
                    WHEN NEW.direction = 'inbound'  THEN 'waiting_on_us'
                    ELSE 'waiting_on_them'
                  END,
         resolved_at = CASE WHEN NEW.direction = 'internal' THEN resolved_at ELSE NULL END,
         updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS messages_advance_conversation ON public.project_messages;
CREATE TRIGGER messages_advance_conversation AFTER INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_advance_conversation();

-- ── 5. decisions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.decisions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  conversation_id       uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id            uuid REFERENCES public.project_messages(id) ON DELETE SET NULL,
  subject               text NOT NULL,
  decision              text NOT NULL,
  related               text NOT NULL DEFAULT 'other' CHECK (related IN ('budget', 'stage', 'design', 'payment', 'other')),
  related_id            uuid,
  -- A reversal is a new decision that names the old one. Rows are never edited.
  supersedes_id         uuid REFERENCES public.decisions(id) ON DELETE SET NULL,
  recorded_by           uuid NOT NULL,
  approved_by           uuid,
  approved_at           timestamptz,
  cost_impact_usd       numeric(14,2),
  schedule_impact_days  integer,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decisions_approved_iff CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT decisions_subject_nonblank CHECK (btrim(subject) <> '' AND btrim(decision) <> '')
);
CREATE INDEX IF NOT EXISTS decisions_project_idx ON public.decisions (project_id, recorded_at DESC);

-- Immutable: only approval may land, once.
CREATE OR REPLACE FUNCTION public.decisions_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF row(NEW.project_id, NEW.subject, NEW.decision, NEW.related, NEW.related_id, NEW.supersedes_id,
         NEW.recorded_by, NEW.cost_impact_usd, NEW.schedule_impact_days, NEW.recorded_at)
     IS DISTINCT FROM
     row(OLD.project_id, OLD.subject, OLD.decision, OLD.related, OLD.related_id, OLD.supersedes_id,
         OLD.recorded_by, OLD.cost_impact_usd, OLD.schedule_impact_days, OLD.recorded_at) THEN
    RAISE EXCEPTION 'immutable: a decision is a record; record a new one that supersedes it';
  END IF;
  -- The FK SET NULL on a deleted conversation/message is the one permitted change to those.
  IF (NEW.conversation_id IS DISTINCT FROM OLD.conversation_id AND NEW.conversation_id IS NOT NULL)
     OR (NEW.message_id IS DISTINCT FROM OLD.message_id AND NEW.message_id IS NOT NULL) THEN
    RAISE EXCEPTION 'immutable: a decision keeps the thread and message it was recorded from';
  END IF;
  IF OLD.approved_by IS NOT NULL AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'immutable: an approval is a record';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS decisions_guard ON public.decisions;
CREATE TRIGGER decisions_guard BEFORE UPDATE ON public.decisions FOR EACH ROW EXECUTE FUNCTION public.decisions_guard();
CREATE OR REPLACE FUNCTION public.decisions_guard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN RAISE EXCEPTION 'immutable: a decision is not deleted'; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS decisions_guard_delete ON public.decisions;
CREATE TRIGGER decisions_guard_delete BEFORE DELETE ON public.decisions FOR EACH ROW EXECUTE FUNCTION public.decisions_guard_delete();

-- ── 6. support_tickets, linked ───────────────────────────
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS project_id      uuid REFERENCES public.projects(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL;

-- ── 7. app_config: the thresholds ────────────────────────
INSERT INTO public.app_config (key, value) VALUES
  ('unanswered_conversation_hours', '4'),
  ('unanswered_bands', '{"medium":4,"high":8,"critical":24}')
ON CONFLICT (key) DO NOTHING;

-- ── 8. The acts ──────────────────────────────────────────

-- The app's way to send. Non-staff: inbound, on a thread they are party to. Staff:
-- outbound or an internal note, on any thread. The message row is its own record; the
-- audit log gets only the internal note.
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation uuid, p_content text, p_direction text DEFAULT NULL, p_attachments jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv   public.conversations%ROWTYPE;
  v_actor  uuid := auth.uid();
  v_admin  boolean := public.is_admin();
  v_member boolean;
  v_dir    text;
  v_name   text;
  v_id     uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in: a message has an author'; END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN RAISE EXCEPTION 'empty_message: nothing to send'; END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such conversation'; END IF;

  v_member := v_conv.person_id = v_actor
           OR (v_conv.project_id IS NOT NULL AND (
                 EXISTS (SELECT 1 FROM public.projects WHERE id = v_conv.project_id AND user_id = v_actor)
                 OR public.is_contractor_on(v_conv.project_id, v_actor)));
  IF NOT (v_admin OR v_member) THEN
    RAISE EXCEPTION 'not_member: only a party to the conversation or staff may write on it';
  END IF;

  IF v_admin THEN
    v_dir := COALESCE(p_direction, 'outbound');
    IF v_dir NOT IN ('outbound', 'internal') THEN RAISE EXCEPTION 'bad_direction: staff write outbound or internal'; END IF;
  ELSE
    IF p_direction IS NOT NULL AND p_direction <> 'inbound' THEN
      RAISE EXCEPTION 'bad_direction: a client or contractor message is inbound';
    END IF;
    v_dir := 'inbound';
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), email, 'Member') INTO v_name FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.project_messages
    (project_id, conversation_id, sender_id, sender_name, content, direction, channel, attachments)
  VALUES
    (v_conv.project_id, p_conversation, v_actor, COALESCE(v_name, 'Member'), p_content, v_dir, 'jalla', p_attachments)
  RETURNING id INTO v_id;

  IF v_dir = 'internal' THEN
    PERFORM public.log_activity(v_conv.project_id, 'message.internal_note', 'conversation', p_conversation, v_conv.person_id,
      jsonb_build_object('message_id', v_id));
  END IF;
  RETURN v_id;
END $$;

-- A project's thread for the app (member or staff). Creates it if the project has none.
CREATE OR REPLACE FUNCTION public.ensure_project_conversation(p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NOT (public.is_admin()
          OR EXISTS (SELECT 1 FROM public.projects WHERE id = p_project AND user_id = v_actor)
          OR public.is_contractor_on(p_project, v_actor)) THEN
    RAISE EXCEPTION 'not_member: not a member of this project';
  END IF;
  RETURN public.project_conversation(p_project);
END $$;

-- The inbound handler's resolver (service role only). Identity, in order: GHL's
-- conversation id; GHL's contact id; the person's newest open thread; else a new
-- pre-project thread for the person. Stamps the GHL ids it learned. Idempotent and safe
-- under concurrent first contact.
CREATE OR REPLACE FUNCTION public.ensure_inbound_conversation(
  p_person uuid, p_ghl_conversation_id text DEFAULT NULL, p_ghl_contact_id text DEFAULT NULL, p_channel text DEFAULT 'email'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id  uuid;
  v_key text := COALESCE(NULLIF(p_ghl_conversation_id, ''), NULLIF(p_ghl_contact_id, ''), p_person::text);
BEGIN
  IF p_person IS NULL AND NULLIF(p_ghl_conversation_id, '') IS NULL AND NULLIF(p_ghl_contact_id, '') IS NULL THEN
    RAISE EXCEPTION 'no_identity: a person, a GHL conversation id or a GHL contact id is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('conversation:inbound:' || v_key));

  IF NULLIF(p_ghl_conversation_id, '') IS NOT NULL THEN
    SELECT id INTO v_id FROM public.conversations WHERE ghl_conversation_id = p_ghl_conversation_id;
  END IF;
  IF v_id IS NULL AND NULLIF(p_ghl_contact_id, '') IS NOT NULL THEN
    SELECT id INTO v_id FROM public.conversations
     WHERE ghl_contact_id = p_ghl_contact_id AND status <> 'resolved'
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 1;
  END IF;
  IF v_id IS NULL AND p_person IS NOT NULL THEN
    SELECT id INTO v_id FROM public.conversations
     WHERE person_id = p_person AND status <> 'resolved'
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    IF p_person IS NULL THEN RAISE EXCEPTION 'no_person: cannot open a thread for an unknown person'; END IF;
    INSERT INTO public.conversations (person_id, channel, ghl_conversation_id, ghl_contact_id)
    VALUES (p_person, COALESCE(NULLIF(p_channel, ''), 'email'), NULLIF(p_ghl_conversation_id, ''), NULLIF(p_ghl_contact_id, ''))
    ON CONFLICT (ghl_conversation_id) WHERE ghl_conversation_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.conversations WHERE ghl_conversation_id = p_ghl_conversation_id;
    END IF;
    PERFORM public.log_activity(NULL, 'conversation.created', 'conversation', v_id, p_person,
      jsonb_strip_nulls(jsonb_build_object('channel', p_channel, 'by', 'provider', 'ghl_contact_id', NULLIF(p_ghl_contact_id, ''))));
    RETURN v_id;
  END IF;

  -- Learn the ids we did not have. The unique index refuses a second thread claiming
  -- the same GHL conversation; that is the correct answer, not something to swallow.
  UPDATE public.conversations
     SET ghl_conversation_id = COALESCE(ghl_conversation_id, NULLIF(p_ghl_conversation_id, '')),
         ghl_contact_id      = COALESCE(ghl_contact_id, NULLIF(p_ghl_contact_id, '')),
         updated_at = now()
   WHERE id = v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.assign_conversation(p_conversation uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only staff assign a conversation'; END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such conversation'; END IF;
  IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = 'admin') THEN
    RAISE EXCEPTION 'not_staff: a conversation is assigned to a staff member';
  END IF;
  UPDATE public.conversations SET assigned_to = p_user, updated_at = now() WHERE id = p_conversation;
  PERFORM public.log_activity(v_conv.project_id, 'conversation.assigned', 'conversation', p_conversation, COALESCE(p_user, v_conv.person_id),
    jsonb_strip_nulls(jsonb_build_object('assigned_to', p_user, 'unassigned', p_user IS NULL)));
END $$;

-- Staff attach a pre-project (or mis-filed) thread to a project. Its project-less
-- messages follow, so project readers can see them.
CREATE OR REPLACE FUNCTION public.link_conversation(p_conversation uuid, p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only staff link a conversation'; END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such conversation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project) THEN RAISE EXCEPTION 'not_found: no such project'; END IF;
  IF v_conv.project_id = p_project THEN RETURN; END IF;
  IF v_conv.project_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_linked: this conversation belongs to another project';
  END IF;
  UPDATE public.conversations SET project_id = p_project, updated_at = now() WHERE id = p_conversation;
  UPDATE public.project_messages SET project_id = p_project WHERE conversation_id = p_conversation AND project_id IS NULL;
  PERFORM public.log_activity(p_project, 'conversation.linked', 'conversation', p_conversation, v_conv.person_id,
    jsonb_build_object('previous_project_id', v_conv.project_id));
END $$;

CREATE OR REPLACE FUNCTION public.resolve_conversation(p_conversation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only staff resolve a conversation'; END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such conversation'; END IF;
  IF v_conv.status = 'resolved' THEN RETURN; END IF;
  UPDATE public.conversations SET status = 'resolved', resolved_at = now(), updated_at = now() WHERE id = p_conversation;
  PERFORM public.log_activity(v_conv.project_id, 'conversation.resolved', 'conversation', p_conversation, v_conv.person_id,
    jsonb_build_object('was', v_conv.status));
END $$;

-- Staff record a decision — the way an approval given on WhatsApp becomes part of the
-- record. approved_by is the client when it is their approval being recorded.
CREATE OR REPLACE FUNCTION public.record_decision(
  p_project uuid, p_subject text, p_decision text,
  p_related text DEFAULT 'other', p_related_id uuid DEFAULT NULL,
  p_conversation uuid DEFAULT NULL, p_message uuid DEFAULT NULL,
  p_cost_impact_usd numeric DEFAULT NULL, p_schedule_impact_days integer DEFAULT NULL,
  p_approved_by uuid DEFAULT NULL, p_supersedes uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only staff record a decision'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project) THEN RAISE EXCEPTION 'not_found: no such project'; END IF;
  IF p_conversation IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.conversations WHERE id = p_conversation AND (project_id = p_project OR project_id IS NULL)) THEN
    RAISE EXCEPTION 'thread_mismatch: that conversation belongs to another project';
  END IF;
  IF p_message IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.project_messages WHERE id = p_message AND (p_conversation IS NULL OR conversation_id = p_conversation)) THEN
    RAISE EXCEPTION 'message_mismatch: that message is not on that conversation';
  END IF;
  IF p_supersedes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.decisions WHERE id = p_supersedes AND project_id = p_project) THEN
    RAISE EXCEPTION 'not_found: the decision being superseded is not on this project';
  END IF;
  IF p_approved_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_approved_by) THEN
    RAISE EXCEPTION 'not_found: approved_by is not an account';
  END IF;

  INSERT INTO public.decisions
    (project_id, conversation_id, message_id, subject, decision, related, related_id, supersedes_id,
     recorded_by, approved_by, approved_at, cost_impact_usd, schedule_impact_days)
  VALUES
    (p_project, p_conversation, p_message, btrim(p_subject), btrim(p_decision), COALESCE(p_related, 'other'), p_related_id, p_supersedes,
     v_actor, p_approved_by, CASE WHEN p_approved_by IS NOT NULL THEN now() END, p_cost_impact_usd, p_schedule_impact_days)
  RETURNING id INTO v_id;

  PERFORM public.log_activity(p_project, 'decision.recorded', 'decision', v_id, p_approved_by,
    jsonb_strip_nulls(jsonb_build_object(
      'subject', btrim(p_subject), 'related', COALESCE(p_related, 'other'), 'related_id', p_related_id,
      'conversation_id', p_conversation, 'cost_impact_usd', p_cost_impact_usd,
      'schedule_impact_days', p_schedule_impact_days, 'supersedes_id', p_supersedes)));
  RETURN v_id;
END $$;

-- The client confirms a decision on their own project, once.
CREATE OR REPLACE FUNCTION public.confirm_decision(p_decision uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dec   public.decisions%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO v_dec FROM public.decisions WHERE id = p_decision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such decision'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_dec.project_id AND user_id = v_actor) THEN
    RAISE EXCEPTION 'not_owner: only the project owner confirms a decision';
  END IF;
  IF v_dec.approved_by IS NOT NULL THEN RAISE EXCEPTION 'already_approved: this decision is already approved'; END IF;
  UPDATE public.decisions SET approved_by = v_actor, approved_at = now() WHERE id = p_decision;
  PERFORM public.log_activity(v_dec.project_id, 'decision.approved', 'decision', p_decision, v_actor,
    jsonb_build_object('subject', v_dec.subject));
END $$;

CREATE OR REPLACE FUNCTION public.link_ticket(p_ticket uuid, p_project uuid DEFAULT NULL, p_conversation uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only staff link a ticket'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such ticket'; END IF;
  IF p_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project) THEN RAISE EXCEPTION 'not_found: no such project'; END IF;
  IF p_conversation IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = p_conversation) THEN RAISE EXCEPTION 'not_found: no such conversation'; END IF;
  UPDATE public.support_tickets
     SET project_id = COALESCE(p_project, project_id), conversation_id = COALESCE(p_conversation, conversation_id)
   WHERE id = p_ticket;
  -- The audit row needs a subject; a ticket with no project and no account gets none.
  IF COALESCE(p_project, v_ticket.project_id) IS NOT NULL OR v_ticket.user_id IS NOT NULL THEN
    PERFORM public.log_activity(COALESCE(p_project, v_ticket.project_id), 'ticket.linked', 'support_ticket', p_ticket, v_ticket.user_id,
      jsonb_strip_nulls(jsonb_build_object('conversation_id', p_conversation)));
  END IF;
END $$;

-- The Action Center's reader: threads waiting on us longer than the threshold, banded
-- by age. The numbers live in app_config; this is the only place they are read.
CREATE OR REPLACE FUNCTION public.unanswered_conversations()
RETURNS TABLE (conversation_id uuid, project_id uuid, person_id uuid, assigned_to uuid, waiting_since timestamptz, hours numeric, band text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_threshold numeric := 4;
  v_bands     jsonb   := '{"medium":4,"high":8,"critical":24}'::jsonb;
  v_txt       text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: staff only'; END IF;
  SELECT value INTO v_txt FROM public.app_config WHERE key = 'unanswered_conversation_hours';
  IF NULLIF(v_txt, '') IS NOT NULL THEN v_threshold := v_txt::numeric; END IF;
  SELECT value INTO v_txt FROM public.app_config WHERE key = 'unanswered_bands';
  IF NULLIF(v_txt, '') IS NOT NULL THEN v_bands := v_txt::jsonb; END IF;
  RETURN QUERY
    SELECT c.id, c.project_id, c.person_id, c.assigned_to, c.last_message_at,
           round(EXTRACT(EPOCH FROM (now() - c.last_message_at)) / 3600, 1),
           CASE
             WHEN now() - c.last_message_at >= make_interval(hours => (v_bands->>'critical')::int) THEN 'critical'
             WHEN now() - c.last_message_at >= make_interval(hours => (v_bands->>'high')::int)     THEN 'high'
             ELSE 'medium'
           END
      FROM public.conversations c
     WHERE c.status = 'waiting_on_us'
       AND c.last_message_at <= now() - make_interval(hours => v_threshold::int)
     ORDER BY c.last_message_at;
END $$;

REVOKE ALL ON FUNCTION public.send_message(uuid, text, text, jsonb)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_project_conversation(uuid)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_inbound_conversation(uuid, text, text, text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_conversation(uuid, uuid)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_conversation(uuid, uuid)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_conversation(uuid)                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_decision(uuid, text, text, text, uuid, uuid, uuid, numeric, integer, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_decision(uuid)                                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_ticket(uuid, uuid, uuid)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unanswered_conversations()                                      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, jsonb)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_project_conversation(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_inbound_conversation(uuid, text, text, text)          TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_conversation(uuid, uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_conversation(uuid, uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_conversation(uuid)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_decision(uuid, text, text, text, uuid, uuid, uuid, numeric, integer, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_decision(uuid)                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_ticket(uuid, uuid, uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.unanswered_conversations()                                   TO authenticated;

-- ── 9. RLS ───────────────────────────────────────────────
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_conversations"  ON public.conversations;
DROP POLICY IF EXISTS "person_read_conversations" ON public.conversations;
DROP POLICY IF EXISTS "member_read_conversations" ON public.conversations;
CREATE POLICY "admin_read_conversations"  ON public.conversations FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "person_read_conversations" ON public.conversations FOR SELECT TO authenticated USING (person_id = auth.uid());
CREATE POLICY "member_read_conversations" ON public.conversations FOR SELECT TO authenticated
  USING (project_id IS NOT NULL AND (
           EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
           OR public.is_contractor_on(project_id, auth.uid())));
-- No writes from the browser: the RPCs above.

-- project_messages: readers keep their project arm, gain the person arm, lose `internal`
-- unless admin. Writers: the two non-staff INSERT policies survive for the client that
-- predates 091, tightened; admin's is unchanged (009).
DROP POLICY IF EXISTS "owner_read_messages"              ON public.project_messages;
DROP POLICY IF EXISTS "contractors_read_invited_messages" ON public.project_messages;
DROP POLICY IF EXISTS "member_read_messages"             ON public.project_messages;
CREATE POLICY "member_read_messages" ON public.project_messages FOR SELECT TO authenticated
  USING (direction <> 'internal' AND (
           (project_id IS NOT NULL AND (
              EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
              OR public.is_contractor_on(project_id, auth.uid())))
           OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.person_id = auth.uid())));
-- admin_select_all_messages (009) stays.

DROP POLICY IF EXISTS "owner_send_messages"               ON public.project_messages;
DROP POLICY IF EXISTS "contractors_send_invited_messages" ON public.project_messages;
DROP POLICY IF EXISTS "member_send_messages"              ON public.project_messages;
CREATE POLICY "member_send_messages" ON public.project_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND direction <> 'internal' AND (
           (project_id IS NOT NULL AND (
              EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
              OR public.is_contractor_on(project_id, auth.uid())))
           OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.person_id = auth.uid())));
-- admin_insert_messages (009) stays.

DROP POLICY IF EXISTS "admin_read_decisions" ON public.decisions;
DROP POLICY IF EXISTS "owner_read_decisions" ON public.decisions;
CREATE POLICY "admin_read_decisions" ON public.decisions FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "owner_read_decisions" ON public.decisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
-- support_tickets policies (074) unchanged.

COMMENT ON TABLE public.conversations IS
  'The thread with a person — optionally about a project. ghl_conversation_id is its identity across the GHL '
  'boundary (UNIQUE). Status moves with messages (inbound → waiting_on_us, outbound → waiting_on_them) and by '
  'resolve_conversation(). Written by RPCs and the inbound handler only. See 091.';
COMMENT ON COLUMN public.project_messages.direction IS
  'From Groundwork''s side: inbound = the client/contractor wrote it; outbound = staff wrote it (app or GHL); '
  'internal = staff note, never mirrored, admin-only to read. See 091.';
COMMENT ON COLUMN public.profiles.ghl_thread_project_id IS
  'RETIRED by 091: replies are filed by conversations.ghl_conversation_id. Column kept for rollback; no reader.';
COMMENT ON TABLE public.decisions IS
  'What was decided, where, by whom. Immutable; a reversal is a new row naming the old (supersedes_id). See 091.';

-- ── Verify ───────────────────────────────────────────────
SELECT 'conversations backfilled' AS what, count(*)::text AS n FROM public.conversations
UNION ALL SELECT 'messages without a thread (expect 0)', count(*)::text FROM public.project_messages WHERE conversation_id IS NULL
UNION ALL SELECT 'messages by direction', string_agg(direction || '=' || n, ', ') FROM (SELECT direction, count(*) AS n FROM public.project_messages GROUP BY 1 ORDER BY 1) d
UNION ALL SELECT 'app_config keys (expect 2)', count(*)::text FROM public.app_config WHERE key IN ('unanswered_conversation_hours', 'unanswered_bands');

-- ── Rollback (not run) ────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.unanswered_conversations(), public.link_ticket(uuid,uuid,uuid), public.confirm_decision(uuid),
--   public.record_decision(uuid,text,text,text,uuid,uuid,uuid,numeric,integer,uuid,uuid), public.resolve_conversation(uuid),
--   public.link_conversation(uuid,uuid), public.assign_conversation(uuid,uuid), public.ensure_inbound_conversation(uuid,text,text,text),
--   public.ensure_project_conversation(uuid), public.send_message(uuid,text,text,jsonb);
-- DROP TRIGGER IF EXISTS messages_advance_conversation ON public.project_messages; DROP TRIGGER IF EXISTS messages_default_conversation ON public.project_messages;
-- DROP FUNCTION IF EXISTS public.messages_advance_conversation(), public.messages_default_conversation(), public.project_conversation(uuid);
-- restore the four 004/20260714 message policies from git; DROP POLICY member_read_messages, member_send_messages;
-- DELETE FROM public.project_messages WHERE project_id IS NULL;   -- pre-project rows have no home before 091
-- ALTER TABLE public.project_messages DROP COLUMN attachments, DROP COLUMN status, DROP COLUMN channel, DROP COLUMN direction, DROP COLUMN conversation_id;
-- ALTER TABLE public.project_messages ALTER COLUMN project_id SET NOT NULL;
-- ALTER TABLE public.support_tickets DROP COLUMN conversation_id, DROP COLUMN project_id;
-- DROP TABLE IF EXISTS public.decisions; DROP TABLE IF EXISTS public.conversations;
-- DELETE FROM public.app_config WHERE key IN ('unanswered_conversation_hours', 'unanswered_bands');
-- App: restore conversation-delivery.ts / project-message.ts / messages.ts from git (the ghl_thread_project_id heuristic).
