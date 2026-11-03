-- The client approves, uploads the receipt, the contractor confirms, the stage opens.
--
-- ── FIRST: A REGRESSION 174 INTRODUCED, REPAIRED ───────────────────────────────────
--
-- 174 rebuilt `approve_stage` to admit the invited client, and it built on 087's body
-- rather than 132's. 132 is the later one, and the difference is the whole of this
-- feature: it stopped approval from opening the next stage outright and made it wait
-- until that stage was PAID FOR. Rewriting from 087 silently put that back, so for as
-- long as 174 stands alone, approving a stage opens the next one whether or not anybody
-- has paid a franc. It also dropped `completed_at`, the ten-stage finality rule, the
-- `stage.awaiting_payment` log line and 132's return payload.
--
-- `CREATE OR REPLACE` on a function two migrations have touched is how this happens:
-- nothing conflicts, nothing warns, and the older body simply wins. Repaired below by
-- rebuilding on 132 and re-applying 174's two changes on top.
--
-- ── THEN: THE HANDSHAKE ────────────────────────────────────────────────────────────
--
-- Favour, 3 Nov 2026, on what the approve button should set off:
--
--   "Once they click approve stage, the next thing that should show is upload payment
--    receipt. For next stage, and when they upload it, the contractor should be able to
--    receive it and see it. And the contractor will now click confirm. When the
--    contractor confirms, then that stage unlocks automatically."
--
-- So the payment is for the NEXT stage, and the confirmation is the CONTRACTOR's. 132
-- had the first half already — a stage opens when its funding is settled — but the only
-- way to settle it was `mark_stage_paid`, which is admin-only. On a contractor-run build
-- that puts a staff member in the middle of every single stage transition, which is not
-- a product, it is a queue.
--
-- Three states on the incoming tranche, each a real moment somebody can see:
--
--   expected          nobody has paid
--   receipt_submitted the client says they paid, and attached proof
--   funded            the contractor agrees they were paid
--
-- Only `funded` settles. That is the point of the middle state: uploading a receipt must
-- not open anything by itself, or the "confirm" step is decoration and a client could
-- advance their own build with a photograph of nothing.
--
-- ── GROUNDWORK STILL HOLDS NOTHING ─────────────────────────────────────────────────
--
-- No money moves here and none is held. The client pays the contractor directly, in
-- cash or by bank transfer Groundwork never touches; this records that the contractor
-- says it arrived. Same bookkeeping-about-the-real-world as 132, with the person who
-- actually knows doing the confirming instead of a staff member relaying it.
--
-- Run in: Supabase Dashboard > SQL Editor (after 174)

BEGIN;

-- ── 1. The ledger learns a middle state ────────────────────
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_state_by_direction;
ALTER TABLE public.payments ADD CONSTRAINT payments_state_by_direction CHECK (
  (direction = 'in'  AND state IN ('expected', 'receipt_submitted', 'funded', 'reconciled')) OR
  (direction = 'out' AND state IN ('release_authorised', 'initiated', 'disbursed', 'failed', 'reconciling'))
);

-- Who established that the money arrived. 'contractor_confirmed' is as honest as
-- 'staff_confirmed' and names a different person: the one the money was paid TO.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_funding_source_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_funding_source_check CHECK (
  funding_source IS NULL
  OR funding_source IN ('provider', 'staff_confirmed', 'contractor_confirmed')
);

-- The proof itself. A storage path, like evidence_urls — the bucket is already
-- member-readable (092) and member-writable (131), so the client can put it there and
-- the contractor can open it with no new policy.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receipt_path        text,
  ADD COLUMN IF NOT EXISTS receipt_uploaded_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS receipt_uploaded_at timestamptz;

-- A receipt state must carry a receipt. Otherwise "the client says they paid" is a
-- claim with nothing behind it, and the contractor is being asked to confirm a feeling.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_has_proof;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_has_proof CHECK (
  state <> 'receipt_submitted'
  OR (receipt_path IS NOT NULL AND receipt_uploaded_by IS NOT NULL AND receipt_uploaded_at IS NOT NULL)
);

COMMENT ON COLUMN public.payments.receipt_path IS
  'Storage path of the client''s proof of payment (175). Groundwork does not process '
  'the payment; this is the document the contractor confirms against.';

