-- Contractor-recorded payments: stages the homeowner has paid directly to the contractor,
-- without a bank receipt uploaded through the platform.
--
-- Apply after 20261118000300_price_change_needs_reason.sql.
-- Does NOT change existing receipt or payment rows.
-- A project where the contractor has not recorded any payments reads exactly as before.
--
-- ── Three new tables ──────────────────────────────────────────────────────────
--   contractor_stage_verifications  — per-stage "Yes, the Homeowner paid me"
--   contractor_payment_disputes     — homeowner's "Not right? Tell us" flag
--   project_initial_payments        — "Has the Homeowner already paid you?" at project creation
--
-- ── Three RPC functions ───────────────────────────────────────────────────────
--   record_contractor_stage_verification  — called when contractor answers Yes
--   dispute_contractor_verification       — called when homeowner disputes
--   record_project_initial_payments       — called when contractor records initial payments
--
-- ── Audit actions added ───────────────────────────────────────────────────────
--   stage.contractor_verified_payment
--   stage.payment_disputed
--   project.initial_payments_recorded
-- All three must be translated in src/lib/i18n/en.ts and fr.ts (admin.ops.action.*).
BEGIN;

-- ── 1. Contractor's per-stage answer ─────────────────────────────────────────
-- One row per stage where the contractor confirms payment was received offline.
-- Absence of a row = not yet asked or the answer was No.
-- The unique constraint on stage_id means the latest answer always wins (upsert).
CREATE TABLE IF NOT EXISTS public.contractor_stage_verifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_id        uuid NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,
  verified_by     uuid,                              -- NULL after account deletion
  verified_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  amount          numeric(24,6) CHECK(amount > 0 AND amount <= 1e12),
  currency        text CHECK(currency ~ '^[A-Z]{3}$'),
  fx_rate         numeric(24,12) CHECK(fx_rate > 0 AND fx_rate <= 1e12),
  amount_usd      numeric(24,9) CHECK(amount_usd > 0 AND amount_usd <= 1e12),
  note            text CHECK(length(note) <= 2000),
  UNIQUE(stage_id),
  CHECK(
    (amount IS NULL AND currency IS NULL AND fx_rate IS NULL AND amount_usd IS NULL) OR
    (amount IS NOT NULL AND currency IS NOT NULL AND fx_rate IS NOT NULL AND amount_usd IS NOT NULL)
  )
);
ALTER TABLE public.contractor_stage_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS csv_member_read ON public.contractor_stage_verifications;
CREATE POLICY csv_member_read ON public.contractor_stage_verifications FOR SELECT TO authenticated
  USING(public.is_admin() OR public.project_member(project_id));
GRANT SELECT ON public.contractor_stage_verifications TO authenticated;
CREATE INDEX IF NOT EXISTS csv_project_idx ON public.contractor_stage_verifications(project_id, stage_id);

