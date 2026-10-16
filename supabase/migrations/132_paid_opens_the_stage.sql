-- =========================================================
-- 132  Marking a stage paid is what opens it
--
-- WHY
--
-- There is no payment gateway. The client pays in cash, Groundwork does not track the
-- transfer, and an administrator confirms it happened — so that confirmation has to be
-- the thing that lets the work start. It was not: `confirm_funding` (090) moved a payment
-- to `funded` and wrote an audit row, and touched `project_stages` not at all, while
-- `approve_stage` (087) opened the next stage the moment the previous one completed.
-- Payment and progress were two systems that never spoke, so "mark as paid" changed
-- nothing a contractor could see.
--
-- ── What changes ────────────────────────────────────────────────────────────────────
--   · `mark_stage_paid` — one admin act: the stage is paid, any expected tranche on it is
--     confirmed, and if the stage was locked it opens. This is the button's whole job.
--   · `confirm_funding` — unchanged in what it means, but a stage whose last expected
--     tranche is now in opens, rather than waiting for somebody to notice.
--   · `approve_stage` — opens the NEXT stage only once that stage is settled. Otherwise
--     the build waits, and says in the activity log that it is waiting.
--
-- ── A stage with nothing to pay must never strand a build ───────────────────────────
-- `payments.amount` is CHECKed > 0, so a stage that costs nothing has no payment row at
-- all rather than a zero one. "Settled" therefore means NO EXPECTED INCOMING TRANCHE —
-- which is true both for a stage that has been paid and for one that was never billed.
-- Getting this backwards would lock every $0 stage forever; production has 45 of them.
--
-- ── What this does NOT do ───────────────────────────────────────────────────────────
-- It does not make Groundwork a custodian. No money moves here and none is held: this
-- records that an administrator saw payment happen, which is bookkeeping about the real
-- world, and opens the work that was waiting on it.
--
-- Run in: Supabase Dashboard > SQL Editor (after 131)
-- =========================================================

BEGIN;

-- ── Is there anything still owed on this stage? ────────────
CREATE OR REPLACE FUNCTION public.stage_funding_settled(p_stage uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.payments
     WHERE stage_id = p_stage AND direction = 'in' AND state = 'expected');
$$;

REVOKE ALL ON FUNCTION public.stage_funding_settled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_funding_settled(uuid) TO authenticated;

COMMENT ON FUNCTION public.stage_funding_settled(uuid) IS
  'True when no incoming tranche on this stage is still expected (132). A stage that was '
  'never billed has no payment row — amount is CHECKed > 0 — so it reads as settled, '
  'which is what stops a $0 stage locking a build forever.';

-- ── Opening a stage, once ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.open_stage_if_settled(p_stage uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage public.project_stages%ROWTYPE;
BEGIN
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Only a LOCKED stage opens. An active one is already open and a complete one must
  -- never reopen — paying late cannot undo a finished stage.
  IF v_stage.status <> 'locked' THEN RETURN false; END IF;
  IF NOT public.stage_funding_settled(p_stage) THEN RETURN false; END IF;

  UPDATE public.project_stages    SET status = 'active'  WHERE id = p_stage;
  UPDATE public.project_substages SET status = 'pending' WHERE stage_id = p_stage;

  -- The project follows the stage it is on, or the dashboard keeps pointing at the one
  -- that just closed.
  UPDATE public.projects
     SET current_stage = GREATEST(COALESCE(current_stage, 1), v_stage.stage_number),
         status = CASE WHEN status = 'completed' THEN status ELSE 'active' END
   WHERE id = v_stage.project_id;

  PERFORM public.log_activity(v_stage.project_id, 'stage.opened', 'project_stage', p_stage, NULL,
    jsonb_build_object('stage_number', v_stage.stage_number, 'reason', 'funding_settled'));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.open_stage_if_settled(uuid) FROM PUBLIC, anon, authenticated;

-- ── The button ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_stage_paid(p_stage uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage  public.project_stages%ROWTYPE;
  v_actor  uuid := auth.uid();
  v_count  int;
  v_opened boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator records a payment';
  END IF;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;

  -- Every tranche still expected on this stage is now in. `funding_source` says how we
  -- know, and 'staff_confirmed' is the honest answer: somebody was told, and said so.
  PERFORM set_config('app.payments_write', 'on', true);
  UPDATE public.payments
     SET state = 'funded', funding_source = 'staff_confirmed',
         confirmed_by = v_actor, confirmed_at = now(),
         note = COALESCE(NULLIF(btrim(p_note), ''), note)
   WHERE stage_id = p_stage AND direction = 'in' AND state = 'expected';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.project_stages SET payment_status = 'paid' WHERE id = p_stage;

  PERFORM public.log_activity(v_stage.project_id, 'funding.received', 'project_stage', p_stage, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_number', v_stage.stage_number, 'tranches', v_count,
      'funding_source', 'staff_confirmed', 'by', 'admin',
      'note', NULLIF(btrim(p_note), ''))));

  v_opened := public.open_stage_if_settled(p_stage);
  RETURN jsonb_build_object('stage_id', p_stage, 'tranches_confirmed', v_count, 'opened', v_opened);