-- ── 2. A submitted receipt does NOT settle the stage ───────
CREATE OR REPLACE FUNCTION public.stage_funding_settled(p_stage uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.payments
     WHERE stage_id = p_stage
       AND direction = 'in'
       -- `receipt_submitted` joins `expected` here, and this one word is what makes the
       -- contractor's confirmation mean something. Without it, uploading the receipt
       -- would settle the stage and open it, and "confirm" would be a button that
       -- changes nothing.
       AND state IN ('expected', 'receipt_submitted'));
$$;

COMMENT ON FUNCTION public.stage_funding_settled(uuid) IS
  'True when no incoming tranche on this stage is still expected OR merely claimed '
  '(132, narrowed in 175). A stage that was never billed has no payment row at all — '
  'amount is CHECKed > 0 — so it reads as settled, which is what stops a $0 stage '
  'locking a build forever.';

-- ── 3. The client uploads the proof ────────────────────────
CREATE OR REPLACE FUNCTION public.submit_stage_payment_receipt(p_stage uuid, p_path text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage public.project_stages%ROWTYPE;
  v_actor uuid := auth.uid();
  v_path  text := NULLIF(btrim(coalesce(p_path, '')), '');
  v_count int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'no_receipt: a receipt needs a file';
  END IF;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;

  -- The CLIENT, which on a contractor-run build is the invited viewer and not the
  -- owner. One definition, shared with the approval gates (174).
  IF NOT public.is_project_client(v_stage.project_id) THEN
    RAISE EXCEPTION 'not_client: only the client of this project uploads a payment receipt';
  END IF;

  PERFORM set_config('app.payments_write', 'on', true);
  UPDATE public.payments
     SET state = 'receipt_submitted',
         receipt_path = v_path, receipt_uploaded_by = v_actor, receipt_uploaded_at = now()
   WHERE stage_id = p_stage AND direction = 'in' AND state IN ('expected', 'receipt_submitted');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Nothing was owed. Re-uploading against a stage already confirmed would be a client
  -- undoing a contractor's confirmation, so it is refused rather than quietly ignored.
  IF v_count = 0 THEN
    RAISE EXCEPTION 'nothing_expected: this stage has no payment waiting on a receipt';
  END IF;

  PERFORM public.log_activity(v_stage.project_id, 'funding.receipt_submitted',
    'project_stage', p_stage, v_actor,
    jsonb_build_object('stage_number', v_stage.stage_number, 'tranches', v_count));

  RETURN jsonb_build_object('stage_id', p_stage, 'tranches', v_count);
END $$;

REVOKE ALL ON FUNCTION public.submit_stage_payment_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_stage_payment_receipt(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.submit_stage_payment_receipt(uuid, text) IS
  'The client attaches proof that they paid the contractor for this stage (175). It '
  'does NOT open the stage: the contractor confirms, and that is what opens it.';

-- ── 4. The contractor confirms, and the stage opens ────────
CREATE OR REPLACE FUNCTION public.confirm_stage_payment(p_stage uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage  public.project_stages%ROWTYPE;
  v_actor  uuid := auth.uid();
  v_admin  boolean := public.is_admin();
  v_count  int;
  v_opened boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;

  -- The person the money was paid TO, or staff. Explicitly NOT the client: confirming
  -- your own payment is the whole thing this step exists to prevent.
  IF NOT v_admin AND NOT public.is_contractor_on(v_stage.project_id, v_actor) THEN
    RAISE EXCEPTION 'not_contractor: only the contractor on this project, or staff, confirms a payment';
  END IF;

  /*
   * A contractor confirms a RECEIPT. Staff may confirm without one.
   *
   * This was the hole the first draft had, and it was found by running the sequence
   * rather than reading it: with `expected` accepted here, a contractor could confirm
   * a payment nobody had claimed to make and open the next stage on their own. The
   * client's upload would be optional, and the step that exists to put the client in
   * control of progress would be skippable by the one party it is meant to check.
   *
   * Staff keep the wider path, because they are the fallback for the case this product
   * genuinely has: a client who paid in cash in person and has no receipt to attach.
   * That is what `mark_stage_paid` (132) has always been, and it is still admin-only.
   */
  PERFORM set_config('app.payments_write', 'on', true);
  UPDATE public.payments
     SET state = 'funded',
         funding_source = CASE WHEN v_admin THEN 'staff_confirmed' ELSE 'contractor_confirmed' END,
         confirmed_by = v_actor, confirmed_at = now(),
         note = COALESCE(NULLIF(btrim(p_note), ''), note)
   WHERE stage_id = p_stage AND direction = 'in'
     AND (state = 'receipt_submitted' OR (v_admin AND state = 'expected'));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    -- Told apart, because they are different problems with different fixes: one waits
    -- on the client, the other has already happened.
    IF EXISTS (SELECT 1 FROM public.payments
                WHERE stage_id = p_stage AND direction = 'in' AND state = 'expected') THEN
      RAISE EXCEPTION 'no_receipt: the client has not uploaded a payment receipt for this stage yet';
    END IF;
    RAISE EXCEPTION 'nothing_to_confirm: no incoming payment on this stage is waiting';
  END IF;

  -- Kept in step with the ledger. `approve_stage` reads this column rather than the
  -- payments table, and two sources that disagree is a stage you cannot approve and
  -- cannot explain.
  UPDATE public.project_stages SET payment_status = 'paid' WHERE id = p_stage;

  PERFORM public.log_activity(v_stage.project_id, 'funding.received', 'project_stage', p_stage, v_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_number', v_stage.stage_number, 'tranches', v_count,
      'funding_source', CASE WHEN v_admin THEN 'staff_confirmed' ELSE 'contractor_confirmed' END,
      'by', CASE WHEN v_admin THEN 'admin' ELSE 'contractor' END,
      'note', NULLIF(btrim(p_note), ''))));

  -- "When the contractor confirms, then that stage unlocks automatically."
  v_opened := public.open_stage_if_settled(p_stage);

  RETURN jsonb_build_object('stage_id', p_stage, 'tranches_confirmed', v_count, 'opened', v_opened);
END $$;

REVOKE ALL ON FUNCTION public.confirm_stage_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_stage_payment(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.confirm_stage_payment(uuid, text) IS
  'The contractor confirms the client''s payment arrived, and the stage opens (175). '
  'A contractor confirms a RECEIPT the client uploaded; staff may confirm without one, '
  'for the client who paid cash in person. The client may never confirm their own '
  'payment — that is the separation. No money moves here; Groundwork holds nothing.';

-- ── 5. approve_stage, rebuilt on 132 with 174's changes ────
CREATE OR REPLACE FUNCTION public.approve_stage(p_stage uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage    public.project_stages%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_admin    boolean := public.is_admin();
  v_client   boolean;
  v_self     boolean;
  v_built    boolean;
  v_latest   public.stage_verifications%ROWTYPE;
  v_next     public.project_stages%ROWTYPE;
  v_final    boolean;
  v_now      timestamptz := now();
BEGIN
  -- FOR UPDATE, as 087: two approvals racing serialise here, the second re-reads and
  -- gets wrong_state. One approval, one audit row, one next-stage activation.
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;

  -- 174: the CLIENT, which on a contractor-run build is the invited viewer, not the
  -- owner. See is_project_client().
  v_client := public.is_project_client(v_stage.project_id);
  v_self   := (v_project.tier IN ('self_verify', 'starter'));

  IF NOT v_admin AND NOT (v_client AND v_self) THEN
    RAISE EXCEPTION 'not_authorized: only an administrator, or the client of a Self Verify project, may approve a stage';
  END IF;
  IF v_stage.status NOT IN ('active', 'pending_review') THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;

  IF NOT v_admin THEN
    IF v_stage.payment_status <> 'paid' THEN
      RAISE EXCEPTION 'not_paid: this stage has not been paid for';
    END IF;
    IF EXISTS (SELECT 1 FROM public.project_substages WHERE stage_id = p_stage AND status <> 'complete') THEN
      RAISE EXCEPTION 'substages_not_ready: not all substages are complete';
    END IF;

    -- 174: something to review, where somebody else did the work.
    SELECT EXISTS (SELECT 1 FROM public.contractor_invites ci
                    WHERE ci.project_id = v_stage.project_id AND ci.status = 'accepted')
      INTO v_built;
    IF v_built AND NOT public.stage_has_evidence(p_stage) THEN
      RAISE EXCEPTION 'no_evidence: this stage has nothing uploaded to review yet';
    END IF;
  END IF;

  IF v_stage.verification_required THEN
    SELECT * INTO v_latest FROM public.stage_verifications
     WHERE stage_id = p_stage ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND OR v_latest.decision <> 'verified' THEN
      RAISE EXCEPTION 'not_verified: independent verification is required and the latest decision is %',
        COALESCE(v_latest.decision, 'none');
    END IF;
  END IF;

  PERFORM set_config('app.approve_stage', 'on', true);

  IF v_admin THEN
    UPDATE public.project_substages
       SET status = 'complete', approved_by = auth.uid(), approved_at = v_now
     WHERE stage_id = p_stage AND status <> 'complete';
  END IF;

  UPDATE public.project_stages
     SET status = 'complete', completed_at = v_now, approved_by = auth.uid(), approved_at = v_now
   WHERE id = p_stage;

  v_final := (v_stage.stage_number + 1 > 10);
  IF NOT v_final THEN
    SELECT * INTO v_next FROM public.project_stages
     WHERE project_id = v_stage.project_id AND stage_number = v_stage.stage_number + 1;
    IF FOUND THEN
      -- 132, restored: the next stage opens when it is PAID FOR, not because this one
      -- finished. Since 175 that payment is the client's receipt plus the contractor's
      -- confirmation, so in the ordinary case this branch does NOT fire on approval —
      -- it fires later, from confirm_stage_payment. A stage with nothing to pay is
      -- settled by definition and opens here as it always did.
      IF public.stage_funding_settled(v_next.id) THEN
        UPDATE public.project_stages    SET status = 'active'  WHERE id = v_next.id;
        UPDATE public.project_substages SET status = 'pending' WHERE stage_id = v_next.id;
      ELSE
        -- Said out loud, because a stage that stays shut with no reason recorded is
        -- indistinguishable from one that failed to open. This is also the line the
        -- client's "upload your receipt" prompt is the other face of.
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

  PERFORM public.log_activity(v_stage.project_id, 'stage.approved', 'project_stage', p_stage, auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'stage_number', v_stage.stage_number, 'tier', v_project.tier,
      'approved_by_role', CASE WHEN v_admin THEN 'admin' ELSE 'client' END,
      'verification_id', v_latest.id)));

  RETURN jsonb_build_object(
    'project_id',        v_stage.project_id,
    'stage_id',          p_stage,
    'stage_number',      v_stage.stage_number,
    'is_final',          v_final,
    'next_stage_id',     v_next.id,
    'next_stage_number', CASE WHEN v_final THEN NULL ELSE v_stage.stage_number + 1 END,
    -- What the client is asked for next. The approve button's job is to reveal the
    -- receipt upload, and this is how the screen knows to.
    'awaiting_payment',  (v_next.id IS NOT NULL AND NOT public.stage_funding_settled(v_next.id)),
    'verification_id',   v_latest.id);
END $$;

REVOKE ALL ON FUNCTION public.approve_stage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_stage(uuid) TO authenticated;

COMMENT ON FUNCTION public.approve_stage(uuid) IS
  'Approve a stage. Admitted: staff, and the CLIENT of a Self Verify project — owner or '
  'invited client viewer (174). The next stage opens only once its funding is settled '
  '(132), which since 175 means the client''s receipt AND the contractor''s '
  'confirmation. Returns awaiting_payment so the screen can ask for the receipt.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- a submitted receipt must not settle a stage
--   SELECT public.stage_funding_settled(s.id) FROM public.project_stages s
--     JOIN public.payments p ON p.stage_id = s.id AND p.state = 'receipt_submitted' LIMIT 1;
--   -- expect: false
--
--   -- approval still defers to funding (the 174 regression, repaired)
--   SELECT prosrc LIKE '%stage_funding_settled(v_next.id)%' FROM pg_proc
--    WHERE proname = 'approve_stage';
--   -- expect: true