-- ── 2. Homeowner dispute: "Not right? Tell us" ───────────────────────────────
-- Does NOT block work or undo the contractor's verification.
-- Creates a record for the admin team to investigate.
-- A dispute is per-verification; if the contractor updates their answer, a new
-- verification row replaces the old one (stage_id UNIQUE), making past disputes
-- historical context only.
CREATE TABLE IF NOT EXISTS public.contractor_payment_disputes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id   uuid NOT NULL REFERENCES public.contractor_stage_verifications(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_id          uuid NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,
  disputed_by       uuid,                              -- NULL after account deletion
  disputed_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason            text CHECK(length(reason) <= 2000),
  resolved_at       timestamptz,
  resolved_by       uuid,
  resolution_note   text CHECK(length(resolution_note) <= 2000),
  CHECK(
    (resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL) OR
    (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);
ALTER TABLE public.contractor_payment_disputes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cpd_admin_read ON public.contractor_payment_disputes;
DROP POLICY IF EXISTS cpd_client_read ON public.contractor_payment_disputes;
DROP POLICY IF EXISTS cpd_member_read ON public.contractor_payment_disputes;
-- Admin sees everything; the client who filed it sees their own row; the contractor
-- sees that a dispute exists on their project (but not the reason) so they can
-- coordinate with their homeowner.
CREATE POLICY cpd_admin_read ON public.contractor_payment_disputes FOR SELECT TO authenticated
  USING(public.is_admin());
CREATE POLICY cpd_member_read ON public.contractor_payment_disputes FOR SELECT TO authenticated
  USING(public.project_member(project_id));
GRANT SELECT ON public.contractor_payment_disputes TO authenticated;
CREATE INDEX IF NOT EXISTS cpd_project_idx ON public.contractor_payment_disputes(project_id, stage_id);
CREATE INDEX IF NOT EXISTS cpd_verification_idx ON public.contractor_payment_disputes(verification_id);

-- ── 3. Initial payments at project creation ───────────────────────────────────
-- "Has the Homeowner already paid you for any of this build?" — asked once
-- when a contractor creates a project. One row per project; upsert if the
-- answer is updated before tracking starts.
CREATE TABLE IF NOT EXISTS public.project_initial_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  total_amount    numeric(24,6) NOT NULL CHECK(total_amount > 0 AND total_amount <= 1e12),
  currency        text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  fx_rate         numeric(24,12) NOT NULL CHECK(fx_rate > 0 AND fx_rate <= 1e12),
  amount_usd      numeric(24,9) NOT NULL CHECK(amount_usd > 0 AND amount_usd <= 1e12),
  -- JSON array of stage numbers covered, e.g. [1, 2]. Stage numbers, not IDs,
  -- because the stages may not all exist yet at recording time.
  covered_stages  integer[] NOT NULL DEFAULT '{}',
  recorded_by     uuid,
  recorded_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  note            text CHECK(length(note) <= 2000)
);
ALTER TABLE public.project_initial_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pip_member_read ON public.project_initial_payments;
CREATE POLICY pip_member_read ON public.project_initial_payments FOR SELECT TO authenticated
  USING(public.is_admin() OR public.project_member(project_id));
GRANT SELECT ON public.project_initial_payments TO authenticated;

-- ── 4. RPC: record a contractor's stage verification ─────────────────────────
-- Called when the contractor answers "Yes, the Homeowner has paid for this stage."
-- Idempotent: a second call on the same stage updates the existing row.
CREATE OR REPLACE FUNCTION public.record_contractor_stage_verification(
  p_stage     uuid,
  p_amount    numeric  DEFAULT NULL,
  p_currency  text     DEFAULT NULL,
  p_fx_rate   numeric  DEFAULT NULL,
  p_note      text     DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_stage      public.project_stages%ROWTYPE;
  v_project_id uuid;
  v_usd        numeric;
  v_id         uuid;
  v_currency   text := upper(btrim(coalesce(p_currency, '')));
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT project_id INTO v_project_id FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: stage does not exist'; END IF;

  -- Only the project's primary contractor may verify
  IF NOT public.is_primary_project_contractor(v_project_id) THEN
    RAISE EXCEPTION 'not_contractor: only the project contractor may record a payment verification';
  END IF;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage;
  IF coalesce(v_stage.pre_existing, false) THEN
    RAISE EXCEPTION 'nothing_expected: pre-existing stages have no recorded payment expectation';
  END IF;

  -- Amount fields are all-or-nothing (enforced by table CHECK too, but be explicit)
  IF p_amount IS NOT NULL THEN
    IF p_amount <= 0 OR p_amount > 1e12 THEN
      RAISE EXCEPTION 'invalid_amount: enter a positive amount up to 1 trillion';
    END IF;
    IF v_currency = '' OR v_currency !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'invalid_currency: use a 3-letter ISO currency code';
    END IF;
    IF p_fx_rate IS NULL OR p_fx_rate <= 0 OR p_fx_rate > 1e12 THEN
      RAISE EXCEPTION 'invalid_rate: use a positive exchange rate';
    END IF;
    v_usd := round(p_amount / p_fx_rate, 9);
    IF v_usd <= 0 OR v_usd > 1e12 THEN
      RAISE EXCEPTION 'invalid_amount: converted USD amount is out of range';
    END IF;
  END IF;

  INSERT INTO public.contractor_stage_verifications
    (project_id, stage_id, verified_by, amount, currency, fx_rate, amount_usd, note)
  VALUES
    (v_project_id, p_stage, v_actor,
     p_amount,
     CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END,
     p_fx_rate,
     v_usd,
     NULLIF(btrim(coalesce(p_note, '')), ''))
  ON CONFLICT (stage_id) DO UPDATE SET
    verified_by  = EXCLUDED.verified_by,
    verified_at  = clock_timestamp(),
    amount       = EXCLUDED.amount,
    currency     = EXCLUDED.currency,
    fx_rate      = EXCLUDED.fx_rate,
    amount_usd   = EXCLUDED.amount_usd,
    note         = EXCLUDED.note
  RETURNING id INTO v_id;

  PERFORM public.log_activity(
    v_project_id,
    'stage.contractor_verified_payment',
    'project_stage',
    p_stage,
    v_actor,
    jsonb_build_object(
      'stage_id',        p_stage,
      'amount',          p_amount,
      'currency',        CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END,
      'verification_id', v_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'verification_id', v_id, 'stage_id', p_stage);
END;
$$;
REVOKE ALL ON FUNCTION public.record_contractor_stage_verification(uuid, numeric, text, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contractor_stage_verification(uuid, numeric, text, numeric, text)
  TO authenticated;

-- ── 5. RPC: homeowner disputes a verification ────────────────────────────────
-- Called when the homeowner clicks "Not right? Tell us."
-- Does NOT block work. Creates a record for admin investigation.
CREATE OR REPLACE FUNCTION public.dispute_contractor_verification(
  p_verification_id uuid,
  p_reason          text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ver   public.contractor_stage_verifications%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT * INTO v_ver FROM public.contractor_stage_verifications WHERE id = p_verification_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: verification does not exist'; END IF;

  -- Only the project homeowner (client) may dispute
  IF NOT public.is_project_client(v_ver.project_id) THEN
    RAISE EXCEPTION 'not_client: only the project Homeowner may dispute a contractor verification';
  END IF;

  INSERT INTO public.contractor_payment_disputes
    (verification_id, project_id, stage_id, disputed_by, reason)
  VALUES
    (p_verification_id, v_ver.project_id, v_ver.stage_id,
     v_actor, NULLIF(btrim(coalesce(p_reason, '')), ''));

  PERFORM public.log_activity(
    v_ver.project_id,
    'stage.payment_disputed',
    'project_stage',
    v_ver.stage_id,
    v_actor,
    jsonb_build_object('verification_id', p_verification_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.dispute_contractor_verification(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_contractor_verification(uuid, text)
  TO authenticated;

-- ── 6. RPC: record initial payments at project creation ──────────────────────
-- Called when the contractor answers "Yes" to "Has the Homeowner already paid
-- you for any of this build?" during project creation.
CREATE OR REPLACE FUNCTION public.record_project_initial_payments(
  p_project       uuid,
  p_total_amount  numeric,
  p_currency      text,
  p_fx_rate       numeric,
  p_covered_stages integer[] DEFAULT '{}',
  p_note          text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_usd      numeric;
  v_id       uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  -- Verify project exists and actor is the contractor
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project) THEN
    RAISE EXCEPTION 'not_found: project does not exist';
  END IF;
  IF NOT public.is_primary_project_contractor(p_project) THEN
    RAISE EXCEPTION 'not_contractor: only the project contractor may record initial payments';
  END IF;

  IF p_total_amount IS NULL OR p_total_amount <= 0 OR p_total_amount > 1e12 THEN
    RAISE EXCEPTION 'invalid_amount: enter a positive total amount';
  END IF;
  IF v_currency = '' OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'invalid_currency: use a 3-letter ISO currency code';
  END IF;
  IF p_fx_rate IS NULL OR p_fx_rate <= 0 OR p_fx_rate > 1e12 THEN
    RAISE EXCEPTION 'invalid_rate: use a positive exchange rate';
  END IF;

  v_usd := round(p_total_amount / p_fx_rate, 9);
  IF v_usd <= 0 OR v_usd > 1e12 THEN
    RAISE EXCEPTION 'invalid_amount: converted USD amount is out of range';
  END IF;

  INSERT INTO public.project_initial_payments
    (project_id, total_amount, currency, fx_rate, amount_usd, covered_stages, recorded_by, note)
  VALUES
    (p_project,
     p_total_amount,
     v_currency,
     p_fx_rate,
     v_usd,
     coalesce(p_covered_stages, '{}'),
     v_actor,
     NULLIF(btrim(coalesce(p_note, '')), ''))
  ON CONFLICT (project_id) DO UPDATE SET
    total_amount    = EXCLUDED.total_amount,
    currency        = EXCLUDED.currency,
    fx_rate         = EXCLUDED.fx_rate,
    amount_usd      = EXCLUDED.amount_usd,
    covered_stages  = EXCLUDED.covered_stages,
    recorded_by     = EXCLUDED.recorded_by,
    recorded_at     = clock_timestamp(),
    note            = EXCLUDED.note
  RETURNING id INTO v_id;

  -- Mark any existing non-pre-existing covered stages as contractor-verified
  -- without overwriting an explicit per-stage verification already recorded.
  IF coalesce(array_length(p_covered_stages, 1), 0) > 0 THEN
    INSERT INTO public.contractor_stage_verifications
      (project_id, stage_id, verified_by, note)
    SELECT p_project, s.id, v_actor, NULLIF(btrim(coalesce(p_note, '')), '')
    FROM public.project_stages s
    WHERE s.project_id = p_project
      AND s.stage_number = ANY(p_covered_stages)
      AND NOT coalesce(s.pre_existing, false)
    ON CONFLICT (stage_id) DO NOTHING;
  END IF;

  PERFORM public.log_activity(
    p_project,
    'project.initial_payments_recorded',
    NULL,
    NULL,
    v_actor,
    jsonb_build_object(
      'total_amount',   p_total_amount,
      'currency',       v_currency,
      'covered_stages', coalesce(p_covered_stages, '{}')
    )
  );

  RETURN jsonb_build_object('ok', true, 'initial_payment_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.record_project_initial_payments(uuid, numeric, text, numeric, integer[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_project_initial_payments(uuid, numeric, text, numeric, integer[], text)
  TO authenticated;

-- ── 7. Smoke checks ───────────────────────────────────────────────────────────
SELECT 'contractor_stage_verifications' AS created,
       count(*) AS rows FROM public.contractor_stage_verifications;
SELECT 'contractor_payment_disputes' AS created,
       count(*) AS rows FROM public.contractor_payment_disputes;
SELECT 'project_initial_payments' AS created,
       count(*) AS rows FROM public.project_initial_payments;

COMMIT;