END $$;

REVOKE ALL ON FUNCTION public.mark_stage_paid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_stage_paid(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.mark_stage_paid(uuid, text) IS
  'An administrator records that the client paid for this stage, in cash Groundwork does '
  'not track, and the stage opens if it was locked (132). Admin only. No money moves '
  'here — this is bookkeeping about the real world.';

CREATE OR REPLACE FUNCTION public.confirm_funding(p_payment uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay   public.payments%ROWTYPE;
  v_stage public.project_stages%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only an administrator confirms funding'; END IF;
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such payment'; END IF;
  IF v_pay.direction <> 'in' THEN RAISE EXCEPTION 'wrong_direction: only incoming funding is confirmed'; END IF;
  IF v_pay.state <> 'expected' THEN RAISE EXCEPTION 'wrong_state: payment is %', v_pay.state; END IF;

  PERFORM set_config('app.payments_write', 'on', true);
  UPDATE public.payments
     SET state = 'funded', funding_source = 'staff_confirmed',
         confirmed_by = v_actor, confirmed_at = now(), note = NULLIF(btrim(p_note), '')
   WHERE id = p_payment;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = v_pay.stage_id;
  PERFORM public.log_activity(v_pay.project_id, 'funding.received', 'payment', p_payment, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'amount', v_pay.amount, 'currency', v_pay.currency, 'funding_source', 'staff_confirmed', 'by', 'admin',
      'stage_id', v_pay.stage_id, 'stage_number', v_stage.stage_number, 'note', NULLIF(btrim(p_note), ''))));

  -- 132: confirming the last tranche a stage was waiting on opens it. Before this the
  -- money was recorded and the work stayed shut until somebody noticed.
  PERFORM public.open_stage_if_settled(v_pay.stage_id);
END $$;

