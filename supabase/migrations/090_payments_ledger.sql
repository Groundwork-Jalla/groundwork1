-- =========================================================
-- 090  The financial ledger: payments in, payments out, and who authorised what
--
-- Phase 4 of the admin re-architecture, migration 6 of 7
-- (docs/groundwork-admin/04-implementation-plan.md §2; Phase 2 §2.5; Phase 3 §2, §3.10,
-- §3.11, §4). Depends on 087 (stage_verifications) and 089 (log_activity columns).
--
-- THE BOUNDARY. Groundwork is the system of record for the financial BUSINESS state:
-- what is expected from the client, what has been confirmed as received, whether a stage
-- may be paid, who authorised a release, to whom, how much, when. The provider (SwyChr,
-- not yet integrated) is the execution layer: it will own the transaction reference, the
-- execution status, settlement and provider-reported failure. Those live in the
-- provisional provider_* columns and in payment_events; nothing about eligibility or
-- authorisation depends on them.
--
-- ELIGIBILITY IS DERIVED. AUTHORISATION IS AN ACT.
--   eligible ⇔ stage complete ∧ (¬verification_required ∨ latest decision = verified)
--            ∧ funded − disbursed − authorised ≥ amount ∧ project not on_hold
-- is computed — in stageLifecycle() for screens, and again INSIDE authorise_release()
-- from the same inputs, in the same transaction, under a lock. It is never stored: no
-- `eligible` row, no flag, no cache. The `payments(out)` row that authorise_release()
-- inserts is the record of a person's decision, and it is created already
-- release_authorised. (The plan's state list names an `eligible` state for out rows; it is
-- deliberately NOT admitted here — a stored `eligible` would be a cached eligibility by
-- another name. The row that would be "eligible" is the absence of a row.)
--
-- ONE LEDGER, BOTH DIRECTIONS.
--   in   expected → funded → reconciled
--   out  release_authorised → initiated → disbursed
--        initiated → failed → reconciling → disbursed | failed
-- Enforced by a transition trigger that also requires the transaction-local flag the four
-- functions set — so a state cannot be moved from the SQL editor either, and every
-- transition has its audit row. Money-moved facts (initiated,
-- disbursed, failed, provider-funded) come ONLY from provider events through
-- record_payment_event(). The one human path that changes a money state is the interim
-- funding confirmation approved 12 Sep: confirm_funding() marks an `in` row funded with
-- funding_source = 'staff_confirmed', confirmed_by, confirmed_at and provider IS NULL — a
-- named person's audited act, explicitly not provider confirmation. There is NO staff path
-- for disbursement: until SwyChr is integrated an authorised release stays
-- release_authorised, which is the truth.
--
-- IDEMPOTENCY. payment_events is UNIQUE (provider, provider_event_id). record_payment_event
-- inserts ON CONFLICT DO NOTHING; the state transition runs only when the insert returned a
-- row. Two deliveries of the same event — sequential or concurrent — produce one event row,
-- one transition, one audit row. A repeated event cannot advance a payment twice.
--
-- project_stages.payment_status — A LEGACY COMPATIBILITY PROJECTION. Fourteen files read it
-- today (Phase 3 §0). The column's meaning, proven from its readers, is "the client has
-- funded this stage": approve_stage (087) and submit_stage_for_review (089) refuse
-- `not_paid:` without it, PaymentsTab reads it as "you've paid X of Y", and the owner's
-- Confirm-payment button set it. So it projects INCOMING funding, not disbursement — the
-- plan's line "paid ⇔ an out row disbursed" would deadlock the ladder (a stage could not be
-- approved until it had been paid out, and could not be paid out until approved) and is
-- corrected here:
--   paid    ⇔ Σ funded/reconciled `in` rows for the stage ≥ payment_milestone_usd
--   partial ⇔ 0 < Σ < milestone
--   unpaid  otherwise
--   — and a stage with NO milestone (NULL or 0) is `paid`: nothing is owed, so nothing is
--   outstanding. apply_budget_milestones legitimately prices some stages at $0 (budget_pct
--   0, fixed amount 0); pre-flight found 45 in production, 7 hand-set paid, 38 unpaid.
--   Without this rule those 38 — and every future $0 stage — could never pass the
--   `not_paid:` gates, since no tranche exists to confirm. Backfilled once, below.
-- Exactly one writer: the projection trigger on payments. A guard on project_stages refuses
-- any other write to the column, so it cannot diverge from the ledger from now on. The
-- manual writer updatePaymentStatus() and both toggles are removed in the app. The one
-- divergence that CAN exist is historical: flags hand-set before 090 stay as they are until
-- an admin confirms the stage's funding (confirm_funding creates the ledger row and the
-- projection overwrites the flag). Seeding `expected` rows does not touch the flag — only
-- funded/reconciled rows count. Retirement: when Phase 7 has moved every reader to
-- stageLifecycle(), a later migration drops the trigger, the guard and the column.
--
-- FUNDING SCHEDULE. One `expected` `in` row per stage with a milestone, seeded by trigger
-- when payment_milestone_usd is set (start_project_tracking, admin tracking start, and
-- re-pricing all go through apply_budget_milestones, which writes that column) — rather
-- than re-declaring the eight-parameter start_project_tracking. Backfilled for existing
-- stages. The four project_fees lines (permit, professional, verification, contingency)
-- keep their own payment_status and are NOT in this ledger — out of 090's scope.
--
-- PEOPLE. beneficiary_id, authorised_by, confirmed_by carry NO foreign key (089's rule for
-- person_id): "who released this money" must outlive the account. Beneficiary integrity is
-- enforced where it matters — authorise_release() refuses a beneficiary who is not an
-- accepted contractor on the project.
--
-- Run in: Supabase Dashboard > SQL Editor (after 089)
-- =========================================================

