-- The sign-up sequence could never record anything, so stop pretending it does.
--
-- WHAT WAS WRONG
--
-- 170 defined six tracked sequences, `signup` among them, and the report read all six
-- from `funnel_events`. But `record_funnel_event` stamps `auth.uid()` — by design,
-- so a browser cannot write somebody else into the funnel — and a visitor filling in
-- the sign-up form has no identity yet. There is no moment at which a sign-up START
-- can be recorded, so the row never existed and the sequence reported 0 / 0 forever
-- while 63 contractor accounts sat in `user_roles`.
--
-- Two numbers for one fact, one of them permanently empty, is exactly the disagreement
-- the three sequences were separated to end.
--
-- THE FIX
--
-- Sign-ups are counted from the accounts themselves, which is the authoritative record
-- and always has been. An account either exists or it does not; there is no partial
-- sign-up to lose. So for this one sequence:
--
--   started    = every account (they all reached the form to have one)
--   completed  = every account
--   incomplete = 0
--
-- That is not a fudge, it is the truth about this particular sequence: an abandoned
-- sign-up leaves nothing behind to count, in this system or any other that identifies
-- people by their account. If abandoned sign-ups ever need measuring, it takes an
-- anonymous client-side identifier, which is a product decision and not this function.
--
-- The other five sequences are unchanged and still come from `funnel_events`.
--
-- WHY CONTRACTORS AND NOT EVERY USER
--
-- The funnel this sits in is the contractor funnel: `contractor_onboarding` and
-- `partner_application` both count contractors, so counting every signup here —
-- clients included — would make the first step incomparable with the rest.
--
-- Run in: Supabase Dashboard > SQL Editor (after 170)

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_growth_funnels()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out      jsonb;
  v_contractors integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: staff only';
  END IF;

  -- Grouped over every sequence that has ANY event, not only ones with a 'started'.
  -- A sequence whose only rows are completions — everyone who was already mid-flow
  -- when tracking was switched on — must still report its completions rather than
  -- disappear from the dashboard.
  SELECT jsonb_object_agg(seq, counts) INTO v_out
  FROM (
    SELECT q.sequence AS seq,
           jsonb_build_object(
             'started',   count(*) FILTER (WHERE q.step = 'started'),
             'completed', count(*) FILTER (WHERE q.step = 'completed'),
             -- Closed by SUBJECT where there is one, and by person only where there
             -- is not: a client invitation is SENT by the contractor and ACCEPTED by
             -- the client, so matching on user_id would leave every one incomplete.
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
     WHERE q.sequence <> 'signup'   -- counted from accounts below
     GROUP BY q.sequence
  ) g;

  -- Sign-ups, from the accounts themselves. See the header.
  SELECT count(*) INTO v_contractors
    FROM public.user_roles WHERE role = 'contractor';

  v_out := coalesce(v_out, '{}'::jsonb) || jsonb_build_object(
    'signup', jsonb_build_object(
      'started',    v_contractors,
      'completed',  v_contractors,
      'incomplete', 0,
      -- Named in the payload so a reader of the dashboard knows this one number does
      -- not come from the event log, and does not go looking for events behind it.
      'source',     'user_roles'
    ));

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.admin_growth_funnels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_funnels() TO authenticated;

COMMENT ON FUNCTION public.admin_growth_funnels() IS
  'Per-sequence started / completed / incomplete (170, signup corrected in 172). '
  'Every sequence but `signup` comes from funnel_events; `signup` is counted from '
  'user_roles, because an abandoned sign-up leaves no identity to record against.';

COMMIT;