-- ── The next stage waits to be paid for ────────────────────
-- 087's approve_stage verbatim, with ONE change: the next stage opens only once it is
-- settled. Reproduced in full rather than patched, because this is the only place
-- `project_stages.status` becomes 'complete' and a partial redefinition would lose the
-- lock ordering, the authorisation and the guard that depend on it.
CREATE OR REPLACE FUNCTION public.approve_stage(p_stage uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage    public.project_stages%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_admin    boolean := public.is_admin();
  v_owner    boolean;
  v_self     boolean;
  v_latest   public.stage_verifications%ROWTYPE;
  v_next     public.project_stages%ROWTYPE;
  v_final    boolean;
  v_now      timestamptz := now();
BEGIN
  -- FOR UPDATE: approval is a security-critical transition. Two admins clicking at once
  -- serialise on this lock; the second re-reads the row after the first commits, finds it
  -- already complete, and gets wrong_state — one approval, one audit row, one next-stage
  -- activation. Without the lock both would read pending_review and both would proceed.
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;

  v_owner := (v_project.user_id = auth.uid());
  v_self  := (v_project.tier IN ('self_verify', 'starter'));

  IF NOT v_admin AND NOT (v_owner AND v_self) THEN
    RAISE EXCEPTION 'not_authorized: only an administrator, or the owner of a Self Verify project, may approve a stage';
  END IF;
  IF v_stage.status NOT IN ('active', 'pending_review') THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;

  -- The owner path's own preconditions, as before (approvals.ts approveStage).
  IF NOT v_admin THEN
    IF v_stage.payment_status <> 'paid' THEN
      RAISE EXCEPTION 'not_paid: this stage has not been paid for';
    END IF;
    IF EXISTS (SELECT 1 FROM public.project_substages WHERE stage_id = p_stage AND status <> 'complete') THEN
      RAISE EXCEPTION 'substages_not_ready: not all substages are complete';
    END IF;
  END IF;

  -- The gate this migration exists for.
  IF v_stage.verification_required THEN
    SELECT * INTO v_latest FROM public.stage_verifications
     WHERE stage_id = p_stage ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND OR v_latest.decision <> 'verified' THEN
      RAISE EXCEPTION 'not_verified: independent verification is required and the latest decision is %',
        COALESCE(v_latest.decision, 'none');
    END IF;
  END IF;

  -- Lets the completion guard below know this transition is legitimate.
  PERFORM set_config('app.approve_stage', 'on', true);

  IF v_admin THEN
    UPDATE public.project_substages
       SET status = 'complete', approved_by = auth.uid(), approved_at = v_now
     WHERE stage_id = p_stage AND status <> 'complete';
  END IF;

  UPDATE public.project_stages SET status = 'complete', completed_at = v_now WHERE id = p_stage;

  v_final := (v_stage.stage_number + 1 > 10);
  IF NOT v_final THEN
    SELECT * INTO v_next FROM public.project_stages
     WHERE project_id = v_stage.project_id AND stage_number = v_stage.stage_number + 1;
    IF FOUND THEN
      -- 132: the next stage opens when it is PAID FOR, not merely because this one
      -- finished. Groundwork has no payment gateway, so an administrator confirms the
      -- client's cash and that confirmation is what opens the work. A stage with nothing
      -- to pay — no incoming tranche at all — is settled by definition and opens here as
      -- it always did, so a $0 stage never strands a build.
      IF public.stage_funding_settled(v_next.id) THEN
        UPDATE public.project_stages    SET status = 'active'  WHERE id = v_next.id;
        UPDATE public.project_substages SET status = 'pending' WHERE stage_id = v_next.id;
      ELSE
        -- Said out loud, because a stage that stays shut with no reason recorded is
        -- indistinguishable from one that failed to open.
        PERFORM public.log_activity(v_stage.project_id, 'stage.awaiting_payment',
          'project_stage', v_next.id, NULL,
          jsonb_build_object('stage_number', v_stage.stage_number + 1));
      END IF;
    END IF;
  END IF;

  UPDATE public.projects
     SET current_stage = CASE WHEN v_final THEN v_stage.stage_number ELSE v_stage.stage_number + 1 END,
         status        = CASE WHEN v_final THEN 'completed' ELSE 'active' END
   WHERE id = v_stage.project_id;

  PERFORM public.log_activity(v_stage.project_id, 'stage.approved', 'project_stage', p_stage, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_number', v_stage.stage_number, 'tier', v_project.tier,
      'approved_by_role', CASE WHEN v_admin THEN 'admin' ELSE 'owner' END,
      'verification_id', v_latest.id)));

  RETURN jsonb_build_object(
    'project_id',        v_stage.project_id,
    'stage_id',          p_stage,
    'stage_number',      v_stage.stage_number,
    'is_final',          v_final,
    'next_stage_id',     v_next.id,
    'next_stage_number', CASE WHEN v_final THEN NULL ELSE v_stage.stage_number + 1 END,
    'verification_id',   v_latest.id);
END $$;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- a stage with nothing owed reads as settled
--   SELECT public.stage_funding_settled(id), status, payment_status
--     FROM public.project_stages LIMIT 5;
--
--   -- after marking one paid:
--   --   SELECT public.mark_stage_paid('<stage uuid>', 'cash, received by Philip');
--   -- → {"tranches_confirmed": n, "opened": true}
--
--   -- what is waiting on money right now
--   SELECT p.name, s.stage_number, s.status
--     FROM public.project_stages s JOIN public.projects p ON p.id = s.project_id
--    WHERE s.status = 'locked' AND NOT public.stage_funding_settled(s.id)
--    ORDER BY p.name, s.stage_number;