-- ── 1. payments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id)       ON DELETE CASCADE,
  stage_id         uuid          REFERENCES public.project_stages(id) ON DELETE SET NULL,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  state            text NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'XAF')),
  fx_rate          numeric,
  -- out: who the money goes to. No FK — see header.
  beneficiary_id   uuid,
  -- in: how receipt was established. NULL while expected.
  funding_source   text CHECK (funding_source IN ('provider', 'staff_confirmed')),
  confirmed_by     uuid,
  confirmed_at     timestamptz,
  -- out: the person who released the money.
  authorised_by    uuid,
  authorised_at    timestamptz,
  note             text,
  -- PROVISIONAL provider columns: shape may change when SwyChr's contract is known.
  provider         text,
  provider_ref     text,
  provider_status  text,
  provider_payload jsonb,
  settled_at       timestamptz,
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payments_state_by_direction CHECK (
    (direction = 'in'  AND state IN ('expected', 'funded', 'reconciled')) OR
    (direction = 'out' AND state IN ('release_authorised', 'initiated', 'disbursed', 'failed', 'reconciling'))
  ),
  -- An out row exists only because someone authorised it.
  CONSTRAINT payments_out_authorised CHECK (
    direction <> 'out' OR (authorised_by IS NOT NULL AND authorised_at IS NOT NULL AND beneficiary_id IS NOT NULL)
  ),
  -- In rows carry no beneficiary or authorisation; out rows no funding source.
  CONSTRAINT payments_in_shape CHECK (
    direction <> 'in' OR (beneficiary_id IS NULL AND authorised_by IS NULL AND authorised_at IS NULL)
  ),
  CONSTRAINT payments_out_shape CHECK (
    direction <> 'out' OR (funding_source IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL)
  ),
  -- Received money says how it was established. Staff confirmation names the person and
  -- the time and has no provider; provider confirmation names the provider.
  CONSTRAINT payments_funded_has_source CHECK (
    NOT (direction = 'in' AND state IN ('funded', 'reconciled')) OR funding_source IS NOT NULL
  ),
  CONSTRAINT payments_staff_confirmed_strict CHECK (
    funding_source IS DISTINCT FROM 'staff_confirmed'
    OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND provider IS NULL)
  ),
  CONSTRAINT payments_provider_confirmed_strict CHECK (
    funding_source IS DISTINCT FROM 'provider' OR provider IS NOT NULL
  ),
  CONSTRAINT payments_expected_is_clean CHECK (
    state <> 'expected' OR (funding_source IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL)
  ),
  CONSTRAINT payments_failed_has_reason CHECK (
    state NOT IN ('failed', 'reconciling') OR failure_reason IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_key
  ON public.payments (provider, provider_ref) WHERE provider IS NOT NULL AND provider_ref IS NOT NULL;
-- One live release per stage: the database-level double-pay guard. A failed row does not
-- count, so a stage can be re-authorised after a terminal failure — and once it has been,
-- the failed row can no longer be reopened (open_reconciliation checks).
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_live_release_per_stage
  ON public.payments (stage_id) WHERE direction = 'out' AND state <> 'failed';
-- One expected/funded tranche per stage.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_tranche_per_stage
  ON public.payments (stage_id) WHERE direction = 'in';
CREATE INDEX IF NOT EXISTS payments_project_idx ON public.payments (project_id, direction, state);
CREATE INDEX IF NOT EXISTS payments_beneficiary_idx ON public.payments (beneficiary_id) WHERE beneficiary_id IS NOT NULL;

-- ── 2. payment_events — the provider's report, verbatim ──
CREATE TABLE IF NOT EXISTS public.payment_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  event_type        text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  -- Why the event produced no transition (unmatched, illegal, unknown type). NULL = applied.
  outcome           text,
  -- THE idempotency key. An event id is scoped to its provider.
  CONSTRAINT payment_events_provider_event_key UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS payment_events_payment_idx ON public.payment_events (payment_id, received_at DESC);

-- ── 3. Invariants that are not single-row CHECKs ─────────

-- Stage belongs to project; amount ≤ milestone for an out row with a stage; immutability;
-- legal transitions.
CREATE OR REPLACE FUNCTION public.payments_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_milestone numeric;
  v_ok boolean;
BEGIN
  IF NEW.stage_id IS NOT NULL THEN
    SELECT payment_milestone_usd INTO v_milestone
      FROM public.project_stages WHERE id = NEW.stage_id AND project_id = NEW.project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stage_mismatch: stage % does not belong to project %', NEW.stage_id, NEW.project_id;
    END IF;
    IF NEW.direction = 'out' AND v_milestone IS NOT NULL AND NEW.amount > v_milestone THEN
      RAISE EXCEPTION 'over_milestone: % exceeds the stage milestone %', NEW.amount, v_milestone;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.direction = 'out' AND current_setting('app.payments_write', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'payments_via_rpc: a release is authorised through authorise_release()';
    END IF;
    IF NEW.direction = 'in'  AND NEW.state <> 'expected' THEN
      RAISE EXCEPTION 'wrong_state: an in row starts as expected';
    END IF;
    IF NEW.direction = 'out' AND NEW.state <> 'release_authorised' THEN
      RAISE EXCEPTION 'wrong_state: an out row starts as release_authorised';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: what never changes.
  -- (stage_id may only go to NULL — the FK's SET NULL when a stage is removed.)
  IF NEW.project_id <> OLD.project_id OR NEW.direction <> OLD.direction
     OR (NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL)
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'immutable: project, stage, direction and created_at do not change';
  END IF;
  IF NEW.amount <> OLD.amount AND OLD.state <> 'expected' THEN
    RAISE EXCEPTION 'immutable: amount is fixed once money is received or authorised';
  END IF;
  IF OLD.authorised_by IS NOT NULL AND (NEW.authorised_by IS DISTINCT FROM OLD.authorised_by
                                        OR NEW.authorised_at IS DISTINCT FROM OLD.authorised_at) THEN
    RAISE EXCEPTION 'immutable: authorisation is a record, not a field';
  END IF;
  IF OLD.confirmed_by IS NOT NULL AND (NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
                                       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
                                       OR NEW.funding_source IS DISTINCT FROM OLD.funding_source) THEN
    RAISE EXCEPTION 'immutable: confirmation is a record, not a field';
  END IF;

  IF NEW.state <> OLD.state THEN
    -- A state changes only inside one of this migration's functions, which set the flag
    -- for their transaction. Not from a browser (RLS already), not from the SQL editor.
    IF current_setting('app.payments_write', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'payments_via_rpc: a payment changes state through confirm_funding, authorise_release, open_reconciliation or record_payment_event';
    END IF;
    v_ok := (OLD.direction = 'in'  AND (OLD.state, NEW.state) IN (('expected','funded'), ('funded','reconciled')))
         OR (OLD.direction = 'out' AND (OLD.state, NEW.state) IN (('release_authorised','initiated'), ('initiated','disbursed'),
                                                                   ('initiated','failed'), ('failed','reconciling'),
                                                                   ('reconciling','disbursed'), ('reconciling','failed')));
    IF NOT v_ok THEN
      RAISE EXCEPTION 'wrong_state: % → % is not a transition', OLD.state, NEW.state;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payments_guard ON public.payments;
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_guard();

-- A ledger row that records money is never deleted on its own. An expected row is a plan,
-- not money. The project cascade (admin_delete_project, 069 — which leaves a tombstone)
-- arrives here at trigger depth 2 (the RI trigger is depth 1) and is allowed: the ledger
-- goes with the project it describes. A direct DELETE arrives at depth 1 and is refused.
-- Whether a project with real disbursements should be deletable at all is a Phase 8
-- decision; refusing it here is one condition.
CREATE OR REPLACE FUNCTION public.payments_guard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'expected' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'immutable: a % payment is a financial record and is not deleted', OLD.state;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS payments_guard_delete ON public.payments;
CREATE TRIGGER payments_guard_delete BEFORE DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_guard_delete();

-- ── 4. project_stages.payment_status: one writer ─────────
CREATE OR REPLACE FUNCTION public.project_payment_status(p_stage uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
           -- No milestone: no obligation, nothing outstanding.
           WHEN s.payment_milestone_usd IS NULL OR s.payment_milestone_usd <= 0 THEN 'paid'
           WHEN COALESCE(f.total, 0) >= s.payment_milestone_usd THEN 'paid'
           WHEN COALESCE(f.total, 0) > 0 THEN 'partial'
           ELSE 'unpaid'
         END
    FROM public.project_stages s
    LEFT JOIN (SELECT stage_id, sum(amount) AS total FROM public.payments
                WHERE direction = 'in' AND state IN ('funded', 'reconciled') GROUP BY stage_id) f
           ON f.stage_id = s.id
   WHERE s.id = p_stage;
$$;

CREATE OR REPLACE FUNCTION public.payments_project_payment_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage uuid := COALESCE(NEW.stage_id, OLD.stage_id);
BEGIN
  IF v_stage IS NULL THEN RETURN NULL; END IF;
  -- Only received money moves the flag. An expected row (seeded, re-priced, withdrawn) and
  -- every out row leave it alone — so a flag hand-set before 090 stands until a
  -- confirmation replaces it.
  IF (TG_OP = 'DELETE' OR NEW.state NOT IN ('funded', 'reconciled'))
     AND (TG_OP = 'INSERT' OR OLD.state NOT IN ('funded', 'reconciled')) THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.payments_projection', 'on', true);
  UPDATE public.project_stages s
     SET payment_status = public.project_payment_status(v_stage)
   WHERE s.id = v_stage AND s.payment_status IS DISTINCT FROM public.project_payment_status(v_stage);
  PERFORM set_config('app.payments_projection', 'off', true);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS payments_project_payment_status ON public.payments;
CREATE TRIGGER payments_project_payment_status AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_project_payment_status();

CREATE OR REPLACE FUNCTION public.stages_guard_payment_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND current_setting('app.payments_projection', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'payment_status_derived: payment_status is a projection of the payments ledger and is not written directly';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stages_guard_payment_status ON public.project_stages;
CREATE TRIGGER stages_guard_payment_status BEFORE UPDATE OF payment_status ON public.project_stages
  FOR EACH ROW EXECUTE FUNCTION public.stages_guard_payment_status();

-- ── 5. The funding schedule: one expected tranche per stage ──
CREATE OR REPLACE FUNCTION public.stages_seed_expected_funding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.payments%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM public.payments WHERE stage_id = NEW.id AND direction = 'in';
  IF NEW.payment_milestone_usd IS NULL OR NEW.payment_milestone_usd <= 0 THEN
    -- No milestone: an unfunded plan is withdrawn; received money is never touched; and
    -- the stage owes nothing, so it projects as paid.
    IF FOUND AND v_existing.state = 'expected' THEN DELETE FROM public.payments WHERE id = v_existing.id; END IF;
    PERFORM set_config('app.payments_projection', 'on', true);
    UPDATE public.project_stages SET payment_status = 'paid' WHERE id = NEW.id AND payment_status IS DISTINCT FROM 'paid';
    PERFORM set_config('app.payments_projection', 'off', true);
    RETURN NULL;
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.payments (project_id, stage_id, direction, state, amount, currency)
    VALUES (NEW.project_id, NEW.id, 'in', 'expected', NEW.payment_milestone_usd, 'USD');
    -- A stage that was $0 (and so paid) and now expects money is outstanding again.
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.payment_milestone_usd, 0) <= 0 THEN
      PERFORM set_config('app.payments_projection', 'on', true);
      UPDATE public.project_stages SET payment_status = public.project_payment_status(NEW.id)
       WHERE id = NEW.id AND payment_status IS DISTINCT FROM public.project_payment_status(NEW.id);
      PERFORM set_config('app.payments_projection', 'off', true);
    END IF;
  ELSIF v_existing.state = 'expected' AND v_existing.amount <> NEW.payment_milestone_usd THEN
    UPDATE public.payments SET amount = NEW.payment_milestone_usd WHERE id = v_existing.id;
  ELSIF v_existing.state IN ('funded', 'reconciled') AND TG_OP = 'UPDATE' THEN
    -- Re-priced after funding: the projection (paid/partial) follows the new milestone.
    PERFORM set_config('app.payments_projection', 'on', true);
    UPDATE public.project_stages SET payment_status = public.project_payment_status(NEW.id)
     WHERE id = NEW.id AND payment_status IS DISTINCT FROM public.project_payment_status(NEW.id);
    PERFORM set_config('app.payments_projection', 'off', true);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS stages_seed_expected_funding ON public.project_stages;
CREATE TRIGGER stages_seed_expected_funding AFTER INSERT OR UPDATE OF payment_milestone_usd ON public.project_stages
  FOR EACH ROW EXECUTE FUNCTION public.stages_seed_expected_funding();

-- Backfill: every existing stage with a milestone gets its expected tranche. No funded row
-- is invented — see the header on hand-set flags.
INSERT INTO public.payments (project_id, stage_id, direction, state, amount, currency)
SELECT s.project_id, s.id, 'in', 'expected', s.payment_milestone_usd, 'USD'
  FROM public.project_stages s
 WHERE s.payment_milestone_usd > 0
   AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.stage_id = s.id AND p.direction = 'in');

-- Backfill: stages that owe nothing project as paid. Session-level flag: the SQL editor
-- and psql both run this as separate statements, and the guard reads the flag per statement.
SELECT set_config('app.payments_projection', 'on', false);
UPDATE public.project_stages
   SET payment_status = 'paid'
 WHERE COALESCE(payment_milestone_usd, 0) <= 0 AND payment_status IS DISTINCT FROM 'paid';
SELECT set_config('app.payments_projection', 'off', false);

-- ── 6. Eligibility, computed ─────────────────────────────
-- The same rule stageLifecycle() applies in the browser, here so that authorise_release()
-- can refuse from the truth rather than from what a screen believed a moment ago.
-- Returns NULL when eligible, otherwise the first reason.
CREATE OR REPLACE FUNCTION public.stage_release_blocker(p_stage uuid, p_amount numeric)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage    public.project_stages%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_decision text;
  v_funded   numeric;
  v_out      numeric;
BEGIN
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;
  IF v_project.status = 'on_hold' THEN RETURN 'on_hold'; END IF;
  IF v_stage.status <> 'complete' THEN RETURN 'not_complete'; END IF;
  IF v_stage.verification_required THEN
    SELECT decision INTO v_decision FROM public.stage_verifications
     WHERE stage_id = p_stage ORDER BY requested_at DESC, created_at DESC LIMIT 1;
    IF v_decision IS DISTINCT FROM 'verified' THEN RETURN 'not_verified'; END IF;
  END IF;
  IF v_stage.payment_milestone_usd IS NOT NULL AND p_amount > v_stage.payment_milestone_usd THEN RETURN 'over_milestone'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_funded FROM public.payments
   WHERE project_id = v_stage.project_id AND direction = 'in' AND state IN ('funded', 'reconciled');
  SELECT COALESCE(sum(amount), 0) INTO v_out FROM public.payments
   WHERE project_id = v_stage.project_id AND direction = 'out' AND state <> 'failed';
  IF v_funded - v_out < p_amount THEN RETURN 'insufficient_funds'; END IF;
  RETURN NULL;
END $$;

-- ── 7. The acts ──────────────────────────────────────────

-- Staff confirm that expected money arrived (interim path, 12 Sep). Admin only.
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
END $$;

-- A person releases money. Admin only. Eligibility recomputed here, under the stage AND
-- project locks, so two concurrent authorisations cannot both spend the same funds.
CREATE OR REPLACE FUNCTION public.authorise_release(p_stage uuid, p_amount numeric, p_beneficiary uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage   public.project_stages%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_actor   uuid := auth.uid();
  v_reason  text;
  v_id      uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only an administrator authorises a release'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'bad_amount: amount must be positive'; END IF;
  IF p_beneficiary IS NULL THEN RAISE EXCEPTION 'no_beneficiary: a release names who receives it'; END IF;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id FOR UPDATE;

  IF NOT public.is_contractor_on(v_project.id, p_beneficiary) THEN
    RAISE EXCEPTION 'bad_beneficiary: the beneficiary must be an accepted contractor on this project';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE stage_id = p_stage AND direction = 'out' AND state <> 'failed') THEN
    RAISE EXCEPTION 'already_authorised: a release for this stage is already live';
  END IF;

  v_reason := public.stage_release_blocker(p_stage, p_amount);
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION 'not_eligible:%', v_reason; END IF;

  PERFORM set_config('app.payments_write', 'on', true);
  INSERT INTO public.payments
    (project_id, stage_id, direction, state, amount, currency, beneficiary_id, authorised_by, authorised_at, note)
  VALUES
    (v_project.id, p_stage, 'out', 'release_authorised', p_amount, 'USD', p_beneficiary, v_actor, now(), NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;

  PERFORM public.log_activity(v_project.id, 'payment.release_authorised', 'payment', v_id, p_beneficiary,
    jsonb_strip_nulls(jsonb_build_object(
      'amount', p_amount, 'currency', 'USD', 'stage_id', p_stage, 'stage_number', v_stage.stage_number, 'by', 'admin',
      'beneficiary_id', p_beneficiary, 'note', NULLIF(btrim(p_note), ''))));
  RETURN v_id;
END $$;

-- Staff open an investigation into a failed disbursement. Admin only. The outcome comes
-- from the provider (record_payment_event), never from a person.
CREATE OR REPLACE FUNCTION public.open_reconciliation(p_payment uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only an administrator opens a reconciliation'; END IF;
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such payment'; END IF;
  IF v_pay.direction <> 'out' OR v_pay.state <> 'failed' THEN
    RAISE EXCEPTION 'wrong_state: only a failed disbursement is reconciled (payment is % %)', v_pay.direction, v_pay.state;
  END IF;
  -- Once the stage has been re-authorised, the failed row is history: reopening it could
  -- pay the stage twice.
  IF EXISTS (SELECT 1 FROM public.payments WHERE stage_id = v_pay.stage_id AND direction = 'out'
              AND id <> p_payment AND created_at > v_pay.created_at) THEN
    RAISE EXCEPTION 'superseded: this stage has been re-authorised since the failure';
  END IF;
  PERFORM set_config('app.payments_write', 'on', true);
  UPDATE public.payments SET state = 'reconciling', note = COALESCE(NULLIF(btrim(p_note), ''), note) WHERE id = p_payment;
  PERFORM public.log_activity(v_pay.project_id, 'payment.reconciling', 'payment', p_payment, v_pay.beneficiary_id,
    jsonb_strip_nulls(jsonb_build_object('amount', v_pay.amount, 'currency', v_pay.currency, 'stage_id', v_pay.stage_id, 'by', 'admin',
      'provider', v_pay.provider, 'provider_ref', v_pay.provider_ref, 'note', NULLIF(btrim(p_note), ''))));
END $$;

-- The provider's word, applied once. Called by the integration handler (service role) in
-- Phase 8; not callable by a client. Returns the event row id, or NULL when the event was
-- already known (duplicate delivery — nothing happened).
CREATE OR REPLACE FUNCTION public.record_payment_event(
  p_provider text, p_provider_event_id text, p_event_type text, p_payload jsonb DEFAULT '{}'::jsonb,
  p_payment uuid DEFAULT NULL, p_provider_ref text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event   uuid;
  v_pay     public.payments%ROWTYPE;
  v_outcome text;
  v_next    text;
BEGIN
  IF p_provider IS NULL OR btrim(p_provider) = '' OR p_provider_event_id IS NULL OR btrim(p_provider_event_id) = '' THEN
    RAISE EXCEPTION 'bad_event: provider and provider_event_id are required';
  END IF;

  -- Idempotency: the unique index arbitrates. A concurrent duplicate waits here for the
  -- first insert to commit, then gets no row and stops.
  INSERT INTO public.payment_events (provider, provider_event_id, event_type, payload, payment_id)
  VALUES (p_provider, p_provider_event_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), p_payment)
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event;
  IF v_event IS NULL THEN RETURN NULL; END IF;

  -- Match: by id, else by (provider, provider_ref).
  IF p_payment IS NOT NULL THEN
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment FOR UPDATE;
  ELSIF p_provider_ref IS NOT NULL THEN
    SELECT * INTO v_pay FROM public.payments WHERE provider = p_provider AND provider_ref = p_provider_ref FOR UPDATE;
  END IF;
  IF v_pay.id IS NULL THEN
    UPDATE public.payment_events SET processed_at = now(), outcome = 'unmatched' WHERE id = v_event;
    RETURN v_event;
  END IF;
  UPDATE public.payment_events SET payment_id = v_pay.id WHERE id = v_event;

  v_next := CASE
    WHEN v_pay.direction = 'in'  AND p_event_type = 'funded'     AND v_pay.state = 'expected'                      THEN 'funded'
    WHEN v_pay.direction = 'in'  AND p_event_type = 'reconciled' AND v_pay.state = 'funded'                        THEN 'reconciled'
    WHEN v_pay.direction = 'out' AND p_event_type = 'initiated'  AND v_pay.state = 'release_authorised'            THEN 'initiated'
    WHEN v_pay.direction = 'out' AND p_event_type = 'disbursed'  AND v_pay.state IN ('initiated', 'reconciling')   THEN 'disbursed'
    WHEN v_pay.direction = 'out' AND p_event_type = 'failed'     AND v_pay.state IN ('initiated', 'reconciling')   THEN 'failed'
  END;
  IF v_next IS NULL THEN
    v_outcome := CASE WHEN p_event_type IN ('funded','reconciled','initiated','disbursed','failed') THEN 'illegal_transition' ELSE 'unknown_type' END;
    UPDATE public.payment_events SET processed_at = now(), outcome = v_outcome WHERE id = v_event;
    RETURN v_event;
  END IF;

  PERFORM set_config('app.payments_write', 'on', true);
  UPDATE public.payments
     SET state           = v_next,
         provider        = p_provider,
         provider_ref    = COALESCE(p_provider_ref, provider_ref),
         provider_status = COALESCE(p_payload->>'status', provider_status),
         provider_payload = COALESCE(p_payload, provider_payload),
         funding_source  = CASE WHEN v_next = 'funded' THEN 'provider' ELSE funding_source END,
         settled_at      = CASE WHEN v_next IN ('disbursed', 'funded') THEN now() ELSE settled_at END,
         failure_reason  = CASE WHEN v_next = 'failed' THEN COALESCE(p_payload->>'reason', 'provider reported failure') ELSE failure_reason END
   WHERE id = v_pay.id;
  UPDATE public.payment_events SET processed_at = now(), outcome = NULL WHERE id = v_event;

  PERFORM public.log_activity(v_pay.project_id,
    CASE WHEN v_next = 'funded' THEN 'funding.received' ELSE 'payment.' || v_next END,
    'payment', v_pay.id, v_pay.beneficiary_id,
    jsonb_strip_nulls(jsonb_build_object(
      'amount', v_pay.amount, 'currency', v_pay.currency, 'stage_id', v_pay.stage_id, 'by', 'provider',
      'funding_source', CASE WHEN v_next = 'funded' THEN 'provider' END,
      'provider', p_provider, 'provider_ref', COALESCE(p_provider_ref, v_pay.provider_ref),
      'provider_event_id', p_provider_event_id, 'beneficiary_id', v_pay.beneficiary_id)));
  RETURN v_event;
END $$;

REVOKE ALL ON FUNCTION public.confirm_funding(uuid, text)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.authorise_release(uuid, numeric, uuid, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_reconciliation(uuid, text)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stage_release_blocker(uuid, numeric)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_payment_event(text, text, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.project_payment_status(uuid)                         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_funding(uuid, text)                       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.authorise_release(uuid, numeric, uuid, text)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.open_reconciliation(uuid, text)                   TO authenticated;
REVOKE ALL ON FUNCTION public.stage_release_blocker(uuid, numeric)                 FROM authenticated;
-- record_payment_event: the integration handler (Phase 8) under the service role only.
GRANT  EXECUTE ON FUNCTION public.record_payment_event(text, text, text, jsonb, uuid, text) TO service_role;

-- ── 8. RLS ───────────────────────────────────────────────
ALTER TABLE public.payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_payments"       ON public.payments;
DROP POLICY IF EXISTS "owner_read_payments"       ON public.payments;
DROP POLICY IF EXISTS "beneficiary_read_payments" ON public.payments;
CREATE POLICY "admin_read_payments" ON public.payments FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "owner_read_payments" ON public.payments FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
CREATE POLICY "beneficiary_read_payments" ON public.payments FOR SELECT TO authenticated
  USING (beneficiary_id = auth.uid());
-- No INSERT / UPDATE / DELETE policy: RPC-only.

DROP POLICY IF EXISTS "admin_read_payment_events" ON public.payment_events;
CREATE POLICY "admin_read_payment_events" ON public.payment_events FOR SELECT TO authenticated
  USING (public.is_admin());
-- Nothing else: the integration handler writes under the service role.

COMMENT ON TABLE public.payments IS
  'Groundwork''s financial ledger, both directions. in: expected → funded → reconciled. '
  'out: release_authorised → initiated → disbursed; initiated → failed → reconciling → disbursed | failed. '
  'Written only by confirm_funding, authorise_release, open_reconciliation, record_payment_event and the '
  'seeding trigger. Eligibility is never stored here — see stage_release_blocker(). See 090.';
COMMENT ON COLUMN public.payments.provider IS 'PROVISIONAL until the SwyChr contract is known.';
COMMENT ON COLUMN public.payments.provider_ref IS 'PROVISIONAL until the SwyChr contract is known.';
COMMENT ON COLUMN public.payments.provider_status IS 'PROVISIONAL until the SwyChr contract is known.';
COMMENT ON COLUMN public.payments.provider_payload IS 'PROVISIONAL until the SwyChr contract is known.';
COMMENT ON TABLE public.payment_events IS
  'The provider''s callbacks, verbatim. UNIQUE (provider, provider_event_id) is the idempotency key: '
  'record_payment_event applies a transition only when the event is new. Not a ledger — payments is.';
COMMENT ON COLUMN public.project_stages.payment_status IS
  'LEGACY PROJECTION of the payments ledger (paid ⇔ funded in-rows ≥ milestone) — written by one trigger, '
  'guarded against every other write. Do not read in new code; use stageLifecycle(). Retired when Phase 7 '
  'has moved every reader. See 090.';

-- ── Verify ───────────────────────────────────────────────
SELECT 'expected tranches seeded' AS what, count(*)::text AS n FROM public.payments WHERE direction = 'in' AND state = 'expected'
UNION ALL
SELECT 'stages with a milestone', count(*)::text FROM public.project_stages WHERE payment_milestone_usd > 0
UNION ALL
SELECT '$0 stages, all paid (expect 45 / 45)', count(*) FILTER (WHERE payment_status = 'paid')::text || ' / ' || count(*)::text
  FROM public.project_stages WHERE COALESCE(payment_milestone_usd, 0) <= 0;

-- ── Rollback (not run; here so the reviewer can see it is complete) ───────────
-- DROP TRIGGER IF EXISTS stages_seed_expected_funding ON public.project_stages;
-- DROP TRIGGER IF EXISTS stages_guard_payment_status  ON public.project_stages;
-- DROP FUNCTION IF EXISTS public.stages_seed_expected_funding(), public.stages_guard_payment_status(),
--   public.payments_project_payment_status(), public.project_payment_status(uuid), public.payments_guard(),
--   public.payments_guard_delete(), public.stage_release_blocker(uuid, numeric), public.confirm_funding(uuid, text),
--   public.authorise_release(uuid, numeric, uuid, text), public.open_reconciliation(uuid, text),
--   public.record_payment_event(text, text, text, jsonb, uuid, text);
-- DROP TABLE IF EXISTS public.payment_events; DROP TABLE IF EXISTS public.payments;
-- COMMENT ON COLUMN public.project_stages.payment_status IS NULL;
-- App: restore updatePaymentStatus() and the manual confirm in ProjectPayments from git.
-- payment_status keeps whatever value the projection last wrote; with the guard gone it is
-- hand-set again, as before 090. No audit row is removed.
