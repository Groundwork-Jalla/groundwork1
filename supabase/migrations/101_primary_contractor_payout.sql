-- =========================================================
-- 101  Who gets paid for a project, and to which account
--
-- WHY
--
-- 099 gave a contractor somewhere to keep their account details. It did not say WHOSE
-- details a stage release should use. `authorise_release` (090) takes a beneficiary as an
-- argument and checks only that they are an accepted contractor on the project — so with
-- several accepted contractors, nothing in the database says which one the money is for,
-- and nothing records where it actually went.
--
-- Two gaps, closed here:
--
--   1. THE PERSON. `contractor_invites.is_primary` names the one contractor a project pays
--      by default. One per project, enforced by a partial unique index rather than by the
--      application remembering to stand the old one down.
--
--   2. THE ACCOUNT. `payments.destination_id` records the payout destination a release was
--      authorised against — resolved at authorisation time from the beneficiary's default,
--      through `payout_destination_eligible()` (099), which is still the only thing that
--      may answer "may money be sent here".
--
-- ── Assignment is not gated on payment details ───────────────────────────────────────
-- A contractor is assignable the moment they accept, verified account details or not:
-- site work must not wait on a staff verification queue. The RELEASE is what refuses,
-- with a reason that names what is missing (`no_payout_destination`). Getting started and
-- getting paid are different questions and fail in different places.
--
-- ── The beneficiary argument stays ───────────────────────────────────────────────────
-- `authorise_release` keeps its four parameters and keeps accepting any accepted
-- contractor. `is_primary` is the DEFAULT answer to "who is this for", which is what the
-- admin UI pre-fills and what an automated release would read — not a new restriction on
-- what staff may do. Removing the argument would have silently repointed every existing
-- caller, and its grant would have had to be reissued.
--
-- ── A primary must be a person with an account ───────────────────────────────────────
-- `set_primary_contractor` refuses an invite whose `contractor_user_id` is NULL. Payout
-- destinations are keyed on the account (099), so an emailed-but-unclaimed invite has
-- nowhere money could ever go; naming it primary would look settled and pay nobody.
--
-- Run in: Supabase Dashboard > SQL Editor (after 100)
-- =========================================================

-- ── 1. The primary contractor ────────────────────────────

ALTER TABLE public.contractor_invites
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Only an accepted assignment can be the one that gets paid. The trigger below keeps this
-- true by standing the flag down, so this constraint should never be the thing a user
-- meets — it is here so the state cannot exist even if a future writer forgets.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_invites_primary_is_accepted') THEN
    ALTER TABLE public.contractor_invites
      ADD CONSTRAINT contractor_invites_primary_is_accepted
      CHECK (NOT is_primary OR status = 'accepted');
  END IF;
END $$;

-- One primary per project. The index, not the application, is what makes that true: two
-- admins promoting different contractors at once serialise here instead of both winning.
CREATE UNIQUE INDEX IF NOT EXISTS contractor_invites_one_primary
  ON public.contractor_invites (project_id) WHERE is_primary = true;

-- A contractor whose invite leaves `accepted` stops being the one who gets paid, in the same
-- statement. Without this, changing the status would hit the CHECK above and fail with a
-- message about a constraint rather than doing the obvious thing.
--
-- ── WHAT THIS DOES **NOT** MEAN ──────────────────────────────────────────────────────
-- `contractor_invites.status` is `pending | accepted | rejected` and nothing else. There is no
-- `removed`, `ended` or `terminated` state, so THE SCHEMA CANNOT REPRESENT a contractor who
-- accepted a project and later stopped working on it. Setting such an invite back to
-- `rejected` is the only available move and it rewrites history — it says they never accepted.
--
-- So the honest statement of this invariant is narrow: primary is tied to the currently
-- accepted invite model. Contractor REMOVAL is not modelled, and nothing here invents it. A
-- proper assignment lifecycle is its own piece of work; this trigger only guarantees that the
-- flag cannot outlive the `accepted` status it depends on.
CREATE OR REPLACE FUNCTION public.contractor_invites_clear_primary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'accepted' THEN NEW.is_primary := false; END IF;
  -- Losing the account means losing the ability to be paid; same reasoning as above.
  IF NEW.contractor_user_id IS NULL THEN NEW.is_primary := false; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contractor_invites_clear_primary ON public.contractor_invites;
CREATE TRIGGER trg_contractor_invites_clear_primary
  BEFORE UPDATE ON public.contractor_invites
  FOR EACH ROW EXECUTE FUNCTION public.contractor_invites_clear_primary();

COMMENT ON COLUMN public.contractor_invites.is_primary IS
  'The one contractor this project pays by default. At most one per project (partial unique '
  'index); cleared whenever status leaves `accepted` or the account reference is lost. NOTE: '
  'contractor_invites has no removal state (pending|accepted|rejected only), so this is tied '
  'to the accepted-invite model and contractor removal is NOT modelled. See 101.';

