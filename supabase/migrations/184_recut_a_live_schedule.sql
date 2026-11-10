-- =========================================================
-- 184  Re-cutting the schedule of a build that is already running
--
-- ── WHAT 183 LEFT UNDONE ───────────────────────────────────────────────────────────
--
-- 183 widened `budget_pct` and the application began writing each building's own split
-- from its take-off. Only at CREATION. Every caller of `apply_budget_milestones` — 036,
-- 042, 072, 103, 109, 121, 162 — is a one-time creation or join step, so a project that
-- started before the fix keeps the national-average split for ever.
--
-- 183's own header said "a live project that needs re-cutting goes through a re-price".
-- That was wrong when it was written: no such path existed. This is it.
--
-- Philip, 10 Nov 2026, looking at exactly such a project: "why is the costing still same
-- thing / we had a discussion".
--
-- ── MONEY THAT HAS MOVED IS NOT RE-CUT ─────────────────────────────────────────────
--
-- A paid stage is a figure a client transferred and a contractor received, against a
-- receipt somebody is holding. Rewriting it would put the schedule out of step with the
-- ledger and with the real world. So this function REFUSES to touch a stage that is
-- paid, complete or pre-existing — not by trusting the caller to send the right ids,
-- but by re-checking every row it is asked to write.
--
-- The arithmetic that decides the new figures lives in TypeScript (`budget/reprice.ts`),
-- as it does for every other path into `project_stages`, so the same numbers an
-- administrator approved in the preview are the numbers written. This function's job is
-- authorisation and refusal, not pricing.
--
-- ── WHY IT WRITES THE MILESTONE AND NOT ONLY THE PERCENTAGE ────────────────────────
--
-- `apply_budget_milestones` derives `payment_milestone_usd` from `budget_pct`, so the
-- two must agree the moment this returns or the next re-price would compute from a
-- percentage that no longer matches the amount on screen. Both are written together,
-- in one statement, from figures the caller has already reconciled.
--
-- Run in: Supabase Dashboard > SQL Editor (after 183)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reprice_project_stages(
  p_project uuid,
  p_rows    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_written int  := 0;
  v_refused int  := 0;
  v_ids     uuid[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  -- Staff only. A re-cut changes what a client will be asked to pay on every remaining
  -- stage of a live build; it is not a self-service act for either party to it.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized: only an administrator may re-price a live schedule';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'nothing_to_write: no stages were supplied';
  END IF;

  -- Lock the whole schedule for the duration. Two administrators re-pricing the same
  -- project at once would otherwise interleave and leave a split that sums to neither
  -- of their previews.
  PERFORM 1 FROM public.project_stages WHERE project_id = p_project FOR UPDATE;

  WITH incoming AS (
    SELECT (r->>'stageId')::uuid       AS id,
           (r->>'budgetPct')::numeric  AS pct,
           (r->>'milestoneUsd')::numeric AS amount
      FROM jsonb_array_elements(p_rows) r
  ),
  -- Re-checked HERE, not taken on trust. The caller computed which stages were settled;
  -- this decides it again against the rows as they are now, so a stale preview or a
  -- hand-made call cannot rewrite a stage that has since been paid.
  allowed AS (
    SELECT i.*
      FROM incoming i
      JOIN public.project_stages s ON s.id = i.id
     WHERE s.project_id = p_project
       AND COALESCE(s.pre_existing, false) = false
       AND COALESCE(s.payment_status, 'unpaid') <> 'paid'
       AND s.status <> 'complete'
       AND COALESCE(s.fixed_amount_usd, 0) = 0
       AND i.pct >= 0
       AND i.amount >= 0
  ),
  written AS (
    UPDATE public.project_stages s
       SET budget_pct            = a.pct,
           payment_milestone_usd = ROUND(a.amount)
      FROM allowed a
     WHERE s.id = a.id
    RETURNING s.id
  )
  SELECT array_agg(id) INTO v_ids FROM written;

  v_written := COALESCE(array_length(v_ids, 1), 0);
  v_refused := jsonb_array_length(p_rows) - v_written;

  IF v_written = 0 THEN
    RAISE EXCEPTION 'nothing_written: every stage supplied is settled, fixed or not on this project';
  END IF;

  -- Said out loud, with the figures, because this is a staff member changing what a
  -- client will be billed on a build already under way. A re-cut that leaves no trace
  -- is indistinguishable from the schedule having always been this way.
  PERFORM public.log_activity(p_project, 'project.repriced', 'project', p_project, v_actor,
    jsonb_build_object('stages_written', v_written, 'stages_refused', v_refused,
                       'rows', p_rows));

  RETURN jsonb_build_object(
    'project_id',     p_project,
    'stages_written', v_written,
    'stages_refused', v_refused);
END $$;

REVOKE ALL ON FUNCTION public.reprice_project_stages(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprice_project_stages(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.reprice_project_stages(uuid, jsonb) IS
  'Re-cut the remaining stage milestones of a live project from its own take-off (184). '
  'Administrator only. Refuses every stage that is paid, complete, pre-existing or '
  'carrying a fixed fee, re-checked against the rows as they stand rather than trusted '
  'from the caller. Writes budget_pct and payment_milestone_usd together so the two '
  'cannot disagree. The arithmetic is budget/reprice.ts; this authorises and refuses.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- a paid stage is refused even when it is named
--   SELECT public.reprice_project_stages(
--            '<project>',
--            jsonb_build_array(jsonb_build_object(
--              'stageId', '<a paid stage>', 'budgetPct', 1, 'milestoneUsd', 1)));
--   -- expect: nothing_written
--
--   -- after a re-cut, every milestone still derives from its own percentage
--   SELECT stage_number, budget_pct, payment_milestone_usd
--     FROM public.project_stages WHERE project_id = '<project>' ORDER BY stage_number;
