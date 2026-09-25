-- =========================================================
-- 098  When a payout entered processing
--
-- WHY
--
-- A payment sitting in `initiated` has no date of its own. The screens fall back to
-- `authorised_at`, so a release approved on the 25th and handed to the provider on the
-- 27th reads "Approved 25 Sep · Processing" — two true facts that together invite the
-- wrong conclusion, because the number a person takes from that line is the 25th.
--
-- It also makes "how long has this been stuck?" unanswerable, which is the first question
-- Reconciliation will ask.
--
-- WHAT THIS IS NOT
--
-- Not `authorised_at`  — when a human decided.
-- Not `settled_at`     — when the money landed.
-- Not `updated_at`     — when any column last changed, including a poll.
-- Not "last checked"   — repeated polls of an unchanged status are deduplicated by
--                        (provider, provider_event_id), so nothing here tracks how fresh
--                        our view of the provider is. That is a separate fact and needs a
--                        separate column; mixing them would produce exactly the kind of
--                        misleading timestamp this migration exists to remove.
--
-- WRITTEN ONCE, BY ONE PLACE
--
-- `record_payment_event()` is the only thing 090 permits to move a payment's state, so it
-- is the only thing that sets this. A later initiated → failed → reconciling → disbursed
-- journey keeps the original: the payout entered processing once, whatever happened
-- afterwards.
--
-- Run in: Supabase Dashboard > SQL Editor (after 097)
-- =========================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS initiated_at timestamptz;

COMMENT ON COLUMN public.payments.initiated_at IS
  'The first time this payment entered state=initiated, set by record_payment_event() and '
  'never changed afterwards. NOT authorised_at, settled_at, updated_at, or a provider '
  'poll time. NULL means the moment is genuinely unknown. See 098.';

-- ── 1. The writer ────────────────────────────────────────
--
-- The whole function is replaced because its body is one statement; the only change is
-- the `initiated_at` line in the UPDATE, and COALESCE is what makes it write-once.
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

  INSERT INTO public.payment_events (provider, provider_event_id, event_type, payload, payment_id)
  VALUES (p_provider, p_provider_event_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), p_payment)
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event;
  IF v_event IS NULL THEN RETURN NULL; END IF;

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
         -- Write-once. COALESCE keeps the first moment even though only one transition
         -- can produce 'initiated' today — a future path into it must not overwrite the
         -- original, and the guard below refuses it anyway.
         initiated_at    = CASE WHEN v_next = 'initiated' THEN COALESCE(initiated_at, now()) ELSE initiated_at END,
         settled_at      = CASE WHEN v_next IN ('disbursed', 'funded') THEN now() ELSE settled_at END,
         failure_reason  = CASE WHEN v_next = 'failed' THEN COALESCE(p_payload->>'reason', 'provider reported failure') ELSE failure_reason END
   WHERE id = v_pay.id;
  UPDATE public.payment_events SET processed_at = now(), outcome = NULL WHERE id = v_event;

  PERFORM public.log_activity(v_pay.project_id,
    CASE WHEN v_next = 'funded' THEN 'funding.received' ELSE 'payment.' || v_next END,
    'payment', v_pay.id, v_pay.beneficiary_id,
    jsonb_strip_nulls(jsonb_build_object(
      'amount', v_pay.amount, 'currency', v_pay.currency, 'stage_id', v_pay.stage_id, 'by', 'provider',
      'provider', p_provider, 'provider_ref', p_provider_ref)));

  RETURN v_event;
END $$;

REVOKE ALL ON FUNCTION public.record_payment_event(text, text, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 2. Immutable once set ────────────────────────────────
--
-- Added to the existing guard rather than a second trigger, so every rule about a payment
-- row stays in one place. A NULL may become a time; a time may never become anything else.
CREATE OR REPLACE FUNCTION public.payments_guard_initiated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.initiated_at IS NOT NULL AND NEW.initiated_at IS DISTINCT FROM OLD.initiated_at THEN
    RAISE EXCEPTION 'immutable: initiated_at is recorded once and does not change';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_initiated_at ON public.payments;
CREATE TRIGGER trg_payments_initiated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_guard_initiated_at();

-- ── 3. Backfill, from evidence only ──────────────────────
--
-- `record_payment_event` has always written `payment.initiated` to the activity log, so a
-- payout that entered processing before this migration has an exact, dated record of the
-- moment. The earliest such row is the answer.
--
-- Nothing else is used. `authorised_at` is when a person decided, `created_at` is when the
-- release was written, `updated_at` moves on every poll — each is NEARBY and none is the
-- fact. A payment with no audit row keeps a NULL, and the screens say nothing rather than
-- something plausible.
WITH evidence AS (
  SELECT a.entity_id AS payment_id, min(a.created_at) AS first_initiated
    FROM public.project_audit_log a
   WHERE a.action = 'payment.initiated'
     AND a.entity_type = 'payment'
     AND a.entity_id IS NOT NULL
   GROUP BY a.entity_id
)
UPDATE public.payments p
   SET initiated_at = e.first_initiated
  FROM evidence e
 WHERE p.id = e.payment_id
   AND p.initiated_at IS NULL;

-- ── Verify ───────────────────────────────────────────────
SELECT 'column added'        AS what, count(*)::text AS n
  FROM information_schema.columns
 WHERE table_name = 'payments' AND column_name = 'initiated_at'
UNION ALL
SELECT 'backfilled from audit evidence', count(*)::text
  FROM public.payments WHERE initiated_at IS NOT NULL
UNION ALL
SELECT 'initiated with no evidence (expected: unknown stays unknown)', count(*)::text
  FROM public.payments WHERE state = 'initiated' AND initiated_at IS NULL;

-- ── Rollback (not run) ───────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_payments_initiated_at ON public.payments;
-- DROP FUNCTION IF EXISTS public.payments_guard_initiated_at();
-- ALTER TABLE public.payments DROP COLUMN initiated_at;
-- Restore record_payment_event() from 090.
