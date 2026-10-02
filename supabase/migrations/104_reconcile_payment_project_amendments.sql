-- =========================================================
-- 104  Reconciling 101–103 with what production actually ran
--
-- WHY THIS FILE EXISTS INSTEAD OF RE-RUNNING 101–103
--
-- 101, 102 and 103 were applied to production BEFORE their review. They were then amended in
-- place: `bank_code` became `bank_key`, a snapshot path was added for outbound payouts, a
-- constraint that made a verified destination un-retirable was corrected, the phone backfill
-- became deterministic, and pre-existing stages stopped claiming a completion date they never
-- had. None of that is live.
--
-- Live-probed 2 Oct 2026 with the anon key (bogus column and bogus function as controls in the
-- same run, answering 42703 and PGRST202, so the probe discriminates):
--
--   live      is_primary, destination_id, pre_existing, joined_at_stage,
--             set_primary_contractor, contractor_payout_blocker, project_payout_target,
--             is_e164, normalised_phone
--   NOT live  bank_key (bank_code still present), pre_existing_recorded_at,
--             payout_initiation_target
--
-- Re-running the amended 101–103 would leave the ledger saying "101 applied" while the SQL
-- stored under 101 means something materially different from what production ran. A separate
-- forward-only correction keeps the history honest:
--
--   production      101 old → 102 old → 103 old → 104 correction
--   fresh database  101 amended → 102 amended → 103 amended → 104 no-op
--
-- So every statement below is written to reach the same final state from EITHER start, and to
-- be harmless on a third run. The duplication with 101–103 is deliberate.
--
-- ── URGENT: a live breakage this repairs ─────────────────────────────────────────────
-- The deployed application calls `add_payout_destination` with `p_bank_key`. Production still
-- has `p_bank_code`. Every attempt to save contractor payout details currently fails with
-- PGRST202 — both mobile money and bank. §1 is the fix, and is the reason this file is urgent.
--
-- ── ONE TRANSACTION ──────────────────────────────────────────────────────────────────
-- The whole repair commits or none of it does. Without this the first failure anywhere below
-- leaves a half-reconciled production database: the bank column renamed and its RPC recreated,
-- but the pre-existing repair missing — a state no migration file describes and nothing knows
-- how to finish. Every operation used here is transactional (no CREATE INDEX CONCURRENTLY, no
-- VACUUM), so there is no reason to accept a partial apply.
--
-- The final assertion block ABORTS on any invariant it cannot prove, so COMMIT is reached only
-- when the reconciliation actually succeeded.
--
-- Run in: Supabase Dashboard > SQL Editor (after 103, whichever form of it you have)
-- =========================================================

BEGIN;


-- =========================================================
-- §1  101's corrections — the payout model
-- =========================================================

-- ── 6. `bank_code` was the wrong name for a Groundwork key ─
--
-- 099 called the column `bank_code`. That name means "the routing code the payment provider
-- expects", and it is not what we can put there: SwyChr has published no bank list, so there
-- is no correct code to store. What `banks.ts` actually holds is a Groundwork slug (`uba`,
-- `afriland`) — a stable internal identifier that will MAP to a provider code once the list
-- exists.
--
-- Carrying a slug in a column called `bank_code` is not a cosmetic problem. `createPayout`
-- (api/swychr/_client.ts) already passes its `bankCode` argument straight through to
-- `create_transaction` as `bank_code`. The first person to wire the outbound call would
-- reasonably read this column into that field, and the provider would be handed `uba` where
-- it expects a routing number. Renamed now, while nothing has been applied.
--
-- `bank_code` is left FREE, deliberately, for the provider's real code when it arrives.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'payout_destinations'
                AND column_name = 'bank_code')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'payout_destinations'
                AND column_name = 'bank_key') THEN
    -- Postgres rewrites the dependent CHECK constraints and indexes with the column, so
    -- `payout_destination_shape` keeps working under the new name without being restated.
    ALTER TABLE public.payout_destinations RENAME COLUMN bank_code TO bank_key;
  END IF;
END $$;

COMMENT ON COLUMN public.payout_destinations.bank_key IS
  'Groundwork''s own stable identifier for the bank (see src/lib/payments/banks.ts). NOT a '
  'provider routing code: the name `bank_code` is reserved for SwyChr''s own code, which '
  'this maps to once their list exists. Never pass this to createPayout(). See 101.';

