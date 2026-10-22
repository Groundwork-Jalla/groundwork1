-- =========================================================
-- 146 — The review, the decision, and the directory, inside the funnel
--
-- What 145 already shows: started-and-abandoned (138), applied, pre-qualified, sent to
-- booking, and everything after the commitment. What it skipped is the middle — the
-- part that decides whether there IS a partner:
--
--   the meeting happens  →  the application goes into REVIEW
--   staff decide         →  ACCEPTED or REJECTED
--   accepted             →  published to the client-facing directory
--
-- All three facts already exist. `contractor_applications.status` has carried
-- 'reviewing', 'accepted' and 'rejected' since 026, Accept already publishes to the
-- directory through `admin_promote_application` (033), and the applicant is already
-- emailed. The board simply never read any of it, so the funnel broke in half: it
-- showed a call being booked, then nothing until a project was activated.
--
-- Three changes:
--
--   1. A decision has a DATE. The table had no timestamp for a status change, so the
--      board had nothing to say when a stage was reached. A trigger stamps it, which
--      means every path that changes a status gets it — the admin screen, an RPC, or a
--      hand-run statement.
--
--   2. Marking the call as held moves a pending application into review, by itself.
--      This is the automation asked for: the meeting happening IS the thing that starts
--      the review, and asking somebody to remember to also change a dropdown is how a
--      queue silently fills with applications nobody is looking at.
--
--   3. The board reads review, acceptance and rejection, and says whether an accepted
--      partner actually reached the directory — because "accepted" and "visible to
--      clients" are two different facts and only one of them is what a client sees.
--
-- Rejected is TERMINAL. It ranks below everything so it sorts to the bottom, and the
-- worklist drops it, the same way an activated partner drops off.
--
-- Run in: Supabase Dashboard > SQL Editor (after 145)
-- =========================================================

BEGIN;

-- ── 1. When a decision was made ──────────────────────────
ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS reviewing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.contractor_applications.reviewing_at IS
  'When this application entered review (146). Stamped by a trigger, so every path that '
  'sets the status gets it.';
COMMENT ON COLUMN public.contractor_applications.decided_at IS
  'When it was accepted, rejected or disqualified (146).';

CREATE OR REPLACE FUNCTION public.stamp_application_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'reviewing' AND NEW.reviewing_at IS NULL THEN
      NEW.reviewing_at := now();
    END IF;
    IF NEW.status IN ('accepted', 'rejected', 'disqualified') THEN
      NEW.decided_at := now();
    ELSE
      -- Moved back out of a decision: the decision date no longer describes anything.
      NEW.decided_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamp_application_status ON public.contractor_applications;
CREATE TRIGGER stamp_application_status
  BEFORE UPDATE ON public.contractor_applications
  FOR EACH ROW EXECUTE FUNCTION public.stamp_application_status();

-- Existing decided rows get a date from what we know, rather than reading as undated.
UPDATE public.contractor_applications
   SET decided_at = coalesce(decided_at, edited_at, created_at)
 WHERE status IN ('accepted', 'rejected', 'disqualified') AND decided_at IS NULL;


-- ── 2. The meeting starts the review ─────────────────────
CREATE OR REPLACE FUNCTION public.set_partner_pipeline(
  p_user                uuid,
  p_owner               uuid    DEFAULT NULL,
  p_last_action         text    DEFAULT NULL,
  p_next_action         text    DEFAULT NULL,
  p_next_action_on      date    DEFAULT NULL,
  p_activation_deadline date    DEFAULT NULL,
  p_notes               text    DEFAULT NULL,
  p_call_completed      boolean DEFAULT NULL,
  p_committed           boolean DEFAULT NULL,
  p_agreement_signed    boolean DEFAULT NULL
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: staff only';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'user_required: whose pipeline row is this';
  END IF;

  INSERT INTO public.partner_pipeline AS t (user_id) VALUES (p_user)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.partner_pipeline t SET
    owner_id            = coalesce(p_owner, t.owner_id),
    last_action         = coalesce(p_last_action, t.last_action),
    last_action_at      = CASE WHEN p_last_action IS NOT NULL AND p_last_action IS DISTINCT FROM t.last_action
                               THEN now() ELSE t.last_action_at END,
    next_action         = coalesce(p_next_action, t.next_action),
    next_action_on      = coalesce(p_next_action_on, t.next_action_on),
    activation_deadline = coalesce(p_activation_deadline, t.activation_deadline),
    notes               = coalesce(p_notes, t.notes),
    call_completed_at   = CASE WHEN p_call_completed IS NULL THEN t.call_completed_at
                               WHEN p_call_completed THEN coalesce(t.call_completed_at, now())
                               ELSE NULL END,
    committed_at        = CASE WHEN p_committed IS NULL THEN t.committed_at
                               WHEN p_committed THEN coalesce(t.committed_at, now())
                               ELSE NULL END,
    agreement_signed_at = CASE WHEN p_agreement_signed IS NULL THEN t.agreement_signed_at
                               WHEN p_agreement_signed THEN coalesce(t.agreement_signed_at, now())
                               ELSE NULL END,
    updated_at          = now(),
    updated_by          = auth.uid()
  WHERE t.user_id = p_user;

  -- The meeting having happened is what starts the review (146). Only from 'pending':
  -- an application already accepted or rejected is not dragged back by a late tick, and
  -- one already reviewing is left where it is.
  IF p_call_completed THEN
    UPDATE public.contractor_applications
       SET status = 'reviewing'
     WHERE user_id = p_user AND source = 'in_app' AND status = 'pending';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_partner_pipeline(uuid, uuid, text, text, date, date, text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_partner_pipeline(uuid, uuid, text, text, date, date, text, boolean, boolean, boolean) TO authenticated;


-- ── 3. The board reads the decision ──────────────────────
--
-- Dropped first, not replaced. This function gains two columns below
-- (`application_status`, `in_directory`), and CREATE OR REPLACE cannot change a
-- function's return type — Postgres refuses with 42P13 "cannot change return type of
-- existing function", because the row type defined by its OUT parameters is different.
--
-- Safe here: the drop is inside this transaction, so a later failure takes it back with
-- everything else; nothing in the schema depends on this function (only a comment in 145
-- mentions it); and the app reaches it by RPC name, which resolves per call. The
-- REVOKE/GRANT below reissues the permissions the drop removes.
--
-- No CASCADE, deliberately. If something ever does depend on this, the drop should fail
-- loudly rather than quietly delete the dependant.
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
  in_directory        boolean
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
             WHERE (d.application_id = app.app_id OR d.user_id = pe.uid) AND d.active)
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
--   Marking a call moves a pending application into review:
--     SELECT public.set_partner_pipeline('<uuid>', NULL,NULL,NULL,NULL,NULL,NULL, true);
--     SELECT status FROM public.contractor_applications WHERE user_id = '<uuid>';  → reviewing
--   And the board shows it, then the decision:
--     SELECT full_name, stage, application_status, in_directory FROM public.admin_partner_pipeline();
