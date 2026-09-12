-- =========================================================
-- 089  One activity source: project_audit_log grows entity and person columns
--
-- Phase 4 of the admin re-architecture, migration 5 of 7
-- (docs/groundwork-admin/04-implementation-plan.md §2; Phase 2 §5; Phase 3 §7).
-- Depends on 086 (log_activity) and by sequence on 087/088, whose rows it backfills.
--
-- WHAT THIS IS NOT. Not a second table. `project_audit_log` (004) has been the record of
-- what happened on a project since Phase 3 of the original build; 084 reads it for the
-- overview, 086–088 write to it through log_activity(). The Project Workspace timeline
-- (Phase 5) and a person-level feed (Phase 7) are projections of this one table. No
-- `activities`, `timeline_events`, `project_events`; no cached summaries; no lifecycle
-- state — an audit row records that something happened, it never says what state a thing
-- is in now.
--
-- WHAT CHANGES.
--   1. Three nullable columns: entity_type / entity_id (what the row is about — a stage, a
--      verification, a site update, an invite) and person_id (who it is about, when it is
--      about a person — the verifier assigned, the contractor put on a project, the client
--      provisioned). actor_id stays what it was: who did it.
--   2. project_id becomes nullable. A client being provisioned has no project yet; that
--      row is real activity and belongs here, not in a side table. The owner SELECT
--      policy is unchanged and a NULL project_id matches no owner — such rows are visible
--      to admins only, which is the intended reading until Phase 7 decides otherwise.
--   3. log_activity() writes the columns instead of tucking the values into `details`
--      (086 said it would). Same signature; 086/087/088 callers are untouched.
--   4. Backfill, conservative and idempotent: (a) rows 086's log_activity wrote carry the
--      three values inside `details` — those are promoted verbatim; (b) rows with a
--      stage_id are about that stage. Nothing else is touched. `admin_assigned_contractor`
--      (029) has only an email in details and `tier_changed` (060) names no entity; those
--      rows are left as they are rather than given a mapping the data does not prove.
--      `details` is never rewritten.
--   5. The two remaining BROWSER writers of audit rows — `stage_submitted_for_review` and
--      `rework_requested` in approvals.ts — move into SQL as submit_stage_for_review() and
--      request_rework(), each writing its state change and its audit row in one
--      transaction. The INSERT policies that allowed browser rows (004, 009) are dropped:
--      the old admin policy accepted any row whose actor_id was the caller, for ANY
--      project, and the owner policy accepted any actor_id at all. An audit row now
--      exists only because a definer function wrote it. Action names are kept, so 084's
--      overview reader and the en/fr labels keep working, and history reads the same.
--   6. admin_assign_contractor() (029) logs through log_activity with the invite as the
--      entity and — when the address already belongs to an account — the contractor as
--      the person.
--
-- Run in: Supabase Dashboard > SQL Editor (after 088)
-- =========================================================

-- ── 1. Columns ───────────────────────────────────────────
ALTER TABLE public.project_audit_log ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.project_audit_log
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id   uuid,
  ADD COLUMN IF NOT EXISTS person_id   uuid;
-- person_id deliberately carries NO foreign key (the 069 tombstone rule). A row that says
-- "this client was provisioned" must outlive the account: with ON DELETE SET NULL the row
-- would become about nobody — and, having no project either, would violate has_subject
-- below and block the deletion itself. entity_id is polymorphic and likewise unkeyed.

-- A row is about a project, a person, or both — never nothing. And an entity is named
-- fully or not at all. Every existing row has a project_id and no entity, so both hold
-- before the backfill runs.
ALTER TABLE public.project_audit_log DROP CONSTRAINT IF EXISTS project_audit_log_has_subject;
ALTER TABLE public.project_audit_log ADD CONSTRAINT project_audit_log_has_subject
  CHECK (project_id IS NOT NULL OR person_id IS NOT NULL);
ALTER TABLE public.project_audit_log DROP CONSTRAINT IF EXISTS project_audit_log_entity_pair;
ALTER TABLE public.project_audit_log ADD CONSTRAINT project_audit_log_entity_pair
  CHECK ((entity_type IS NULL) = (entity_id IS NULL));