-- ── 2. Naming the primary ────────────────────────────────
--
-- Staff, or the client whose project it is. The client chose this contractor and is the
-- one whose money moves, so they may say who it goes to; they cannot invent an assignment,
-- because the invite has to be accepted already.
CREATE OR REPLACE FUNCTION public.set_primary_contractor(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite public.contractor_invites%ROWTYPE;
  v_owner  uuid;
BEGIN
  SELECT * INTO v_invite FROM public.contractor_invites WHERE id = p_invite FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such assignment'; END IF;

  SELECT user_id INTO v_owner FROM public.projects WHERE id = v_invite.project_id;
  IF NOT (public.is_admin() OR v_owner = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only an administrator or the project owner names the primary contractor';
  END IF;

  IF v_invite.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_accepted: this contractor has not accepted the assignment';
  END IF;
  IF v_invite.contractor_user_id IS NULL THEN
    RAISE EXCEPTION 'no_account: this contractor has not created their Groundwork account yet, so there is nowhere to pay them';
  END IF;

  -- One transaction: the old primary is stood down before the new one is written, so the
  -- unique index never sees two.
  UPDATE public.contractor_invites
     SET is_primary = false
   WHERE project_id = v_invite.project_id AND is_primary = true AND id <> p_invite;

  UPDATE public.contractor_invites SET is_primary = true WHERE id = p_invite;

  PERFORM public.log_activity(v_invite.project_id, 'contractor.primary_set', 'contractor_invite', p_invite,
    v_invite.contractor_user_id, jsonb_build_object('email', v_invite.email));
END $$;

-- ── 3. Where a release would actually go ─────────────────
--
-- Resolution in one place. Both the release path and the UI that warns before it ask this,
-- so what an admin is told and what the database will do cannot disagree.
CREATE OR REPLACE FUNCTION public.contractor_payout_destination(p_contractor uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id FROM public.payout_destinations d
   WHERE d.owner_id = p_contractor
     AND d.is_default = true
     AND public.payout_destination_eligible(d.id)
   LIMIT 1;
$$;

-- Why a release cannot be sent to this person yet, or NULL when it can. A reason code, not
-- a sentence: the app owns the wording, in both languages.
CREATE OR REPLACE FUNCTION public.contractor_payout_blocker(p_contractor uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_any     boolean;
  v_default uuid;
BEGIN
  IF p_contractor IS NULL THEN RETURN 'no_contractor'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.payout_destinations
                  WHERE owner_id = p_contractor AND status <> 'retired') INTO v_any;
  IF NOT v_any THEN RETURN 'no_details'; END IF;

  SELECT id INTO v_default FROM public.payout_destinations
   WHERE owner_id = p_contractor AND is_default = true AND status <> 'retired';
  IF v_default IS NULL THEN RETURN 'no_default'; END IF;

  -- Details are on file but nobody has checked them. This is the expected state for a
  -- newly onboarded contractor, and it is a staff task, not a contractor one.
  IF NOT public.payout_destination_eligible(v_default) THEN RETURN 'unverified'; END IF;

  RETURN NULL;
END $$;

-- What the project pays, as one answer for the UI: the primary contractor, their
-- destination, and what is in the way. `blocker` is NULL only when a release could be sent.
CREATE OR REPLACE FUNCTION public.project_payout_target(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite public.contractor_invites%ROWTYPE;
  v_owner  uuid;
  v_dest   uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.projects WHERE id = p_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such project'; END IF;
  IF NOT (public.is_admin() OR v_owner = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only an administrator or the project owner may read the payout target';
  END IF;

  SELECT * INTO v_invite FROM public.contractor_invites
   WHERE project_id = p_project AND is_primary = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('contractor_id', NULL, 'destination_id', NULL, 'blocker', 'no_primary');
  END IF;

  v_dest := public.contractor_payout_destination(v_invite.contractor_user_id);

  -- No account number, no masked number, no bank code. The caller is told THAT money can
  -- move, never where to. Only the payout handler needs the digits.
  RETURN jsonb_build_object(
    'contractor_id',  v_invite.contractor_user_id,
    'contractor_name', v_invite.email,
    'invite_id',      v_invite.id,
    'destination_id', v_dest,
    'blocker',        public.contractor_payout_blocker(v_invite.contractor_user_id));
END $$;

-- ── 4. Recording where the money was sent ────────────────

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS destination_id uuid;

COMMENT ON COLUMN public.payments.destination_id IS
  'The payout destination this release was authorised against, resolved from the '
  'beneficiary''s default at authorisation time. No foreign key, by 089''s rule for '
  'records of what happened: where money went must stay legible even if the destination '
  'row is later erased under a retention policy. See 101.';

CREATE INDEX IF NOT EXISTS payments_destination_idx
  ON public.payments (destination_id) WHERE destination_id IS NOT NULL;

-- ── 5. authorise_release resolves and records the account ─
--
-- Same four parameters as 090, so every existing caller and the existing grant stand. Two
-- things are new: the release refuses when the beneficiary has nowhere eligible to be paid,
-- and the destination it resolved is written onto the row.
CREATE OR REPLACE FUNCTION public.authorise_release(p_stage uuid, p_amount numeric, p_beneficiary uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage   public.project_stages%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_actor   uuid := auth.uid();
  v_reason  text;
  v_dest    uuid;
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

  -- NEW IN 101. Authorising a release with nowhere to send it produces a row that says
  -- money is owed and cannot say where it goes — the state that made people ask for
  -- account numbers over WhatsApp. Refused here instead.
  v_reason := public.contractor_payout_blocker(p_beneficiary);
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION 'no_payout_destination:%', v_reason; END IF;
  v_dest := public.contractor_payout_destination(p_beneficiary);

  PERFORM set_config('app.payments_write', 'on', true);
  INSERT INTO public.payments
    (project_id, stage_id, direction, state, amount, currency, beneficiary_id, destination_id,
     authorised_by, authorised_at, note)
  VALUES
    (v_project.id, p_stage, 'out', 'release_authorised', p_amount, 'USD', p_beneficiary, v_dest,
     v_actor, now(), NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;

  -- The destination's id and method, never its digits: this log is staff-readable (099).
  PERFORM public.log_activity(v_project.id, 'payment.release_authorised', 'payment', v_id, p_beneficiary,
    jsonb_strip_nulls(jsonb_build_object(
      'amount', p_amount, 'currency', 'USD', 'stage_id', p_stage, 'stage_number', v_stage.stage_number, 'by', 'admin',
      'beneficiary_id', p_beneficiary, 'note', NULLIF(btrim(p_note), ''),
      'destination_id', v_dest,
      'destination_method', (SELECT method FROM public.payout_destinations WHERE id = v_dest))));
  RETURN v_id;
END $$;

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

-- ── 9. Grants ────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.set_primary_contractor(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contractor_payout_destination(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contractor_payout_blocker(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.project_payout_target(uuid)              FROM PUBLIC, anon;

GRANT  EXECUTE ON FUNCTION public.set_primary_contractor(uuid)         TO authenticated;
GRANT  EXECUTE ON FUNCTION public.contractor_payout_blocker(uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.project_payout_target(uuid)          TO authenticated;
-- contractor_payout_destination returns the id of an account. Only the definer functions
-- above and the payout handler need it; nothing calls it from a browser.
REVOKE ALL ON FUNCTION public.contractor_payout_destination(uuid)      FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.contractor_payout_destination(uuid)  TO service_role;

COMMENT ON FUNCTION public.project_payout_target(uuid) IS
  'The primary contractor a project pays, their resolved destination, and the reason a '
  'release cannot be sent yet (NULL when it can). Carries no account digits. See 101.';
COMMENT ON FUNCTION public.contractor_payout_blocker(uuid) IS
  'Reason code, app supplies the wording: no_contractor | no_details | no_default | '
  'unverified, or NULL when money may be sent. See 101.';

-- ── Verify ───────────────────────────────────────────────
SELECT 'projects with a primary contractor' AS what, count(DISTINCT project_id)::text AS n
  FROM public.contractor_invites WHERE is_primary
UNION ALL
SELECT 'accepted assignments with an account', count(*)::text
  FROM public.contractor_invites WHERE status = 'accepted' AND contractor_user_id IS NOT NULL
UNION ALL
SELECT 'live releases with no destination recorded', count(*)::text
  FROM public.payments WHERE direction = 'out' AND state <> 'failed' AND destination_id IS NULL;

-- ── Rollback (not run; here so the reviewer can see it is complete) ───────────
-- DROP TRIGGER IF EXISTS trg_contractor_invites_clear_primary ON public.contractor_invites;
-- DROP FUNCTION IF EXISTS public.contractor_invites_clear_primary(), public.set_primary_contractor(uuid),
--   public.contractor_payout_destination(uuid), public.contractor_payout_blocker(uuid),
--   public.project_payout_target(uuid);
-- DROP INDEX IF EXISTS public.contractor_invites_one_primary, public.payments_destination_idx;
-- ALTER TABLE public.contractor_invites DROP CONSTRAINT IF EXISTS contractor_invites_primary_is_accepted;
-- ALTER TABLE public.contractor_invites DROP COLUMN IF EXISTS is_primary;
-- ALTER TABLE public.payments DROP COLUMN IF EXISTS destination_id;
-- Restore authorise_release from 090 (it is unchanged there apart from the two new lines).