-- The RPC's parameter has to follow, or every caller keeps saying `p_bank_code` while the
-- column says otherwise. A parameter cannot be renamed in place (Postgres refuses to change
-- an input parameter's name on REPLACE), so it is dropped and recreated with 099's body.
DROP FUNCTION IF EXISTS public.add_payout_destination(uuid, text, text, text, text, text, text, boolean);

CREATE FUNCTION public.add_payout_destination(
  p_owner uuid, p_country text, p_method text,
  p_mobile text DEFAULT NULL, p_bank_key text DEFAULT NULL,
  p_account_number text DEFAULT NULL, p_account_name text DEFAULT NULL,
  p_make_default boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF NOT (p_owner = v_actor OR public.is_admin()) THEN
    RAISE EXCEPTION 'not_owner: a payout destination belongs to its account';
  END IF;

  IF p_make_default THEN
    UPDATE public.payout_destinations
       SET is_default = false, updated_at = now()
     WHERE owner_id = p_owner AND is_default = true AND status <> 'retired';
  END IF;

  INSERT INTO public.payout_destinations
    (owner_id, country_code, method, mobile_no, bank_key, account_number, account_name,
     is_default, created_by)
  VALUES
    (p_owner, upper(btrim(p_country)), p_method,
     NULLIF(btrim(p_mobile), ''), NULLIF(btrim(p_bank_key), ''),
     NULLIF(btrim(p_account_number), ''), NULLIF(btrim(p_account_name), ''),
     COALESCE(p_make_default, false), v_actor)
  RETURNING id INTO v_id;

  -- What changed, never what it changed to. No number reaches the log.
  PERFORM public.log_activity(NULL, 'payout_destination.added', 'payout_destination', v_id, p_owner,
    jsonb_build_object('method', p_method, 'country_code', upper(btrim(p_country)),
                       'status', 'unverified', 'is_default', COALESCE(p_make_default, false)));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.add_payout_destination(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.add_payout_destination(uuid, text, text, text, text, text, text, boolean) TO authenticated;

-- ── 7. A verified destination could not be retired at all ─
--
-- FOUND WHILE TESTING THE FAIL-CLOSED PATH BELOW. 099's constraint is an equality:
--
--     CHECK ((status = 'verified') = (verified_at IS NOT NULL))
--
-- and `retire_payout_destination` sets `status = 'retired'` without clearing `verified_at`.
-- So retiring any destination that had been checked raised
-- `payout_destination_verified_dated` and failed. A contractor whose bank account is closed
-- could not stand it down, and the account stayed eligible for payouts.
--
-- The constraint's stated intent — "verified is a claim about a check somebody performed; it
-- carries its timestamp or it is not that claim" — is kept exactly. What changes is the
-- direction: verified still REQUIRES a date, but a date no longer implies still-verified. A
-- retired row keeps the date it was checked on, which is a true and useful fact, and
-- `payout_destination_eligible` already tests `status = 'verified'` as well as the date, so
-- nothing becomes payable that was not.

ALTER TABLE public.payout_destinations
  DROP CONSTRAINT IF EXISTS payout_destination_verified_dated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_destination_verified_dated') THEN
    ALTER TABLE public.payout_destinations
      ADD CONSTRAINT payout_destination_verified_dated
      -- One direction only: verified ⇒ dated. A retired row may keep its history.
      CHECK (status <> 'verified' OR verified_at IS NOT NULL);
  END IF;
END $$;

-- ── 8. What the outbound payout call must send ────────────
--
-- THE SNAPSHOT RULE. A release names a destination at the moment it is authorised, and
-- `payments.destination_id` records it. The handler that eventually calls SwyChr's
-- `create_transaction` must send money to THAT destination — never to "whatever this
-- contractor's default is now".
--
-- The failure this prevents:
--   1. an administrator authorises a release to destination A;
--   2. the contractor changes their default to destination B;
--   3. the handler reads the current default and sends an already-authorised release to B.
-- Nobody approved B. The authorisation and the payment would describe different facts.
--
-- Making it structural rather than documentary: this function is the ONLY way to obtain the
-- details for an outbound call, it derives them from the payment row alone, and it takes no
-- destination argument — so a handler CANNOT ask the "current default" question. It also:
--
--   · rechecks `owner_id = beneficiary_id`, so a destination that has somehow been
--     re-pointed at another account cannot be paid under this release;
--   · FAILS CLOSED when the snapshotted destination is no longer eligible. A destination
--     retired between authorisation and initiation stops the payout; it does not fall back
--     to another one. Somebody retired that account for a reason, and the right outcome is a
--     refusal an operator can see, not a silent substitution.
--
-- Returns a refusal reason instead of raising, so the handler can record why a payout did
-- not go out rather than crashing on a live release.
CREATE OR REPLACE FUNCTION public.payout_initiation_target(p_payment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay  public.payments%ROWTYPE;
  v_dest public.payout_destinations%ROWTYPE;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF v_pay.direction <> 'out' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_payout');
  END IF;
  -- Only a release that has been authorised and not yet sent. `initiated` and beyond already
  -- have a provider reference; re-initiating would double-pay.
  IF v_pay.state <> 'release_authorised' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_state', 'state', v_pay.state);
  END IF;

  IF v_pay.destination_id IS NULL THEN
    -- A release authorised before 101 shipped. It is not sendable, and the honest answer is
    -- that an operator must re-authorise it rather than have a destination chosen for it now.
    RETURN jsonb_build_object('ok', false, 'reason', 'no_destination_snapshot');
  END IF;

  SELECT * INTO v_dest FROM public.payout_destinations WHERE id = v_pay.destination_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'destination_missing'); END IF;

  IF v_dest.owner_id IS DISTINCT FROM v_pay.beneficiary_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'beneficiary_mismatch');
  END IF;

  IF NOT public.payout_destination_eligible(v_dest.id) THEN
    -- Retired or unverified since authorisation. Fail closed.
    RETURN jsonb_build_object('ok', false, 'reason', 'destination_not_eligible',
                              'status', v_dest.status);
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'payment_id',     v_pay.id,
    'destination_id', v_dest.id,
    'beneficiary_id', v_pay.beneficiary_id,
    'amount',         v_pay.amount,
    'currency',       v_pay.currency,
    'country_code',   v_dest.country_code,
    'method',         v_dest.method,
    'mobile_no',      v_dest.mobile_no,
    'bank_key',       v_dest.bank_key,
    'account_number', v_dest.account_number,
    'account_name',   v_dest.account_name);
END $$;

-- Account numbers come out of this. It is for the server-side payout handler alone — no
-- browser role may call it, including an admin's.
REVOKE ALL ON FUNCTION public.payout_initiation_target(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.payout_initiation_target(uuid) TO service_role;

COMMENT ON FUNCTION public.payout_initiation_target(uuid) IS
  'The destination an authorised release must be sent to, from payments.destination_id as '
  'snapshotted at authorisation — never the beneficiary''s current default. Rechecks '
  'ownership and fails closed if the snapshotted destination is no longer eligible. The one '
  'source for the outbound createPayout() call. See 101.';

-- =========================================================
-- §2  102's correction — a deterministic phone backfill
--
-- The version production ran used a plain UPDATE ... FROM, which picks an ARBITRARY row when
-- an account holds more than one claimed application. Re-running the deterministic form cannot
-- undo a choice already made — there is no record of which row won — so §2b reports the
-- accounts where that could have happened rather than guessing a second time.
-- =========================================================

-- ── 4. Backfill the contractors already claimed ──────────
--
-- Everyone who claimed before this migration, whose application number is unambiguous.
--
-- ── The relationship is the one the claim established ────────────────────────────────
-- Joined on `contractor_applications.user_id`, which `claim_contractor_account` sets and
-- nothing else writes. NOT on an email match: `profiles.email = contractor_applications.email`
-- would look almost identical and would be a guess — the same address can appear on an
-- application that was never claimed, on a second application, or on somebody else's account
-- if it was ever reassigned. A wrong join here sends a client's WhatsApp messages to a
-- stranger, which is not a bug you find by reading a dashboard.
--
-- ── One account may hold more than one application ───────────────────────────────────
-- Nothing stops it: the claim refuses a SECOND account claiming the same application, not one
-- account claiming two applications. If two claimed applications disagree about the number,
-- there is no honest way to choose — newest is not more correct, it is just later. Those
-- accounts are LEFT ALONE and reported, and the contractor supplies the number themselves on
-- their own surface. `HAVING count(DISTINCT …) = 1` is what makes that decision, not a
-- `LIMIT 1` that would silently pick one.
--
-- Strictly fill-only: `p.phone IS NULL`. A number already on a profile is the person's own
-- and is never replaced by an older application's.
DO $$
DECLARE n int; v_skipped int;
BEGIN
  WITH candidate AS (
    -- One row per account, only where every claimed application agrees on the number.
    SELECT a.user_id,
           min(public.normalised_phone(a.phone)) AS phone
      FROM public.contractor_applications a
     WHERE a.user_id IS NOT NULL
       AND public.normalised_phone(a.phone) IS NOT NULL
     GROUP BY a.user_id
    HAVING count(DISTINCT public.normalised_phone(a.phone)) = 1
  ), filled AS (
    UPDATE public.profiles p
       SET phone = c.phone
      FROM candidate c
     WHERE c.user_id = p.id
       AND p.phone IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO n FROM filled;

  -- Accounts whose applications disagree. Reported, never resolved by picking one.
  SELECT count(*) INTO v_skipped FROM (
    SELECT a.user_id
      FROM public.contractor_applications a
     WHERE a.user_id IS NOT NULL
       AND public.normalised_phone(a.phone) IS NOT NULL
     GROUP BY a.user_id
    HAVING count(DISTINCT public.normalised_phone(a.phone)) > 1
  ) disagreeing;

  RAISE NOTICE '102: filled % contractor phone number(s) from their application', n;
  IF v_skipped > 0 THEN
    RAISE NOTICE '102: left % account(s) alone — their claimed applications disagree on the number', v_skipped;
  END IF;
END $$;

-- ── §2b. Accounts the earlier backfill may have resolved arbitrarily ──
--
-- Reported, never rewritten. A profile phone that matches one of several disagreeing
-- application numbers might have been chosen by the old backfill, or might have been typed by
-- the contractor themselves; nothing distinguishes them, and overwriting would be a second
-- guess on top of the first.
DO $$
DECLARE v_suspect int;
BEGIN
  SELECT count(*) INTO v_suspect
    FROM public.profiles p
   WHERE p.phone IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.contractor_applications a
        WHERE a.user_id = p.id
          AND public.normalised_phone(a.phone) IS NOT NULL
        GROUP BY a.user_id
       HAVING count(DISTINCT public.normalised_phone(a.phone)) > 1
     );
  IF v_suspect > 0 THEN
    RAISE NOTICE '104: % account(s) hold disagreeing claimed applications AND already have a phone - confirm these by hand before relying on them for WhatsApp', v_suspect;
  ELSE
    RAISE NOTICE '104: no account has a phone that an arbitrary backfill could have chosen';
  END IF;
END $$;

-- =========================================================
-- §3  103's corrections — pre-existing stages
--
-- Scoped tightly to `pre_existing = true` throughout. Nothing here touches an ordinary stage.
-- =========================================================

ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS pre_existing boolean NOT NULL DEFAULT false;

-- When GROUNDWORK recorded this as already built. Not when it was built — see the header.
ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS pre_existing_recorded_at timestamptz;

COMMENT ON COLUMN public.project_stages.pre_existing_recorded_at IS
  'When an administrator recorded this stage as already built. NOT the construction''s own '
  'completion date, which Groundwork does not know — `completed_at` stays NULL unless a '
  'historical date was actually supplied. See 103.';

-- ── Rows an EARLIER version of this file already wrote ───────────────────────────────
--
-- Every repair in this block runs BEFORE the three CHECK constraints below. Adding a
-- constraint first would abort on the rows the earlier run left behind, which is how
-- re-applying this file would otherwise fail halfway through a live database.
--
-- ── The completion guard is widened FIRST, so the repair has a sanctioned path ────────
-- 087's guard refuses any write of status='complete' outside approve_stage(). 103 widened it
-- by one writer: the joining path, and only while the row is also marked pre_existing. The
-- canonical repair below needs that same sanctioned context, so the widened guard is installed
-- here rather than assumed — a database that ran an older 103 may not have it, and the repair
-- must not depend on which form of the guard happens to be live. Triggers are never disabled.
-- Reproduced BYTE-IDENTICALLY from 103 so a database that already ran the amended 103 sees no
-- change here at all — proven by a schema-snapshot diff on that starting state.
CREATE OR REPLACE FUNCTION public.stages_guard_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete'
     AND current_setting('app.approve_stage', true)  IS DISTINCT FROM 'on'
     -- 103. The joining RPC, and only while it is also marking the row pre_existing: the
     -- flag alone is not a licence to complete a stage in any other way.
     AND NOT (current_setting('app.join_in_progress', true) = 'on' AND NEW.pre_existing) THEN
    RAISE EXCEPTION 'approve_via_rpc: a stage is completed through approve_stage(), not by updating status';
  END IF;
  RETURN NEW;
END $$;

-- The same flag `admin_start_project_at_stage` sets. Transaction-local, so it ends with this
-- migration's COMMIT and cannot leak into anything else.
SELECT set_config('app.join_in_progress', 'on', true);

-- ── Step 1. The recording date: move it, never invent it ──
--
-- Old 103 stamped `completed_at = now()` on every pre-existing stage. That value is not a
-- completion date — it is the moment an administrator recorded the stage, which is exactly what
-- `pre_existing_recorded_at` means. So it is MOVED, and `completed_at` returns to NULL because
-- we still do not know when the work was built.
--
-- There is deliberately NO `now()` fallback. Running this file on 2 October does not prove an
-- administrator recorded anything on 2 October, and the column is documented as a fact about
-- when we wrote it down. An unknown stays unknown; step 2 recovers it from an authoritative
-- event where one exists, and step 3 refuses to proceed where none does.
UPDATE public.project_stages
   SET pre_existing_recorded_at = COALESCE(pre_existing_recorded_at, completed_at),
       completed_at             = NULL
 WHERE pre_existing
   AND (pre_existing_recorded_at IS NULL OR completed_at IS NOT NULL);

-- ── Step 2. Recover a missing date from the project's own joining event ──
--
-- `project.joined_in_progress` is written by `admin_start_project_at_stage` in the SAME
-- transaction that marks the stages pre-existing, so its `created_at` IS the moment the
-- administrator recorded them. Applied only where a project has EXACTLY ONE such row, which
-- makes the relationship provably 1:1 for that project; two joining events would make it
-- ambiguous which stages belong to which, and those are left for step 3.
WITH one_event AS (
  SELECT project_id, min(created_at) AS recorded_at
    FROM public.project_audit_log
   WHERE action = 'project.joined_in_progress'
     AND project_id IS NOT NULL
   GROUP BY project_id
  HAVING count(*) = 1
)
UPDATE public.project_stages ps
   SET pre_existing_recorded_at = e.recorded_at
  FROM one_event e
 WHERE ps.project_id = e.project_id
   AND ps.pre_existing
   AND ps.pre_existing_recorded_at IS NULL;

-- ── Step 3. Anything still undated aborts the migration ──
--
-- The constraint below requires every pre-existing row to carry a recording date. Rather than
-- fabricate one to satisfy it, this names the projects and stops. Resolve by hand, then re-run.
DO $$
DECLARE v_bad int; v_ids text;
BEGIN
  SELECT count(*), string_agg(DISTINCT project_id::text, ', ')
    INTO v_bad, v_ids
    FROM public.project_stages
   WHERE pre_existing AND pre_existing_recorded_at IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'unresolved_recording_date: % pre-existing stage(s) carry no recording date, and their project has no single project.joined_in_progress audit row to recover one from (projects: %). Supply a date by hand, then re-run 104.', v_bad, v_ids;
  END IF;
END $$;

-- ── Step 4. Canonicalise the two fields the constraints will police ──
--
-- Old 103 set these on the rows it wrote, but a row touched by anything since — or written by
-- an even earlier draft — may not satisfy them. They are repaired here, under the guard context
-- set above, so the constraints below are added to data that already complies.
UPDATE public.project_stages
   SET status                = 'complete',
       verification_required = false
 WHERE pre_existing
   AND (status IS DISTINCT FROM 'complete' OR verification_required IS DISTINCT FROM false);

-- Pinned before the constraints are added: the three counts must agree, or something below
-- would fail on data this step was supposed to have fixed.
DO $$
DECLARE v_all int; v_done int; v_unverified int;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status = 'complete'),
         count(*) FILTER (WHERE verification_required = false)
    INTO v_all, v_done, v_unverified
    FROM public.project_stages WHERE pre_existing;
  IF v_all <> v_done OR v_all <> v_unverified THEN
    RAISE EXCEPTION 'canonical_repair_incomplete: % pre-existing stage(s), % complete, % unverified - the constraints below would fail', v_all, v_done, v_unverified;
  END IF;
  RAISE NOTICE '104: % pre-existing stage(s) canonical (complete, unverified, dated)', v_all;
END $$;

-- Same reasoning for their substages: the earlier run closed them out without clearing an
-- approver, and nobody at Groundwork approved this work.
UPDATE public.project_substages sub
   SET approved_by = NULL, approved_at = NULL
  FROM public.project_stages ps
 WHERE sub.stage_id = ps.id
   AND ps.pre_existing
   AND (sub.approved_by IS NOT NULL OR sub.approved_at IS NOT NULL);

-- A pre-existing stage carries its recording date, and nothing else carries one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_stages_pre_existing_dated') THEN
    ALTER TABLE public.project_stages
      ADD CONSTRAINT project_stages_pre_existing_dated
      CHECK (pre_existing = (pre_existing_recorded_at IS NOT NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.project_stages.pre_existing IS
  'TRUE when this stage was already built before the project joined Groundwork. Complete, '
  'but never approved by us, never verified by us and never funded through us — so it '
  'carries no certificate and no milestone. See 103.';

-- A stage cannot be "already built" and still waiting: the whole point is that it is done.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_stages_pre_existing_is_complete') THEN
    ALTER TABLE public.project_stages
      ADD CONSTRAINT project_stages_pre_existing_is_complete
      CHECK (NOT pre_existing OR status = 'complete');
  END IF;
END $$;

-- Nothing we did not watch may ever claim verification. Belt and braces with the RPC, which
-- sets the flag false itself: this refuses a later hand-edit too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_stages_pre_existing_unverified') THEN
    ALTER TABLE public.project_stages
      ADD CONSTRAINT project_stages_pre_existing_unverified
      CHECK (NOT pre_existing OR verification_required = false);
  END IF;
END $$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS joined_at_stage integer
    CHECK (joined_at_stage IS NULL OR joined_at_stage BETWEEN 1 AND 10);

COMMENT ON COLUMN public.projects.joined_at_stage IS
  'The stage this build had reached when it joined Groundwork, when it did not join at the '
  'beginning. NULL for an ordinary new build. See 103.';

-- ── 3. A pre-existing stage can never present a release ───
--
-- 090's `stage_release_blocker` would already refuse one, but only incidentally: the milestone
-- is 0, `amount > 0` is a CHECK on the payments table, so the refusal arrives as
-- `over_milestone` — the wrong reason, and only AFTER a screen may already have offered the
-- action. The reviewer's objection is right: eligibility must not depend on a later constraint
-- exploding.
--
-- So the reason is named first and explicitly. `stage_release_blocker` is restated here in
-- full with one clause added at the top of its checks; every other line is 090's, unchanged.
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

  -- NEW IN 103, and deliberately before everything else. Work Groundwork never funded has
  -- nothing to release, and saying so by name means the UI can explain it rather than
  -- offering a button that fails.
  IF v_stage.pre_existing THEN RETURN 'pre_existing'; END IF;

  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;
  IF v_project.status = 'on_hold' THEN RETURN 'on_hold'; END IF;
  IF v_stage.status <> 'complete' THEN RETURN 'not_complete'; END IF;
  IF v_stage.verification_required THEN
    SELECT decision INTO v_decision FROM public.stage_verifications
     WHERE stage_id = p_stage ORDER BY requested_at DESC, created_at DESC LIMIT 1;
    IF v_decision IS DISTINCT FROM 'verified' THEN RETURN 'not_verified'; END IF;
  END IF;
  -- A stage with no milestone owes nothing, whether or not it is pre-existing.
  IF COALESCE(v_stage.payment_milestone_usd, 0) <= 0 THEN RETURN 'nothing_due'; END IF;
  IF p_amount > v_stage.payment_milestone_usd THEN RETURN 'over_milestone'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_funded FROM public.payments
   WHERE project_id = v_stage.project_id AND direction = 'in' AND state IN ('funded', 'reconciled');
  SELECT COALESCE(sum(amount), 0) INTO v_out FROM public.payments
   WHERE project_id = v_stage.project_id AND direction = 'out' AND state <> 'failed';
  IF v_funded - v_out < p_amount THEN RETURN 'insufficient_funds'; END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.stage_release_blocker(uuid, numeric) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.stage_release_blocker(uuid, numeric) IS
  'Why a release for this stage cannot be authorised, or NULL when it can. 103 adds '
  '`pre_existing` (work Groundwork never funded) and `nothing_due` (no milestone) as named '
  'reasons ahead of the amount checks, so no surface can offer a release that would then be '
  'refused by a constraint. See 090, 103.';

-- ── 4. Start a project at the stage it has actually reached ─
--
-- Deliberately a SEPARATE function from `admin_start_project_tracking` rather than another
-- parameter on it. That one is called by the ordinary creation path and has been rewritten
-- four times (019, 036, 041, 072); adding a stage argument would change the meaning of every
-- existing call site and force its grant to be reissued. This one composes with it instead:
-- same milestone application, then the backdating.
CREATE OR REPLACE FUNCTION public.admin_start_project_at_stage(
  p_project_id       uuid,
  p_final_budget     numeric,
  p_construction_fee numeric,
  p_design_fee       numeric,
  p_permit_fee       numeric,
  p_professional_fee numeric,
  p_verification_fee numeric,
  p_contingency_fee  numeric,
  p_start_stage      integer,
  -- What the contractor said, verbatim. The reason this project starts where it does has to
  -- outlive the admin who typed it, and "why is stage 4 complete with no evidence?" is a
  -- question somebody will ask in a year.
  p_note             text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stages   integer;
  v_start    integer;
  v_skipped  integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: admins only'; END IF;

  SELECT count(*) INTO v_stages FROM public.project_stages WHERE project_id = p_project_id;
  IF v_stages = 0 THEN RAISE EXCEPTION 'no_stages: this project has no stage schedule yet'; END IF;

  v_start := COALESCE(p_start_stage, 1);
  IF v_start < 1 OR v_start > v_stages THEN
    RAISE EXCEPTION 'bad_stage: % is not a stage on this project (1..%)', v_start, v_stages;
  END IF;
  -- The last stage is the handover. A project cannot JOIN at its own completion — there
  -- would be nothing left to track, and it would arrive with every stage marked done by
  -- somebody's typed sentence.
  IF v_start = v_stages THEN
    RAISE EXCEPTION 'nothing_left: a project cannot join at its final stage';
  END IF;

  UPDATE public.projects
     SET budget_usd          = p_final_budget,
         tracking_started_at = now(),
         joined_at_stage     = CASE WHEN v_start > 1 THEN v_start ELSE NULL END,
         updated_at          = now()
   WHERE id = p_project_id
     AND tracking_started_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'already_started: project not found, or tracking already started';
  END IF;

  -- Every stage gets its true milestone from the full construction fee, exactly as an
  -- ordinary build would. The skipped ones are zeroed below, so a remaining stage costs the
  -- same whether the project joined at stage 1 or stage 6.
  PERFORM public.apply_budget_milestones(
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee,
    p_professional_fee, p_verification_fee, p_contingency_fee);

  PERFORM set_config('app.join_in_progress', 'on', true);

  -- ── The stages that were already built ──
  -- One statement: complete, pre-existing, nothing owed, nothing to verify.
  --
  -- `completed_at` is deliberately left NULL. We do not know when this was built, and
  -- stamping today's date would put a fiction into every timeline and export that reads it.
  -- `pre_existing_recorded_at` carries the only date we actually know: when we wrote this down.
  UPDATE public.project_stages
     SET status                   = 'complete',
         pre_existing             = true,
         pre_existing_recorded_at = now(),
         verification_required    = false,
         payment_milestone_usd    = 0,
         fixed_amount_usd         = 0,
         completed_at             = NULL
   WHERE project_id = p_project_id AND stage_number < v_start;
  GET DIAGNOSTICS v_skipped = ROW_COUNT;

  -- `approved_by` and `approved_at` stay NULL: nobody at Groundwork approved these. A
  -- substage marked complete with an approver would name somebody who never saw the work.
  UPDATE public.project_substages sub
     SET status = 'complete', approved_by = NULL, approved_at = NULL
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number < v_start;

  -- ── The stage they are actually on ──
  UPDATE public.project_stages
     SET status = 'active'
   WHERE project_id = p_project_id AND stage_number = v_start;

  UPDATE public.project_substages sub
     SET status = 'pending'
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number = v_start
     AND sub.status = 'locked';

  UPDATE public.projects SET current_stage = v_start WHERE id = p_project_id;

  -- Why this project starts where it does, kept with the project rather than in a ticket.
  PERFORM public.log_activity(p_project_id, 'project.joined_in_progress', 'project', p_project_id, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'start_stage', v_start,
      'stages_marked_pre_existing', v_skipped,
      'budget_usd', p_final_budget,
      'described_as', NULLIF(btrim(p_note), ''))));

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'start_stage', v_start,
    'pre_existing_stages', v_skipped);
END $$;

REVOKE ALL ON FUNCTION public.admin_start_project_at_stage(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_start_project_at_stage(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text) TO authenticated;

COMMENT ON FUNCTION public.admin_start_project_at_stage(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text) IS
  'Start tracking a build that was already under way: stages below p_start_stage are marked '
  'complete and pre_existing — no milestone, no verification, no certificate — and the '
  'project becomes active at p_start_stage. See 103.';
-- =========================================================
-- Verify — every object this file exists to install
-- =========================================================
SELECT 'bank_key present (expect 1)' AS what, count(*)::text AS n
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='payout_destinations' AND column_name='bank_key'
UNION ALL
SELECT 'bank_code gone (expect 0)', count(*)::text
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='payout_destinations' AND column_name='bank_code'
UNION ALL
SELECT 'add_payout_destination takes p_bank_key (expect 1)', count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='add_payout_destination'
   AND 'p_bank_key' = ANY(p.proargnames)
UNION ALL
SELECT 'payout_initiation_target present (expect 1)', count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='payout_initiation_target'
UNION ALL
SELECT 'retire constraint is one-directional (expect 1)', count(*)::text
  FROM pg_constraint
 WHERE conname='payout_destination_verified_dated'
   AND pg_get_constraintdef(oid) LIKE '%<>%verified%OR%verified_at IS NOT NULL%'
UNION ALL
SELECT 'pre_existing_recorded_at present (expect 1)', count(*)::text
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='project_stages' AND column_name='pre_existing_recorded_at'
UNION ALL
SELECT 'stage_release_blocker names pre_existing (expect 1)', count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='stage_release_blocker'
   AND pg_get_functiondef(p.oid) LIKE '%RETURN ''pre_existing''%'
UNION ALL
SELECT 'join RPC no longer stamps completed_at (expect 1)', count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_start_project_at_stage'
   AND pg_get_functiondef(p.oid) LIKE '%completed_at             = NULL%'
-- ── data invariants, the whole point of the repair ──
UNION ALL
SELECT 'pre-existing stages claiming a build date (expect 0)', count(*)::text
  FROM public.project_stages WHERE pre_existing AND completed_at IS NOT NULL
UNION ALL
SELECT 'pre-existing stages missing a recording date (expect 0)', count(*)::text
  FROM public.project_stages WHERE pre_existing AND pre_existing_recorded_at IS NULL
UNION ALL
SELECT 'pre-existing substages naming an approver (expect 0)', count(*)::text
  FROM public.project_substages s JOIN public.project_stages ps ON ps.id = s.stage_id
 WHERE ps.pre_existing AND (s.approved_by IS NOT NULL OR s.approved_at IS NOT NULL)
UNION ALL
SELECT 'profiles holding an unmessageable phone (expect 0)', count(*)::text
  FROM public.profiles WHERE phone IS NOT NULL AND NOT public.is_e164(phone);

-- =========================================================
-- Fail closed — assert the final state, then COMMIT
--
-- The SELECT above is for a human to read. It cannot stop anything: a line reading
-- "bank_code gone (expect 0) = 1" would print and the transaction would commit regardless.
-- This block is the gate. Every critical invariant is proven or the whole migration aborts and
-- rolls back to its pre-104 state.
-- =========================================================
DO $$
DECLARE
  v_fail text[] := '{}';
  v_n    int;
BEGIN
  -- ── §1, the payout model ──
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='payout_destinations'
                    AND column_name='bank_key') THEN
    v_fail := v_fail || 'bank_key is absent';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='payout_destinations'
                AND column_name='bank_code') THEN
    v_fail := v_fail || 'the old bank_code column still exists';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='add_payout_destination'
                    AND 'p_bank_key' = ANY(p.proargnames)) THEN
    v_fail := v_fail || 'add_payout_destination does not expose p_bank_key';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='payout_initiation_target') THEN
    v_fail := v_fail || 'payout_initiation_target is absent';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='payout_destination_verified_dated'
                    AND pg_get_constraintdef(oid) LIKE '%<>%verified%OR%verified_at IS NOT NULL%') THEN
    v_fail := v_fail || 'the retirement constraint is not one-directional';
  END IF;

  -- ── §3, pre-existing stages ──
  SELECT count(*) INTO v_n FROM public.project_stages
   WHERE pre_existing AND completed_at IS NOT NULL;
  IF v_n > 0 THEN v_fail := v_fail || (v_n || ' pre-existing stage(s) still claim a build date'); END IF;

  SELECT count(*) INTO v_n FROM public.project_stages
   WHERE pre_existing AND pre_existing_recorded_at IS NULL;
  IF v_n > 0 THEN v_fail := v_fail || (v_n || ' pre-existing stage(s) carry no recording date'); END IF;

  SELECT count(*) INTO v_n FROM public.project_stages
   WHERE pre_existing AND status IS DISTINCT FROM 'complete';
  IF v_n > 0 THEN v_fail := v_fail || (v_n || ' pre-existing stage(s) are not complete'); END IF;

  SELECT count(*) INTO v_n FROM public.project_stages
   WHERE pre_existing AND verification_required IS DISTINCT FROM false;
  IF v_n > 0 THEN v_fail := v_fail || (v_n || ' pre-existing stage(s) still require verification'); END IF;

  SELECT count(*) INTO v_n FROM public.project_substages s
    JOIN public.project_stages ps ON ps.id = s.stage_id
   WHERE ps.pre_existing AND (s.approved_by IS NOT NULL OR s.approved_at IS NOT NULL);
  IF v_n > 0 THEN v_fail := v_fail || (v_n || ' pre-existing substage(s) still name an approver'); END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='stage_release_blocker'
                    AND pg_get_functiondef(p.oid) LIKE '%RETURN ''pre_existing''%') THEN
    v_fail := v_fail || 'stage_release_blocker does not refuse a pre-existing stage by name';
  END IF;

  -- ── §2, phones ──
  SELECT count(*) INTO v_n FROM public.profiles
   WHERE phone IS NOT NULL AND NOT public.is_e164(phone);
  IF v_n > 0 THEN v_fail := v_fail || (v_n || ' profile(s) hold an unmessageable phone'); END IF;

  IF array_length(v_fail, 1) > 0 THEN
    RAISE EXCEPTION E'104 reconciliation FAILED - rolling back. Unmet invariants:\n  - %',
      array_to_string(v_fail, E'\n  - ');
  END IF;

  RAISE NOTICE '104: all invariants hold. Committing.';
END $$;

COMMIT;

-- ── Rollback (not run) ───────────────────────────────────
-- There is no safe reverse. The rename carries data, the timestamp repair removes a false
-- claim, and the phone fills are the people's own numbers. To undo the CODE side, restore
-- add_payout_destination / stage_release_blocker / admin_start_project_at_stage from 099, 090
-- and the pre-review 103 respectively, and rename bank_key back — but do not "restore" a
-- completed_at that was never a completion date.
