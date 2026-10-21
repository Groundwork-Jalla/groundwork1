-- =========================================================
-- 142 — Onboarding asks what you do, not how you trade
--
-- Philip's walkthrough, 22 Oct. Four changes to the onboarding sequence, all aimed at
-- the same thing: get a working professional onto Groundwork quickly.
--
--   1. Ask the SPECIALTY, from a list, with room to type one in.
--   2. Ask for a professional licence ONLY where the specialty is a regulated
--      profession. A mason is not an architect.
--   3. Drop "how do you trade" (registered business / independent). Not needed here —
--      the partner application still asks whether they operate as an individual or a
--      company, which is where it belongs.
--   4. One emergency contact, not three. More can be added later.
--
-- 141 made the licence optional for everyone as an emergency fix after an applicant was
-- blocked. This supersedes it with the rule Philip actually wants: asked of the five
-- regulated professions, skipped entirely for everybody else. The mason is still fine —
-- he is never asked.
--
-- ── The regulated five ───────────────────────────────────
-- architect, structural engineer, quantity surveyor, land surveyor, land lawyer.
-- The TypeScript twin is `requiresLicence` in lib/contractor/application-types.ts,
-- derived there from `credentialTrack`. If one changes the other must, or the form and
-- the database will disagree about who may finish.
--
-- Run in: Supabase Dashboard > SQL Editor (after 141)
-- =========================================================

BEGIN;

-- ── 1. What they do ──────────────────────────────────────
ALTER TABLE public.contractor_onboarding
  ADD COLUMN IF NOT EXISTS specialty       TEXT,
  ADD COLUMN IF NOT EXISTS specialty_other TEXT;

COMMENT ON COLUMN public.contractor_onboarding.specialty IS
  'One of the thirteen contractor roles (142), or ''other''. Replaces business_status as '
  'the answer this step turns on.';
COMMENT ON COLUMN public.contractor_onboarding.specialty_other IS
  'What they typed when the list did not have it (142). Only meaningful when '
  'specialty = ''other''.';

-- A typed-in specialty must actually say something, or "other" tells us nothing.
ALTER TABLE public.contractor_onboarding
  DROP CONSTRAINT IF EXISTS contractor_specialty_other_shape;
ALTER TABLE public.contractor_onboarding
  ADD  CONSTRAINT contractor_specialty_other_shape
  CHECK (specialty IS DISTINCT FROM 'other'
         OR coalesce(btrim(specialty_other), '') <> '');


