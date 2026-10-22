-- =========================================================
-- 145 — The partner pipeline, per applicant
--
-- Philip's rule: "No qualified applicant should remain in the pipeline without a current
-- stage, a last action, a next action, a responsible owner, a next-action date, and a
-- 14-day activation deadline."
--
-- 136 gave the funnel as COUNTS. Counts say where people are lost; they do not say who
-- to ring this morning. This is the worklist.
--
-- ── Derive everything the system knows ───────────────────
-- Eight of the eleven stages are already facts in this database:
--
--   account created      a contractor role                      (user_roles)
--   onboarded            contractor_onboarding_status.complete  (116/142)
--   applied              an in-app application                  (133)
--   pre-qualified        live project + will introduce + 5 yrs  (133)
--   sent to booking      booking_shown_at                       (136)
--   client introduced    contractor_clients                     (109)
--   client accepted      contractor_clients.accepted_at         (109)
--   project activated    projects.tracking_started_at
--
-- Only three need a person, because nothing in the product observes them: the call
-- happening, the commitment being given, and the partnership agreement being signed.
-- Outreach is the fourth and lives outside Groundwork entirely.
--
-- Asking staff to maintain a stage the database already answers is how a tracker rots:
-- the derived half goes stale, nobody trusts either half, and it gets abandoned. So the
-- stored table holds ONLY what cannot be observed, and the board computes the rest live.
--
-- Run in: Supabase Dashboard > SQL Editor (after 144)
-- =========================================================

BEGIN;

