-- =========================================================
-- 154 — A rejection after a meeting says why, too
--
-- 153 gave the board the reason the FORM ended an application. The other ending had
-- none: rejecting after a call is `UPDATE ... SET status = 'rejected'` and nothing
-- else. Ruth decides, the applicant is emailed, and three weeks later nobody can say
-- what was wrong — not to answer the applicant, and not to see a pattern across them.
--
-- That is the worse of the two gaps. A form rejection is mechanical and its reason is
-- implied by the answers; a human rejection holds the judgement, and that judgement is
-- the thing worth keeping.
--
-- ── A list, and a sentence ──────────────────────────────────────────────────────────
-- `decision_reason` is a short closed list so it can be counted — "four of the last ten
-- could not be reached" is a finding, where ten paragraphs are not. `decision_note`
-- carries what the list cannot. Both optional: a decision must never be blocked by a
-- form field, and an accepted application usually needs neither.
--
-- ── One ending on the board ─────────────────────────────────────────────────────────
-- The board stops returning `disqualified_reason` on its own and returns the ending
-- whichever side produced it, with a source beside it. A row that says "rejected" with
-- nothing next to it is the thing this removes.
--
-- Run in: Supabase Dashboard > SQL Editor (after 153)
-- =========================================================

BEGIN;

ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS decision_note   TEXT,
  ADD COLUMN IF NOT EXISTS decided_by      UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.contractor_applications.decision_reason IS
  'Why a PERSON rejected this, after speaking to them (154). A closed list so it can be '
  'counted; decision_note carries what the list cannot.';
COMMENT ON COLUMN public.contractor_applications.decision_note IS
  'The sentence behind the decision (154). Internal — never sent to the applicant.';
COMMENT ON COLUMN public.contractor_applications.decided_by IS
  'Which member of staff decided (154).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_applications_decision_reason') THEN
    ALTER TABLE public.contractor_applications
      ADD CONSTRAINT contractor_applications_decision_reason
      CHECK (decision_reason IS NULL OR decision_reason IN (
        'not_enough_experience',   -- the work history did not hold up on the call
        'no_suitable_project',     -- the project turned out not to fit
        'quality_concerns',        -- what they showed us
        'unreachable',             -- never showed, never replied
        'declined_terms',          -- would not work to milestones or verification
        'other'));
  END IF;
END $$;

-- Counting rejections by reason is the whole point; almost every row is NULL.
CREATE INDEX IF NOT EXISTS contractor_applications_decision_reason
  ON public.contractor_applications (decision_reason)
  WHERE decision_reason IS NOT NULL;


-- ── The board reports one ending ─────────────────────────
-- Dropped first: the OUT parameters change, and CREATE OR REPLACE cannot change a
-- function's row type (42P13).
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
  is_internal         boolean,
  -- One ending, however it came about (154). `ended_source` says which, because the
  -- follow-up differs: one of them has spoken to us and one never has.
  ended_reason        text,
  ended_source        text,
  ended_note          text
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
           a.years_experience, a.booking_shown_at, a.status, a.reviewing_at, a.decided_at,
           a.disqualified_reason, a.will_use_groundwork,
           a.decision_reason, a.decision_note
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
    coalesce(pr.is_internal, false),
    -- Why it ended, from whichever side ended it (154).
    coalesce(app.disqualified_reason, app.decision_reason),
    CASE WHEN app.disqualified_reason IS NOT NULL THEN 'form'
         WHEN app.decision_reason     IS NOT NULL THEN 'staff' END,
    app.decision_note
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
      -- Pre-qualified, under both forms.
      --
      -- The new application (152) no longer asks "will you introduce the client", and
      -- experience no longer gates anything — so reaching the end of it IS qualifying:
      -- they have a live project, a client who cannot be on site, and the intention to
      -- run it here. `will_use_groundwork` being answered is what marks that form.
      -- Applications filed before it keep the old two-condition test, so the board does
      -- not rewrite its own history.
      ('prequalified',       5::smallint,
         CASE WHEN app.status <> 'disqualified' AND app.has_current_project AND (
                     app.will_use_groundwork IS NOT NULL
                  OR (app.will_introduce
                      AND app.years_experience IN ('5-10','10+','y5_10','y10')))
              THEN app.created_at END),
      ('applied',            4::smallint, app.created_at),
      ('onboarded',          3::smallint,
         CASE WHEN (public.contractor_onboarding_status(pe.uid) ->> 'complete')::boolean
              THEN coalesce(ob.updated_at, ob.created_at) END),
      ('account_created',    2::smallint, pr.created_at),
      -- Two terminal stages, not one. Somebody the FORM turned away at question nine
      -- and somebody Ruth turned down after a call are different people needing
      -- different follow-up, and "no project yet" is a matter of time rather than a
      -- judgement. Collapsing them lost that (153).
      ('rejected',           1::smallint,
         CASE WHEN app.status = 'rejected'
              THEN coalesce(app.decided_at, app.created_at) END),
      ('disqualified',       0::smallint,
         CASE WHEN app.status = 'disqualified'
              THEN coalesce(app.decided_at, app.created_at) END)
    ) AS v(name, rank, since)
    WHERE v.since IS NOT NULL
    -- An ending outranks the progress that came before it: somebody turned down, or
    -- stopped by the form, is not still "pre-qualified" whatever they reached on the way.
    ORDER BY (v.name IN ('rejected', 'disqualified')) DESC, v.rank DESC
    LIMIT 1
  ) s
  ORDER BY s.rank DESC, s.since DESC NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.admin_partner_pipeline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_pipeline() TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Every ending carries a reason and says who ended it:
--     SELECT full_name, stage, ended_source, ended_reason, ended_note
--       FROM public.admin_partner_pipeline()
--      WHERE stage IN ('rejected', 'disqualified');
--   And the pattern across them:
--     SELECT ended_source, ended_reason, count(*)
--       FROM public.admin_partner_pipeline()
--      WHERE ended_reason IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC;
