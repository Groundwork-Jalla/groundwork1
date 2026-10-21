-- =========================================================
-- 141 — A mason is not an architect: the licence number becomes optional
--
-- Reported by an applicant, 22 Oct:
--
--   "I'm a mason and bricklayer in Cameroon with several years of practical
--    construction experience, working independently without a formal professional
--    licence or registered company. Could you please advise me on how I can register
--    correctly?"
--
-- He cannot. 116 requires a licence number in three places — the input, this RPC, and
-- the completion rule — so an independent tradesperson is stopped at step three of
-- seven and there is no way round it.
--
-- ── What the data says ───────────────────────────────────
-- Of the contractor onboarding records on this database, 14 of 17 are INDEPENDENT and
-- none is a registered business. Every one of those 14 had to put something in a
-- mandatory licence box. What they put includes "No", several strings of keyboard
-- noise, and one Registre du Commerce number — a company registration, which is not a
-- professional licence at all.
--
-- So the requirement is not producing credentials. It is producing junk from the people
-- who stay and turning away the ones who are honest about not having one. That is the
-- worse half of the trade: the field Jalla would vet somebody on is already unreliable.
--
-- ── What changes ─────────────────────────────────────────
-- The licence number stays — an engineer or an architect has one and should give it —
-- but it stops being a gate. What is actually required of everyone is the answer to how
-- they trade; and a REGISTERED business still owes its name and registration number,
-- which this migration does not touch.
--
-- This does not loosen who becomes a PARTNER. Philip's sequence keeps contractor
-- access, partner acceptance and Certified Partner status as three different things:
-- vetting happens at the application and the call, not at the door.
--
-- Run in: Supabase Dashboard > SQL Editor (after 140)
-- =========================================================

BEGIN;

-- ── 1. Saving no longer refuses an empty licence ─────────
CREATE OR REPLACE FUNCTION public.save_contractor_business(
  p_license_number text,
  p_business_status text,
  p_business_name   text DEFAULT NULL,
  p_business_reg_number text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.assert_own_onboarding();
  v_name text := NULLIF(btrim(coalesce(p_business_name, '')), '');
  v_reg  text := NULLIF(btrim(coalesce(p_business_reg_number, '')), '');
BEGIN
  -- The licence is no longer demanded (141). Stored when given, NULL when not — rather
  -- than an empty string, so "has no licence" and "left it blank" read the same way to
  -- anybody querying this column.
  IF p_business_status NOT IN ('registered', 'independent') THEN
    RAISE EXCEPTION 'business_status_required: say whether you are a registered business or independent';
  END IF;
  IF p_business_status = 'registered' AND (v_name IS NULL OR v_reg IS NULL) THEN
    RAISE EXCEPTION 'business_details_required: a registered business needs its name and registration number';
  END IF;

  -- An independent contractor keeps no company name: switching from registered clears
  -- both, rather than leaving a stale company attached to a sole trader.
  IF p_business_status = 'independent' THEN
    v_name := NULL; v_reg := NULL;
  END IF;

  INSERT INTO public.contractor_onboarding
    (user_id, license_number, business_status, business_name, business_reg_number)
  VALUES (v_user, NULLIF(btrim(coalesce(p_license_number, '')), ''),
          p_business_status, v_name, v_reg)
  ON CONFLICT (user_id) DO UPDATE
    SET license_number      = EXCLUDED.license_number,
        business_status     = EXCLUDED.business_status,
        business_name       = EXCLUDED.business_name,
        business_reg_number = EXCLUDED.business_reg_number,
        updated_at          = now();

  RETURN public.contractor_onboarding_status(v_user);
END $$;

REVOKE ALL ON FUNCTION public.save_contractor_business(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_contractor_business(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.save_contractor_business(text, text, text, text) IS
  'Saves how a contractor trades (116, licence made optional in 141). The licence is '
  'kept when offered and NULL otherwise; what everyone must answer is registered or '
  'independent, and a registered business still owes its name and number.';


-- ── 2. Completion no longer waits on a licence ───────────
CREATE OR REPLACE FUNCTION public.contractor_onboarding_status(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := coalesce(p_user, auth.uid());
  r      public.contractor_onboarding%ROWTYPE;
  v_identity     boolean;
  v_professional boolean;
  v_payout       boolean;
  v_emergency    boolean;
  v_documents    boolean;
  v_agreements   boolean;
  v_registered   boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: no account to report on';
  END IF;
  IF v_user <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: that is not your onboarding';
  END IF;

  SELECT * INTO r FROM public.contractor_onboarding WHERE user_id = v_user;

  v_identity := r.date_of_birth IS NOT NULL
            AND coalesce(btrim(r.residential_address), '') <> '';

  v_registered := r.business_status = 'registered';

  -- 141: the licence is no longer part of this. How they trade is the answer that is
  -- actually required of everybody, and the CHECK on the table already guarantees a
  -- registered business carries its name and number.
  v_professional := r.business_status IS NOT NULL;

  v_payout := EXISTS (
    SELECT 1 FROM public.payout_destinations
     WHERE owner_id = v_user AND status <> 'retired'
  );

  v_emergency := (
    SELECT count(*) FROM public.contractor_emergency_contacts WHERE user_id = v_user
  ) = 3;

  v_documents := EXISTS (
      SELECT 1 FROM public.contractor_documents
       WHERE user_id = v_user AND kind = 'professional_license')
    AND (NOT coalesce(v_registered, false) OR EXISTS (
      SELECT 1 FROM public.contractor_documents
       WHERE user_id = v_user AND kind = 'business_registration'));

  -- The one agreement, at the version currently in force (117).
  v_agreements := EXISTS (
    SELECT 1 FROM public.agreement_acceptances a
     WHERE a.user_id = v_user
       AND a.document = 'partner_agreement'
       AND a.version = public.current_agreement_version('partner_agreement')
  );

  RETURN jsonb_build_object(
    'user_id', v_user,
    'steps', jsonb_build_object(
      'identity',     v_identity,
      'professional', v_professional,
      'payout',       v_payout,
      'emergency',    v_emergency,
      'documents',    v_documents,
      'agreements',   v_agreements
    ),
    'business_status',     r.business_status,
    'needs_business_doc',  coalesce(v_registered, false),
    'emergency_count',     (SELECT count(*) FROM public.contractor_emergency_contacts
                             WHERE user_id = v_user),
    'client_intent',       r.client_intent,
    -- Documents are NOT in this conjunction (118), and nor is the licence (141).
    'complete', v_agreements AND v_identity AND v_professional
            AND v_payout AND v_emergency
  );
END $$;

REVOKE ALL ON FUNCTION public.contractor_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contractor_onboarding_status(uuid) TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   An independent tradesperson with no licence can finish:
--     SELECT public.save_contractor_business(NULL, 'independent');
--       → no exception, and steps.professional is true
--   A registered business still owes its details:
--     SELECT public.save_contractor_business(NULL, 'registered');
--       → business_details_required