-- ── What a person has to tell us ─────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_pipeline (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Who is responsible. Null is itself a finding: it means nobody owns this person.
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- The three the product cannot see for itself.
  call_completed_at   timestamptz,
  committed_at        timestamptz,
  agreement_signed_at timestamptz,

  -- What happened, and what happens next.
  last_action    text,
  last_action_at timestamptz,
  next_action    text,
  next_action_on date,

  -- Philip's fourteen days. Defaulted from the call when one is recorded, and
  -- overridable — a deadline somebody cannot move is a deadline they ignore.
  activation_deadline date,

  notes      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.partner_pipeline IS
  'The staff-maintained half of the partner pipeline (145). Holds only what Groundwork '
  'cannot observe: the call, the commitment, the signed agreement, and who is chasing. '
  'Every other stage is derived live by admin_partner_pipeline().';

CREATE INDEX IF NOT EXISTS partner_pipeline_next_action
  ON public.partner_pipeline (next_action_on) WHERE next_action_on IS NOT NULL;

ALTER TABLE public.partner_pipeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_pipeline"  ON public.partner_pipeline;
DROP POLICY IF EXISTS "admins_write_pipeline" ON public.partner_pipeline;

-- Staff only, in both directions. These rows are internal notes about a named person.
CREATE POLICY "admins_read_pipeline"
  ON public.partner_pipeline FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admins_write_pipeline"
  ON public.partner_pipeline FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_pipeline TO authenticated;


-- ── The board ────────────────────────────────────────────
--
-- One row per contractor who has entered the funnel, with the furthest stage they have
-- reached. Stages are returned as a rank AND a name so the caller can sort without
-- knowing the order.
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
  days_in_stage       integer
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: staff only';
  END IF;

  RETURN QUERY
  WITH people AS (
    -- Everyone holding the contractor role. The role, not `holds_contractor_access`:
    -- somebody invited onto one project by a client arrived through that client, not
    -- through outreach, and does not belong on this board.
    SELECT r.user_id AS uid
      FROM public.user_roles r
     WHERE r.role = 'contractor'
  ),
  app AS (
    SELECT DISTINCT ON (a.user_id)
           a.user_id, a.created_at, a.has_current_project, a.will_introduce,
           a.years_experience, a.booking_shown_at, a.status
      FROM public.contractor_applications a
     WHERE a.source = 'in_app' AND a.user_id IS NOT NULL
     ORDER BY a.user_id, a.created_at DESC
  ),
  intro AS (
    SELECT c.contractor_id AS uid,
           min(c.invited_at)  AS first_invited,
           min(c.accepted_at) AS first_accepted
      FROM public.contractor_clients c
     GROUP BY c.contractor_id
  ),
  activated AS (
    SELECT c.contractor_id AS uid, min(p.tracking_started_at) AS first_activated
      FROM public.contractor_clients c
      JOIN public.projects p ON p.user_id = c.client_id
     WHERE p.tracking_started_at IS NOT NULL
     GROUP BY c.contractor_id
  )
  SELECT
    pe.uid,
    pr.full_name,
    pr.email,
    pr.phone,
    coalesce(NULLIF(ob.specialty, 'other'), ob.specialty_other, ob.specialty),
    s.name,
    s.rank,
    pl.owner_id,
    own.full_name,
    pl.last_action,
    pl.last_action_at,
    pl.next_action,
    pl.next_action_on,
    -- Fourteen days from the call, unless somebody has set a date themselves.
    coalesce(pl.activation_deadline, (pl.call_completed_at + interval '14 days')::date),
    pl.notes,
    app.created_at,
    s.since,
    greatest(0, (CURRENT_DATE - s.since::date))
  FROM people pe
  LEFT JOIN public.profiles pr            ON pr.id = pe.uid
  LEFT JOIN public.contractor_onboarding ob ON ob.user_id = pe.uid
  LEFT JOIN app                            ON app.user_id = pe.uid
  LEFT JOIN intro                          ON intro.uid = pe.uid
  LEFT JOIN activated act                  ON act.uid = pe.uid
  LEFT JOIN public.partner_pipeline pl     ON pl.user_id = pe.uid
  LEFT JOIN public.profiles own            ON own.id = pl.owner_id
  CROSS JOIN LATERAL (
    -- The furthest stage reached, and when it was reached. Ordered latest first, so the
    -- first arm that matches is the answer.
    SELECT * FROM (VALUES
      ('activated',         11::smallint, act.first_activated),
      ('client_introduced', 10::smallint, intro.first_invited),
      ('agreement_signed',   9::smallint, pl.agreement_signed_at),
      ('committed',          8::smallint, pl.committed_at),
      ('call_completed',     7::smallint, pl.call_completed_at),
      ('booking_shown',      6::smallint, app.booking_shown_at),
      ('prequalified',       5::smallint,
         CASE WHEN app.has_current_project AND app.will_introduce
                   AND app.years_experience IN ('5-10', '10+', 'y5_10', 'y10')
              THEN app.created_at END),
      ('applied',            4::smallint, app.created_at),
      ('onboarded',          3::smallint,
         CASE WHEN (public.contractor_onboarding_status(pe.uid) ->> 'complete')::boolean
              THEN coalesce(ob.updated_at, ob.created_at) END),
      ('account_created',    2::smallint, pr.created_at)
    ) AS v(name, rank, since)
    WHERE v.since IS NOT NULL
    ORDER BY v.rank DESC
    LIMIT 1
  ) s
  ORDER BY s.rank DESC, s.since DESC NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.admin_partner_pipeline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_pipeline() TO authenticated;

COMMENT ON FUNCTION public.admin_partner_pipeline() IS
  'The partner worklist (145): one row per contractor, at the furthest stage they have '
  'reached. Eight stages are derived live from the data; only the call, the commitment '
  'and the signed agreement come from partner_pipeline, because nothing observes those.';


-- ── Recording what a person did ──────────────────────────
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
    -- A new last action stamps itself; passing nothing leaves the old one alone.
    last_action         = coalesce(p_last_action, t.last_action),
    last_action_at      = CASE WHEN p_last_action IS NOT NULL AND p_last_action IS DISTINCT FROM t.last_action
                               THEN now() ELSE t.last_action_at END,
    next_action         = coalesce(p_next_action, t.next_action),
    next_action_on      = coalesce(p_next_action_on, t.next_action_on),
    activation_deadline = coalesce(p_activation_deadline, t.activation_deadline),
    notes               = coalesce(p_notes, t.notes),
    -- Each milestone is a timestamp, set once when it is ticked and cleared if untiked.
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
END $$;

REVOKE ALL ON FUNCTION public.set_partner_pipeline(uuid, uuid, text, text, date, date, text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_partner_pipeline(uuid, uuid, text, text, date, date, text, boolean, boolean, boolean) TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT stage, count(*) FROM public.admin_partner_pipeline() GROUP BY stage;
--     → everyone holding the contractor role, at their furthest stage
--   SELECT public.set_partner_pipeline('<uuid>', NULL, 'Called, no answer', 'Try WhatsApp', CURRENT_DATE + 2);
--     → last_action stamped, next action dated
