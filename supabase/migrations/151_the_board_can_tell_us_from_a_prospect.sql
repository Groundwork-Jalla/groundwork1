-- =========================================================
-- 151 — The board can tell us apart from a prospect
--
-- Ruth, on reporting: "Use the Admin dashboard as the data collection, not the accurate
-- representation of reports. The data it produces still needs to be cleaned up and
-- converted to an accurate report."
--
-- Right, and the cleanup should not be a judgement call made afresh each week. Today it
-- is: somebody has to look down a list and recognise that `gwtest.1792…@mailinator.com`
-- is a fixture and `cmjoseph88@gmail.com` is a bricklayer. That works until the person
-- doing it is new, or in a hurry, or the pattern changes.
--
-- So the fact moves into the data. `is_internal` means "this account is us" — a staff
-- address, a throwaway used in testing, a fixture left by an end-to-end run. It is not
-- a judgement about the person; it is the difference between eleven applications and
-- the seven that came from outreach.
--
-- ── Exposed, not filtered ───────────────────────────────────────────────────────────
-- The board returns the flag rather than dropping those rows, because both numbers are
-- wanted: the real figure to report, and the raw one when somebody is checking whether
-- a test run actually worked. Dropping them here would make the second impossible.
--
-- Run in: Supabase Dashboard > SQL Editor (after 150)
-- =========================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_internal IS
  'This account is ours, not a prospect (151): staff, a test fixture, an end-to-end run. '
  'Reporting excludes it; the raw figure still includes it on demand.';

-- Backfill from what the addresses already say. Written once, here, rather than being
-- re-derived by eye every time somebody builds a report.
UPDATE public.profiles SET is_internal = true
 WHERE is_internal = false
   AND (
        email ILIKE '%@tryjalla.com'        -- staff
     OR email ILIKE '%@mailinator.com'      -- throwaway addresses used in testing
     OR email ILIKE 'gwtest%'               -- fixtures from end-to-end runs
     OR email IN ('phavorfavor@gmail.com', 'nwachukwufac@gmail.com')
   );

-- A fixture is recognisable by its name too, and some were created without a matching
-- address. Deliberately narrow: whole words, so it cannot catch a real surname.
UPDATE public.profiles SET is_internal = true
 WHERE is_internal = false
   AND full_name ~* '(^|\s)(test|probe|fixture)(\s|$)';


-- ── The board reports it ─────────────────────────────────
-- Dropped first: this gains a column, and CREATE OR REPLACE cannot change the row type
-- defined by a function's OUT parameters (42P13).
DROP FUNCTION IF EXISTS public.admin_partner_pipeline();

