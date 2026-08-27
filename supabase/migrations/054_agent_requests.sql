-- =========================================================
-- 054  agent_requests — the desk where the team asks for agent work
--
-- Groundwork keeps a set of Claude Code agents in .claude/agents/ (video-producer,
-- budget-analyst, qs-liaison, beta-triage, ops-desk). They run against the codebase,
-- which means only a developer can invoke them — and Philip, who needs them most, is
-- the CEO, not a developer.
--
-- This table is the bridge. Someone states what they need; Favour runs the agent; the
-- result comes back here. It is a REQUEST QUEUE, not a way to run an agent from the
-- browser, and that distinction is deliberate rather than a limitation:
--
--   · Recording a walkthrough needs headless Chrome, a dev server and ffmpeg running
--     for minutes. None of that fits a serverless function.
--   · Anything going to an investor or a client should have a human look at it before
--     it is sent. The video-producer agent's own instructions insist on that.
--
-- THE FORM ASKS FOR INTENT, NOT INSTRUCTIONS, and the columns are shaped to enforce it.
-- A CEO knows "I need something for investors on Thursday"; he does not know "record
-- wizard steps 1-9 in English at 12fps". So we store `audience`, `goal` and `needed_by`
-- and let the agent translate those into a shot list. Asking a busy person for a shot
-- list gets empty fields.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.agent_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who asked. ON DELETE SET NULL rather than CASCADE: a delivered video outlives the
  -- account of whoever requested it, and losing the record would lose the brief that
  -- explains why it was made.
  requested_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Which agent should do the work. Constrained so a typo cannot create a request that
  -- routes nowhere; adding an agent means editing this list on purpose.
  agent          TEXT NOT NULL DEFAULT 'video-producer'
                 CHECK (agent IN ('video-producer', 'budget-analyst',
                                  'qs-liaison', 'beta-triage', 'ops-desk')),

  -- One of the seeded starting points ('investor_demo', 'client_explainer', ...) or
  -- 'custom'. Free text on purpose: which presets earn their place is something we
  -- learn from use, and a CHECK here would mean a migration every time we guess wrong.
  preset         TEXT,

  title          TEXT NOT NULL CHECK (length(trim(title)) > 0),

  -- The three questions that actually determine the work.
  audience       TEXT,          -- who watches or reads it
  goal           TEXT,          -- what they should be able to do or decide afterwards
  channel        TEXT,          -- where it will be shown: investor call, WhatsApp, site
  language       TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr', 'both')),
  needed_by      DATE,
  notes          TEXT,          -- anything to include or avoid

  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'in_progress', 'delivered', 'declined')),

  -- What came back. `output_url` is where the finished artefact lives; `output_note` is
  -- what the agent or Favour wants the requester to know about it — including "this
  -- could not be done, and here is why", which is why declining is a status rather than
  -- a deletion.
  output_url     TEXT,
  output_note    TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The queue view: open work, oldest first. Partial, because delivered requests are
-- history and history is browsed, not polled.
CREATE INDEX IF NOT EXISTS agent_requests_open_idx
  ON public.agent_requests (created_at)
  WHERE status IN ('new', 'in_progress');

CREATE INDEX IF NOT EXISTS agent_requests_requester_idx
  ON public.agent_requests (requested_by, created_at DESC);

ALTER TABLE public.agent_requests ENABLE ROW LEVEL SECURITY;

-- Admin-only, all four commands. The page lives inside /admin, which is already gated on
-- is_admin(), so there is no second audience to model — and the queue names internal
-- work, deadlines and unreleased features, which is not something a client or contractor
-- should be able to read.
--
-- Philip reaches this by being granted the 'admin' role (see below). If a narrower
-- 'staff' role is ever added, this policy is the one place to widen.
CREATE POLICY "admins_manage_agent_requests"
  ON public.agent_requests FOR ALL
  USING     (public.is_admin())
  WITH CHECK (public.is_admin());

-- Keep updated_at honest without every caller remembering to set it.
CREATE OR REPLACE FUNCTION public.touch_agent_request()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_requests_touch ON public.agent_requests;
CREATE TRIGGER agent_requests_touch
  BEFORE UPDATE ON public.agent_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_agent_request();

COMMENT ON TABLE public.agent_requests IS
  'Briefs for the Claude Code agents in .claude/agents/. A queue, not a runner: agents '
  'execute against the repository, so a developer picks these up and posts the result '
  'back. Columns capture intent (audience, goal, deadline) rather than instructions.';
