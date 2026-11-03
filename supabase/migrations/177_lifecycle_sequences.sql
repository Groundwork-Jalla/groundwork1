-- =========================================================
-- 177 — Lifecycle sequences and the Day-7 follow-up queue
--
-- The app, not GoHighLevel, now sends the lifecycle emails / WhatsApp messages.
-- GHL keeps receiving contacts and events; this is only the sending side.
--
--   lifecycle_sequences       a named journey, started by one event
--   lifecycle_sequence_steps  its messages, each N hours after the last
--   lifecycle_enrollments     one person in one sequence (unique per email)
--   lifecycle_sends           what was sent, or why it was not
--   followup_queue            people a human should ring after Day 7
--
-- Every sequence is seeded DISABLED with placeholder copy. Nothing is sent until an
-- admin edits the wording and switches it on.
--
-- All writes from the browser are admin-only. The scheduler uses the service role.
--
-- Run in: Supabase Dashboard > SQL Editor (after 176)
-- =========================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.lifecycle_sequences (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  trigger_event TEXT NOT NULL,
  exit_events   TEXT[] NOT NULL DEFAULT '{}',
  audience      TEXT NOT NULL DEFAULT 'any' CHECK (audience IN ('any','contractor','client')),
  -- Day-7 human follow-up: when set, anyone still enrolled this many days after
  -- enrolling is put on the queue instead of being messaged again.
  followup_after_days INT CHECK (followup_after_days IS NULL OR followup_after_days > 0),
  enabled       BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lifecycle_sequence_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_key TEXT NOT NULL REFERENCES public.lifecycle_sequences(key) ON DELETE CASCADE,
  position     INT  NOT NULL CHECK (position > 0),
  delay_hours  INT  NOT NULL DEFAULT 0 CHECK (delay_hours >= 0),
  channel      TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp')),
  subject_en   TEXT NOT NULL DEFAULT '',
  subject_fr   TEXT NOT NULL DEFAULT '',
  body_en      TEXT NOT NULL DEFAULT '',
  body_fr      TEXT NOT NULL DEFAULT '',
  UNIQUE (sequence_key, position)
);

CREATE TABLE IF NOT EXISTS public.lifecycle_enrollments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_key TEXT NOT NULL REFERENCES public.lifecycle_sequences(key) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  full_name    TEXT,
  phone        TEXT,
  lang         TEXT NOT NULL DEFAULT 'en',
  user_role    TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','exited','suppressed')),
  next_position INT NOT NULL DEFAULT 1,
  next_send_at TIMESTAMPTZ,
  exit_reason  TEXT,
  enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  followup_queued BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (sequence_key, email)
);
CREATE INDEX IF NOT EXISTS lifecycle_enrollments_due
  ON public.lifecycle_enrollments (next_send_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.lifecycle_sends (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID REFERENCES public.lifecycle_enrollments(id) ON DELETE CASCADE,
  sequence_key  TEXT NOT NULL,
  position      INT  NOT NULL,
  email         TEXT NOT NULL,
  channel       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error         TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lifecycle_sends_recent ON public.lifecycle_sends (sent_at DESC);

CREATE TABLE IF NOT EXISTS public.followup_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID REFERENCES public.lifecycle_enrollments(id) ON DELETE SET NULL,
  sequence_key TEXT NOT NULL,
  email        TEXT NOT NULL,
  full_name    TEXT,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  UNIQUE (sequence_key, email)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lifecycle_sequences','lifecycle_sequence_steps',
    'lifecycle_enrollments','lifecycle_sends','followup_queue'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "admin_all_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "admin_all_%s" ON public.%I FOR ALL TO authenticated '
      'USING (public.is_admin()) WITH CHECK (public.is_admin())', t, t);
  END LOOP;
END $$;

-- ── Seeds: disabled, placeholder wording ─────────────────
INSERT INTO public.lifecycle_sequences (key, name, description, trigger_event, exit_events, audience, followup_after_days) VALUES
 ('contractor_welcome', 'Contractor — finish onboarding', 'Signed up, has not finished onboarding.',
  'user_signup', '{contractor_onboarding_completed}', 'contractor', 7),
 ('client_welcome', 'Client — start a project', 'Signed up as a client, has no project yet.',
  'user_signup', '{project_created}', 'client', 7),
 ('invitation_pending', 'Invitation not accepted', 'Invited to a project, has not accepted.',
  'client_invited', '{invitation_accepted}', 'any', 7),
 ('contractor_invitation_pending', 'Contractor invitation not accepted', 'A contractor was invited and has not joined.',
  'contractor_invited', '{invitation_accepted}', 'any', 7),
 ('no_project_selected', 'No active project', 'Member of a project but none selected.',
  'no_active_project_selected', '{project_membership_active}', 'any', NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.lifecycle_sequence_steps (sequence_key, position, delay_hours, channel, subject_en, subject_fr, body_en, body_fr)
SELECT s.key, p.pos, p.delay, 'email',
  '[Draft] ' || s.name, '[Brouillon] ' || s.name,
  'Hi {{first_name}},' || E'\n\n' || 'PLACEHOLDER — replace with the approved wording.',
  'Bonjour {{first_name}},' || E'\n\n' || 'PROVISOIRE — à remplacer par le texte approuvé.'
FROM public.lifecycle_sequences s
CROSS JOIN (VALUES (1, 24), (2, 72)) AS p(pos, delay)
ON CONFLICT (sequence_key, position) DO NOTHING;

COMMIT;