-- ── 2. Which specialties are regulated ───────────────────
CREATE OR REPLACE FUNCTION public.specialty_needs_licence(p_specialty text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_specialty IN
    ('architect', 'structural_engineer', 'quantity_surveyor', 'land_surveyor', 'land_lawyer');
$$;

COMMENT ON FUNCTION public.specialty_needs_licence(text) IS
  'The regulated professions (142). The SQL twin of requiresLicence() in '
  'lib/contractor/application-types.ts. A trade — mason, carpenter, electrician, '
  'plumber, roofing, interior finishing — is never asked, and neither is a general '
  'contractor or a specialty somebody typed in themselves.';


-- ── 3. Saving the specialty ──────────────────────────────
CREATE OR REPLACE FUNCTION public.save_contractor_specialty(
  p_specialty       text,
  p_specialty_other text DEFAULT NULL,
  p_license_number  text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid := public.assert_own_onboarding();
  v_other text := NULLIF(btrim(coalesce(p_specialty_other, '')), '');
  v_lic   text := NULLIF(btrim(coalesce(p_license_number, '')), '');
BEGIN
  IF coalesce(btrim(p_specialty), '') = '' THEN
    RAISE EXCEPTION 'specialty_required: choose what you do';
  END IF;
  IF p_specialty = 'other' AND v_other IS NULL THEN
    RAISE EXCEPTION 'specialty_other_required: tell us what you do';
  END IF;
  -- Only where the profession is regulated. Everywhere else an absent licence is the
  -- normal case, not a missing answer.
  IF public.specialty_needs_licence(p_specialty) AND v_lic IS NULL THEN
    RAISE EXCEPTION 'license_required: that profession is licensed, so we need the number';
  END IF;

  -- A licence recorded against a specialty that does not need one is kept, not discarded:
  -- somebody who holds one has told us something true.
  INSERT INTO public.contractor_onboarding
    (user_id, specialty, specialty_other, license_number)
  VALUES (v_user, btrim(p_specialty),
          CASE WHEN p_specialty = 'other' THEN v_other ELSE NULL END, v_lic)
  ON CONFLICT (user_id) DO UPDATE
    SET specialty       = EXCLUDED.specialty,
        specialty_other = EXCLUDED.specialty_other,
        license_number  = EXCLUDED.license_number,
        updated_at      = now();

  RETURN public.contractor_onboarding_status(v_user);
END $$;

REVOKE ALL ON FUNCTION public.save_contractor_specialty(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_contractor_specialty(text, text, text) TO authenticated;


-- ── 4. What "finished" means now ─────────────────────────
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

  -- Kept for the admin dossier, which still shows it for everybody who answered before
  -- 142. Nothing is gated on it any more.
  v_registered := r.business_status = 'registered';

  -- 142: the specialty, plus the licence only where the profession is regulated.
  v_professional := coalesce(btrim(r.specialty), '') <> ''
                AND (NOT public.specialty_needs_licence(r.specialty)
                     OR coalesce(btrim(r.license_number), '') <> '');

  v_payout := EXISTS (
    SELECT 1 FROM public.payout_destinations
     WHERE owner_id = v_user AND status <> 'retired'
  );

  -- One, not three (142). Speed onto the platform is what this step is for; more can be
  -- added later from their profile.
  v_emergency := (
    SELECT count(*) FROM public.contractor_emergency_contacts WHERE user_id = v_user
  ) >= 1;

  v_documents := EXISTS (
      SELECT 1 FROM public.contractor_documents
       WHERE user_id = v_user AND kind = 'professional_license')
    AND (NOT coalesce(v_registered, false) OR EXISTS (
      SELECT 1 FROM public.contractor_documents
       WHERE user_id = v_user AND kind = 'business_registration'));

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
    'specialty',           r.specialty,
    'specialty_other',     r.specialty_other,
    'needs_licence',       public.specialty_needs_licence(r.specialty),
    'business_status',     r.business_status,
    'needs_business_doc',  coalesce(v_registered, false),
    'emergency_count',     (SELECT count(*) FROM public.contractor_emergency_contacts
                             WHERE user_id = v_user),
    'client_intent',       r.client_intent,
    -- Documents are not in this conjunction (118), and nor is how they trade (142).
    'complete', v_agreements AND v_identity AND v_professional
            AND v_payout AND v_emergency
  );
END $$;

REVOKE ALL ON FUNCTION public.contractor_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contractor_onboarding_status(uuid) TO authenticated;


-- ── 5. One contact is enough to save ─────────────────────
-- 116's saver demanded exactly three in one call. Relaxed to one or more, so the first
-- can be saved on its own and the rest added whenever.
CREATE OR REPLACE FUNCTION public.save_emergency_contacts(p_contacts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.assert_own_onboarding();
  v_n    int  := coalesce(jsonb_array_length(p_contacts), 0);
  v_row  jsonb;
  v_i    int  := 0;
BEGIN
  IF v_n < 1 THEN
    RAISE EXCEPTION 'contacts_required: give us at least one person we can reach';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    v_i := v_i + 1;
    IF coalesce(btrim(v_row->>'fullName'), '') = ''
       OR coalesce(btrim(v_row->>'relationship'), '') = ''
       OR coalesce(btrim(v_row->>'phone'), '') = '' THEN
      RAISE EXCEPTION 'contact_incomplete: contact % needs a name, a relationship and a phone number', v_i;
    END IF;
  END LOOP;

  DELETE FROM public.contractor_emergency_contacts WHERE user_id = v_user;
  INSERT INTO public.contractor_emergency_contacts (user_id, position, full_name, relationship, phone)
  SELECT v_user, ord, btrim(c->>'fullName'), btrim(c->>'relationship'), btrim(c->>'phone')
    FROM jsonb_array_elements(p_contacts) WITH ORDINALITY AS t(c, ord);

  RETURN public.contractor_onboarding_status(v_user);
END $$;

REVOKE ALL ON FUNCTION public.save_emergency_contacts(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_emergency_contacts(jsonb) TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   A mason is never asked for a licence:
--     SELECT public.save_contractor_specialty('mason');          → no exception
--   An architect is:
--     SELECT public.save_contractor_specialty('architect');      → license_required
--     SELECT public.save_contractor_specialty('architect', NULL, 'CM-ARC-1');  → ok
--   "Other" must say what it is:
--     SELECT public.save_contractor_specialty('other');           → specialty_other_required
--   One emergency contact completes the step:
--     SELECT public.save_emergency_contacts('[{"fullName":"A","relationship":"Sister","phone":"+237..."}]');