CREATE INDEX IF NOT EXISTS project_audit_log_entity_idx
  ON public.project_audit_log (entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_audit_log_person_idx
  ON public.project_audit_log (person_id, created_at DESC) WHERE person_id IS NOT NULL;
-- Not in the plan's line for 089, added here: the table has had no index at all, and
-- both the owner policy and 084's reader filter by project_id. The timeline will too.
CREATE INDEX IF NOT EXISTS project_audit_log_project_idx
  ON public.project_audit_log (project_id, created_at DESC);

-- ── 2. The writer ────────────────────────────────────────
-- Same signature as 086. Writes the columns; keeps the legacy stage_id coherent when the
-- entity is a stage, so readers that predate this migration see nothing different.
CREATE OR REPLACE FUNCTION public.log_activity(
  p_project     uuid,
  p_action      text,
  p_entity_type text    DEFAULT NULL,
  p_entity_id   uuid    DEFAULT NULL,
  p_person      uuid    DEFAULT NULL,
  p_details     jsonb   DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (p_entity_type IS NULL) <> (p_entity_id IS NULL) THEN
    RAISE EXCEPTION 'bad_entity: entity_type and entity_id are given together or not at all';
  END IF;
  IF p_project IS NULL AND p_person IS NULL THEN
    RAISE EXCEPTION 'no_subject: an activity is about a project, a person, or both';
  END IF;
  INSERT INTO public.project_audit_log
    (project_id, stage_id, action, actor_id, details, entity_type, entity_id, person_id)
  VALUES (
    p_project,
    CASE WHEN p_entity_type = 'project_stage' THEN p_entity_id END,
    p_action, auth.uid(), COALESCE(p_details, '{}'::jsonb),
    p_entity_type, p_entity_id, p_person
  );
END;
$$;
REVOKE ALL ON FUNCTION public.log_activity(uuid, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 3. Backfill ──────────────────────────────────────────
-- (a) Rows written by 086's log_activity: the values are in `details`, put there by the
--     writer itself. Promote them. Each must parse as a uuid; details is left exactly as
--     it was.
UPDATE public.project_audit_log a
   SET entity_type = a.details->>'entity_type',
       entity_id   = (a.details->>'entity_id')::uuid,
       person_id   = CASE
                       WHEN (a.details->>'person_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN (a.details->>'person_id')::uuid
                     END
 WHERE a.entity_type IS NULL
   AND a.details ? 'entity_type'
   AND (a.details->>'entity_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- (a') Those about a stage get the legacy column too, when the stage still exists.
UPDATE public.project_audit_log a
   SET stage_id = a.entity_id
 WHERE a.stage_id IS NULL AND a.entity_type = 'project_stage'
   AND EXISTS (SELECT 1 FROM public.project_stages s WHERE s.id = a.entity_id);

-- (b) Rows that name a stage are about that stage.
UPDATE public.project_audit_log
   SET entity_type = 'project_stage', entity_id = stage_id
 WHERE entity_type IS NULL AND stage_id IS NOT NULL;

-- ── 4. Browser writes end ────────────────────────────────
DROP POLICY IF EXISTS "owner_insert_audit_log" ON public.project_audit_log;
DROP POLICY IF EXISTS "admin_insert_audit_log" ON public.project_audit_log;
-- SELECT policies (owner_read_audit_log, admin_select_all_audit_log) are unchanged.

-- ── 5. The two writers that were still in the browser ────

-- Owner submits a stage for review (the non-self-verify path of approvals.approveStage).
-- Same preconditions the browser checked — paid, every substage pending_review or
-- complete — plus the one it did not: the stage must be active.
CREATE OR REPLACE FUNCTION public.submit_stage_for_review(p_stage uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage   public.project_stages%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_actor   uuid := auth.uid();
BEGIN
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;
  IF v_project.user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'not_owner: only the project owner submits a stage for review';
  END IF;
  IF v_project.tier IN ('self_verify', 'starter') THEN
    RAISE EXCEPTION 'self_verify: a Self Verify stage is approved with approve_stage(), not submitted';
  END IF;
  IF v_stage.status <> 'active' THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;
  IF v_stage.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'not_paid: this stage has not been paid for';
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_substages
              WHERE stage_id = p_stage AND status NOT IN ('pending_review', 'complete')) THEN
    RAISE EXCEPTION 'substages_not_ready: every substage must be pending review or complete';
  END IF;

  UPDATE public.project_stages SET status = 'pending_review' WHERE id = p_stage;

  PERFORM public.log_activity(v_stage.project_id, 'stage_submitted_for_review', 'project_stage', p_stage, NULL,
    jsonb_build_object('tier', v_project.tier, 'stage_number', v_stage.stage_number));
END $$;

-- Admin sends a stage back (approvals.adminRequestRework). Stage returns to active, the
-- substages that were up for review return to in_progress. Bell and email stay in the
-- browser, after this returns, as before.
CREATE OR REPLACE FUNCTION public.request_rework(p_stage uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage public.project_stages%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only an administrator requests rework'; END IF;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  IF v_stage.status <> 'pending_review' THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;

  UPDATE public.project_stages SET status = 'active' WHERE id = p_stage;
  UPDATE public.project_substages
     SET status = 'in_progress', approved_by = NULL, approved_at = NULL
   WHERE stage_id = p_stage AND status = 'pending_review';

  PERFORM public.log_activity(v_stage.project_id, 'rework_requested', 'project_stage', p_stage, NULL,
    jsonb_strip_nulls(jsonb_build_object('stage_number', v_stage.stage_number, 'reason', NULLIF(btrim(p_reason), ''))));
END $$;

REVOKE ALL ON FUNCTION public.submit_stage_for_review(uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_rework(uuid, text)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_stage_for_review(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.request_rework(uuid, text)    TO authenticated;

-- ── 6. admin_assign_contractor logs with an entity and a person ──
-- Body from 029, unchanged except the audit call.
CREATE OR REPLACE FUNCTION public.admin_assign_contractor(
  p_project_id uuid,
  p_email      text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite_id uuid;
  v_person    uuid;
  v_email     text := lower(trim(p_email));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  INSERT INTO public.contractor_invites (project_id, invited_by, email, role, status, accepted_at)
  VALUES (p_project_id, auth.uid(), v_email, 'contractor', 'accepted', now())
  ON CONFLICT (project_id, email) DO UPDATE
    SET status      = 'accepted',
        accepted_at = COALESCE(public.contractor_invites.accepted_at, now())
  RETURNING id INTO v_invite_id;

  -- The person, when the address already belongs to an account. Otherwise NULL: the
  -- email in details is the only thing known, and that is what is recorded.
  SELECT id INTO v_person FROM public.profiles WHERE lower(email) = v_email LIMIT 1;

  PERFORM public.log_activity(p_project_id, 'admin_assigned_contractor', 'contractor_invite', v_invite_id, v_person,
    jsonb_build_object('email', v_email));

  RETURN v_invite_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_assign_contractor(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_assign_contractor(uuid, text) TO authenticated;

COMMENT ON COLUMN public.project_audit_log.entity_type IS
  'What the row is about: project_stage, stage_verification, site_update, project_verifier, contractor_invite, profile. Given with entity_id or not at all. See 089.';
COMMENT ON COLUMN public.project_audit_log.person_id IS
  'Who the row is about, when it is about a person (the verifier assigned, the contractor placed, the client provisioned). Not the actor — that is actor_id.';
COMMENT ON TABLE public.project_audit_log IS
  'The one record of what happened. Written only by definer functions (log_activity and the '
  'tier guard); read by the overview (084), the Project Workspace timeline and any person feed. '
  'Never stores state — see 089.';

-- ── Verify ───────────────────────────────────────────────
-- Three rows: the columns; then the promoted/left-alone split.
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'project_audit_log' AND column_name IN ('entity_type', 'entity_id', 'person_id') ORDER BY 1;
SELECT coalesce(entity_type, '(none)') AS entity_type, count(*) FROM public.project_audit_log GROUP BY 1 ORDER BY 2 DESC;
