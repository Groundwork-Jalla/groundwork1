-- =========================================================
-- 160  The Contractor Platform Terms of Service
--
-- WHY
--
-- 117 made `terms_of_service` unsignable, and its reasoning was right for the document
-- that then bore the name: those Terms were the CLIENT's contract, and a contractor is
-- not that person. So everything a contractor had to agree to was folded into the
-- Partner Agreement, and the Partner Agreement became the one thing they signed.
--
-- That had a consequence nobody set out to create. A contractor who is not a partner,
-- wants no referrals and expects no commission still had to sign the partner terms to
-- finish onboarding. 62 people now hold a signature on a document that promises $50 per
-- project per month. The promise was withdrawn commercially; the signatures remain.
--
-- Philip supplied the missing document on 27 October: a Terms of Service written FOR
-- contractors, for standard platform access. §5 says in terms that holding a Contractor
-- Account is not Partner status and carries no right to referrals, projects or
-- compensation. §27 says it does not replace a separate Partner Agreement. It is exactly
-- the document 117 could not point at because it did not exist.
--
-- ── What this changes ────────────────────────────────────────────────────────────────
-- `terms_of_service` becomes current at 2026-10-23 and is what onboarding requires.
-- `partner_agreement` STAYS current at 2026-10-16 so it remains signable — it is now the
-- partner's extra document rather than everybody's only one.
--
-- ── Everybody signs again, and that is the point ─────────────────────────────────────
-- Completion compares against the current version, so every contractor is asked for the
-- new document the next time they open onboarding. On the day this runs that is 38
-- contractors, 19 of whom have a complete profile today and will not have one until they
-- sign. That was decided deliberately rather than grandfathered: §23 reserves renewed
-- affirmative acceptance for a change that materially affects duties, fees, dispute
-- rights or liability, and withdrawing a compensation promise is all four. Accepting the
-- old signature would leave 62 people bound only by the document we are trying to stop
-- relying on.
--
-- No row is deleted. `agreement_acceptances` is append-only: a partner-agreement
-- signature stays on file as a true record of what somebody agreed to on a date. It
-- simply stops satisfying onboarding.
--
-- ── §29's audit record ───────────────────────────────────────────────────────────────
-- The document requires the Platform to record "the accepted document versions, user and
-- organization identifiers, date and time, IP address, and acceptance event". Four of
-- those already exist. IP address and the device/browser string do not, so they are
-- added here and captured SERVER-side from the request headers — a value the browser
-- hands us about itself is not evidence of anything.
--
-- Run in: Supabase Dashboard > SQL Editor (after 159)
-- =========================================================

BEGIN;

-- ── 1. §29: what a signature has to carry ────────────────
--
-- Nullable on purpose. The columns are new and every existing row predates them; a NOT
-- NULL with a backfilled placeholder would be inventing evidence about signatures that
-- were already given.
ALTER TABLE public.agreement_acceptances
  ADD COLUMN IF NOT EXISTS ip_address  inet,
  ADD COLUMN IF NOT EXISTS user_agent  text;

COMMENT ON COLUMN public.agreement_acceptances.ip_address IS
  'Signer''s IP at acceptance, read from the request headers by accept_agreement (160, '
  '§29). Null on rows written before 160 — absent, not unknown.';
COMMENT ON COLUMN public.agreement_acceptances.user_agent IS
  'Signer''s device/browser string at acceptance (160, §24 and §29). Null on rows '
  'written before 160.';