CREATE OR REPLACE FUNCTION public.admin_partner_pipeline()
RETURNS TABLE (
  user_id             uuid,
  full_name           text,
  email               text,
  phone               text,
  specialty           text,
  stage               text,
  stage_rank          smallint,
  owner_id            uuid,
  owner_name          text,
  last_action         text,
  last_action_at      timestamptz,
  next_action         text,
  next_action_on      date,
  activation_deadline date,
  notes               text,
  applied_at          timestamptz,
  stage_since         timestamptz,
  days_in_stage       integer,
  application_status  text,
  in_directory        boolean,
  application_id      uuid,
  is_internal         boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: staff only';
  END IF;

  RETURN QUERY
  WITH people AS (
    SELECT r.user_id AS uid FROM public.user_roles r WHERE r.role = 'contractor'
  ),
  app AS (
    SELECT DISTINCT ON (a.user_id)
           a.user_id, a.id AS app_id, a.created_at, a.has_current_project, a.will_introduce,
           a.years_experience, a.booking_shown_at, a.status, a.reviewing_at, a.decided_at
      FROM public.contractor_applications a
     WHERE a.source = 'in_app' AND a.user_id IS NOT NULL
     ORDER BY a.user_id, a.created_at DESC
  ),
  intro AS (
    SELECT c.contractor_id AS uid, min(c.invited_at) AS first_invited
      FROM public.contractor_clients c GROUP BY c.contractor_id
  ),
  activated AS (
    SELECT c.contractor_id AS uid, min(p.tracking_started_at) AS first_activated
      FROM public.contractor_clients c
      JOIN public.projects p ON p.user_id = c.client_id
     WHERE p.tracking_started_at IS NOT NULL
     GROUP BY c.contractor_id
  )
  SELECT
    pe.uid, pr.full_name, pr.email, pr.phone,
    coalesce(NULLIF(ob.specialty, 'other'), ob.specialty_other, ob.specialty),
    s.name, s.rank, pl.owner_id, own.full_name,
    pl.last_action, pl.last_action_at, pl.next_action, pl.next_action_on,
    coalesce(pl.activation_deadline, (pl.call_completed_at + interval '14 days')::date),
    pl.notes, app.created_at, s.since,
    greatest(0, (CURRENT_DATE - s.since::date)),
    app.status,
    -- Accepted and VISIBLE TO CLIENTS are two different facts. 033 publishes on accept,
    -- but a publish can fail; the screen says which, rather than implying it.
    EXISTS (SELECT 1 FROM public.contractors d
             WHERE (d.application_id = app.app_id OR d.user_id = pe.uid) AND d.active),
    -- The application itself, so the board can hand staff straight to the answers (148).
    app.app_id,
    -- Us, not a prospect (151). Exposed rather than filtered out, so the board can
    -- show the real figure by default and still show the raw one on demand.
    coalesce(pr.is_internal, false)
  FROM people pe
  LEFT JOIN public.profiles pr              ON pr.id = pe.uid
  LEFT JOIN public.contractor_onboarding ob ON ob.user_id = pe.uid
  LEFT JOIN app                             ON app.user_id = pe.uid
  LEFT JOIN intro                           ON intro.uid = pe.uid
  LEFT JOIN activated act                   ON act.uid = pe.uid
  LEFT JOIN public.partner_pipeline pl      ON pl.user_id = pe.uid
  LEFT JOIN public.profiles own             ON own.id = pl.owner_id
  CROSS JOIN LATERAL (
    SELECT * FROM (VALUES
      ('activated',         13::smallint, act.first_activated),
      ('client_introduced', 12::smallint, intro.first_invited),
      ('agreement_signed',  11::smallint, pl.agreement_signed_at),
      ('committed',         10::smallint, pl.committed_at),
      ('accepted',           9::smallint,
         CASE WHEN app.status = 'accepted' THEN coalesce(app.decided_at, app.created_at) END),
      ('reviewing',          8::smallint,
         CASE WHEN app.status = 'reviewing' THEN coalesce(app.reviewing_at, app.created_at) END),
      ('call_completed',     7::smallint, pl.call_completed_at),
      ('booking_shown',      6::smallint, app.booking_shown_at),
      ('prequalified',       5::smallint,
         CASE WHEN app.has_current_project AND app.will_introduce
                   AND app.years_experience IN ('5-10','10+','y5_10','y10')
              THEN app.created_at END),
      ('applied',            4::smallint, app.created_at),
      ('onboarded',          3::smallint,
         CASE WHEN (public.contractor_onboarding_status(pe.uid) ->> 'complete')::boolean
              THEN coalesce(ob.updated_at, ob.created_at) END),
      ('account_created',    2::smallint, pr.created_at),
      -- Terminal, and ranked below everything so it sorts out of the way.
      ('rejected',           1::smallint,
         CASE WHEN app.status IN ('rejected','disqualified')
              THEN coalesce(app.decided_at, app.created_at) END)
    ) AS v(name, rank, since)
    WHERE v.since IS NOT NULL
    -- A rejection outranks the progress that came before it: somebody turned down is
    -- not still "pre-qualified", whatever they reached on the way.
    ORDER BY (v.name = 'rejected') DESC, v.rank DESC
    LIMIT 1
  ) s
  ORDER BY s.rank DESC, s.since DESC NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.admin_partner_pipeline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_pipeline() TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   The real pipeline, and the raw one:
--     SELECT count(*) FILTER (WHERE NOT is_internal) AS real,
--            count(*)                                AS raw
--       FROM public.admin_partner_pipeline() WHERE application_id IS NOT NULL;
--   And who got flagged:
--     SELECT email, full_name FROM public.profiles WHERE is_internal ORDER BY email;
