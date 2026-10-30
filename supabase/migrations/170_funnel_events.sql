-- Three sequences, each with a real start and a real end (30 Oct 2026).
--
-- WHY THIS EXISTS
--
-- 136 built ONE chained funnel: accounts → onboarded → interested → applications →
-- prequalified → sent_to_booking. Philip, in the working session, asked for something
-- different: "sign-up, contractor onboarding, and partner application are three
-- separate sequences", each tracked from its own start to its own end so drop-offs
-- are visible inside a sequence rather than only between them.
--
-- The chain also hid a double count he named directly. One click at the end of
-- onboarding — "I have a project" — both completes onboarding AND sets
-- `partner_interest`, which the funnel reads as the start of a partner application.
-- So one action was being counted as the end of one sequence and the beginning of
-- another, and Philip's objection was exact: "starting an application differs
-- fundamentally from selecting options like lacking a project".
--
-- The answer is to stop INFERRING the boundaries. A sequence starts when the person
-- does the thing that starts it, and that gets written down. Nothing here is derived
-- from an answer on another screen.
--
-- WHERE THE BOUNDARIES ARE, AS AGREED
--
--   signup                 starts: the sign-up form is opened
--                          ends:   the account exists
--   contractor_onboarding  starts: sign-up (email and phone entered)
--                          ends:   "I have a project" / "I don't have a project"
--   partner_application    starts: Next on the partner page, after choosing a language
--                          ends:   Send application   (NOT booking a call — Philip:
--                                  "sending the application and booking a call are
--                                  distinct steps; users could complete the
--                                  application and drop off beforehand")
--   call_booking           starts: the calendar is shown
--                          ends:   a slot is confirmed
--   project_creation       starts: Create project / I have a project
--                          ends:   the final confirm-and-create
--   client_invitation      starts: an invitation is sent
--                          ends:   the client accepts
--
-- WHY COMPLETED AND INCOMPLETE ARE BOTH COUNTED
--
-- Philip asked for "completed and incomplete as independent standing categories
-- rather than using negative numbers". `started - completed` is a subtraction that
-- silently goes wrong the moment one of the two is measured differently, which is how
-- the numbers that opened that meeting came to disagree. So the reader gets both
-- counts from the same table and can see the arithmetic rather than inherit it.
--
-- Run in: Supabase Dashboard > SQL Editor

BEGIN;

-- ── 1. The log ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.funnel_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence    text NOT NULL CHECK (sequence IN (
                'signup', 'contractor_onboarding', 'partner_application',
                'call_booking', 'project_creation', 'client_invitation')),
  step        text NOT NULL CHECK (step IN ('started', 'completed')),
  -- Project creation and client invitations happen many times per person, so the
  -- subject is part of the identity of the event. Null for the once-per-person ones.
  subject_id  uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Once per person per sequence per step — or once per subject where there is one.
-- A contractor who reopens the partner page must not add a second "started": the
-- question is how many PEOPLE began, not how many times a page was rendered.
CREATE UNIQUE INDEX IF NOT EXISTS funnel_events_once
  ON public.funnel_events (user_id, sequence, step, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS funnel_events_by_sequence
  ON public.funnel_events (sequence, step, occurred_at DESC);

COMMENT ON TABLE public.funnel_events IS
  'Start and end of each tracked sequence (170). Written where the action happens, '
  'never inferred from an answer on another screen — see the header.';

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_funnel_events" ON public.funnel_events;
CREATE POLICY "own_funnel_events" ON public.funnel_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "staff_read_funnel_events" ON public.funnel_events;
CREATE POLICY "staff_read_funnel_events" ON public.funnel_events FOR SELECT TO authenticated
  USING (public.is_admin());

-- No INSERT policy at all: every write goes through the function below, which stamps
-- auth.uid() itself. A client that could choose its own user_id could write somebody
-- else into the funnel.

-- ── 2. Recording one ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_funnel_event(
  p_sequence text,
  p_step     text,
  p_subject  uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: a funnel event belongs to somebody';
  END IF;

  -- Idempotent. The browser may retry on a bad connection, and a retry must not
  -- invent a second person. ON CONFLICT keeps the FIRST occurrence, because the
  -- question every one of these answers is "when did they first do this".
  INSERT INTO public.funnel_events (user_id, sequence, step, subject_id)
  VALUES (v_actor, p_sequence, p_step, p_subject)
  ON CONFLICT DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.record_funnel_event(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_funnel_event(text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.record_funnel_event(text, text, uuid) IS
  'Write one funnel event for the signed-in user (170). Idempotent: the first '
  'occurrence wins, so a retry cannot inflate a count.';

-- ── 3. Reading them ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_growth_funnels()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: staff only';
  END IF;

  -- Each sequence reports three independent counts.
  --
  -- `incomplete` is COUNTED, not `started - completed`. Philip asked for "independent
  -- standing categories rather than negative numbers", and the difference is not
  -- cosmetic: a subtraction goes negative the moment a 'completed' exists without its
  -- 'started' — which is exactly what happens to anyone who was already mid-flow when
  -- tracking was switched on. A real count of "began and has not finished" is never
  -- negative and names a set of people somebody can actually go and follow up.
  --
  -- Counted per SUBJECT, not per person: one contractor can start three projects and
  -- finish one, and "two incomplete" is the useful fact.
  -- Grouped over every sequence that has ANY event, not only ones with a 'started'.
  -- A sequence whose only rows are completions — everyone who was already mid-flow
  -- when tracking was switched on — must still report its completions rather than
  -- disappear from the dashboard, which is what grouping from 'started' alone did.
  SELECT jsonb_object_agg(seq, counts) INTO v_out
  FROM (
    SELECT q.sequence AS seq,
           jsonb_build_object(
             'started',   count(*) FILTER (WHERE q.step = 'started'),
             'completed', count(*) FILTER (WHERE q.step = 'completed'),
             -- Closed by SUBJECT where there is one, and by person only where there
             -- is not.
             --
             -- The two ends of a sequence are not always the same person. A client
             -- invitation is SENT by the contractor and ACCEPTED by the client, so
             -- matching on user_id would leave every invitation permanently
             -- incomplete. Where a subject exists it IS the identity of the thing
             -- being tracked — this project, this attempt — and who touched each
             -- end of it is a separate question from whether it closed.
             'incomplete', count(*) FILTER (
                             WHERE q.step = 'started'
                               AND NOT EXISTS (
                                 SELECT 1 FROM public.funnel_events d
                                  WHERE d.sequence = q.sequence
                                    AND d.step     = 'completed'
                                    AND (CASE WHEN q.subject_id IS NULL
                                              THEN d.user_id = q.user_id AND d.subject_id IS NULL
                                              ELSE d.subject_id = q.subject_id
                                         END)))
           ) AS counts
      FROM public.funnel_events q
     GROUP BY q.sequence
  ) g;

  RETURN coalesce(v_out, '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.admin_growth_funnels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_funnels() TO authenticated;

COMMENT ON FUNCTION public.admin_growth_funnels() IS
  'Per-sequence started / completed / incomplete (170). Three independent sequences, '
  'not one chain: see the migration header for where each one begins and ends.';

COMMIT;