-- ── 2. Both documents are current ────────────────────────
--
-- The Terms of Service are what every contractor signs. The Partner Agreement stays
-- signable because partner status is a separate application under §5 — it is no longer
-- the price of using the platform.
CREATE OR REPLACE FUNCTION public.current_agreement_version(p_document text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_document
           WHEN 'terms_of_service'  THEN '2026-10-23'
           WHEN 'partner_agreement' THEN '2026-10-16'
         END;
$$;

COMMENT ON FUNCTION public.current_agreement_version(text) IS
  'The version of each agreement currently in force (160). terms_of_service is the '
  'Contractor Platform Terms of Service and is what onboarding requires; '
  'partner_agreement is the separate document a partner accepts under §5. A document '
  'with no version here cannot be signed.';


-- ── 3. Onboarding asks for the Terms of Service ──────────
--
-- Reproduced from 142 with ONE line changed: the agreements arm. Everything else is that
-- file's body verbatim, for the reason 109 gives about copied functions — a copy that
-- quietly falls behind its original is worse than no copy.
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

  v_professional := coalesce(btrim(r.specialty), '') <> ''
                AND (NOT public.specialty_needs_licence(r.specialty)
                     OR coalesce(btrim(r.license_number), '') <> '');

  v_payout := EXISTS (
    SELECT 1 FROM public.payout_destinations
     WHERE owner_id = v_user AND status <> 'retired'
  );

  v_emergency := (
    SELECT count(*) FROM public.contractor_emergency_contacts WHERE user_id = v_user
  ) >= 1;

  v_documents := EXISTS (
      SELECT 1 FROM public.contractor_documents
       WHERE user_id = v_user AND kind = 'professional_license')
    AND (NOT coalesce(v_registered, false) OR EXISTS (
      SELECT 1 FROM public.contractor_documents
       WHERE user_id = v_user AND kind = 'business_registration'));

  -- 160: the Contractor Platform Terms of Service, not the Partner Agreement.
  v_agreements := EXISTS (
    SELECT 1 FROM public.agreement_acceptances a
     WHERE a.user_id = v_user
       AND a.document = 'terms_of_service'
       AND a.version = public.current_agreement_version('terms_of_service')
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
    'business_registered', coalesce(v_registered, false),
    'emergency_count',     (SELECT count(*) FROM public.contractor_emergency_contacts
                             WHERE user_id = v_user),
    'complete', v_agreements AND v_identity AND v_professional
            AND v_payout AND v_emergency
  );
END $$;

REVOKE ALL ON FUNCTION public.contractor_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contractor_onboarding_status(uuid) TO authenticated;


-- ── 4. A signature records where it came from ────────────
--
-- Reproduced from 116 with the §29 fields added. The IP and the device string are read
-- from `request.headers`, which PostgREST sets from the actual request: a browser cannot
-- put its own value there, which is the only reason either is worth recording.
--
-- `x-forwarded-for` may carry a chain; the FIRST entry is the client. A malformed value
-- must not cost somebody their signature, so the cast is guarded and a bad one stores
-- null rather than raising.
CREATE OR REPLACE FUNCTION public.accept_agreement(
  p_document    text,
  p_signed_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user    uuid := public.assert_own_onboarding();
  v_version text := public.current_agreement_version(p_document);
  v_name    text := NULLIF(btrim(coalesce(p_signed_name, '')), '');
  v_headers jsonb;
  v_ip      inet;
  v_agent   text;
  v_new     boolean;
BEGIN
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'unknown_document: there is no agreement called %', p_document;
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'signature_required: type your full name to sign';
  END IF;

  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    v_agent := left(v_headers ->> 'user-agent', 500);
    BEGIN
      v_ip := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1))::inet;
    EXCEPTION WHEN others THEN
      v_ip := NULL;
    END;
  END IF;

  INSERT INTO public.agreement_acceptances
         (user_id, document, version, signed_name, ip_address, user_agent)
  VALUES (v_user, p_document, v_version, v_name, v_ip, v_agent)
  ON CONFLICT (user_id, document, version) DO NOTHING;
  v_new := FOUND;

  IF v_new THEN
    PERFORM public.log_activity(NULL, 'contractor.agreement_accepted', NULL, NULL, v_user,
      jsonb_build_object('document', p_document, 'version', v_version));
  END IF;

  RETURN public.contractor_onboarding_status(v_user);
END $$;

REVOKE ALL ON FUNCTION public.accept_agreement(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_agreement(text, text) TO authenticated;

COMMIT;

-- ── Afterwards ───────────────────────────────────────────
--
--   SELECT public.current_agreement_version('terms_of_service')  AS tos,
--          public.current_agreement_version('partner_agreement') AS partner;
--   -- expect 2026-10-23 and 2026-10-16
--
--   SELECT count(*) FILTER (WHERE document = 'terms_of_service'
--                             AND version  = '2026-10-23') AS on_new_tos,
--          count(*) FILTER (WHERE document = 'partner_agreement') AS on_partner
--     FROM public.agreement_acceptances;
--   -- expect 0 and 63 immediately after running
