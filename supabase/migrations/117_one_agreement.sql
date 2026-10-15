-- =========================================================
-- 117  One agreement, not two
--
-- WHY
--
-- 116 asked a contractor to sign two documents: the Terms of Service and the
-- Professional Partner Referral and Network Services Agreement. That was a mistake of
-- shape, not of content. The Terms of Service are the CLIENT's contract with Groundwork
-- — what somebody building a house agrees to. A contractor is not that person, and
-- everything a contractor actually needs to have agreed to is already in the partner
-- agreement, in more detail and written for them:
--
--   · platform access and acceptable use        §6   (credentials, security, accurate
--                                                     records, audit logs)
--   · data protection                           §11  + Schedule C
--   · intellectual property and brand           §12
--   · warranties and disclaimers                §16
--   · limitation of liability                   §19
--   · governing law and dispute resolution      §22
--
-- Two documents meant two signatures, two places for the real obligations to live, and a
-- contractor reading whichever one they opened first. One document is what the
-- relationship actually is.
--
-- ── What this changes ────────────────────────────────────────────────────────────────
-- `terms_of_service` stops being a CURRENT agreement, so it can no longer be signed and
-- is no longer required for a complete onboarding. `accept_agreement` already refuses a
-- document with no current version — `unknown_document` — so nothing else is needed to
-- close that door.
--
-- ── What this deliberately does NOT change ───────────────────────────────────────────
-- The CHECK on `agreement_acceptances.document` still allows 'terms_of_service', and no
-- row is deleted. If anybody signed one between 116 going live and this running, that
-- signature stays on file: the table is an append-only record of what somebody agreed
-- to on a date, and rewriting history to tidy a schema is the one thing it must never
-- do. It simply stops counting toward completion.
--
-- The partner agreement's own version is NOT bumped. Its text has not changed, and
-- bumping would re-ask every contractor to sign the identical document.
--
-- Run in: Supabase Dashboard > SQL Editor (after 116)
-- =========================================================

BEGIN;

-- ── The one current document ─────────────────────────────
--
-- Returning NULL for anything else is what makes it unsignable: `accept_agreement`
-- raises `unknown_document` when this gives no version back.
CREATE OR REPLACE FUNCTION public.current_agreement_version(p_document text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_document
           WHEN 'partner_agreement' THEN '2026-10-15'
         END;
$$;

COMMENT ON FUNCTION public.current_agreement_version(text) IS
  'The version of each agreement currently in force (117). Only partner_agreement is '
  'current: the Terms of Service are the client''s contract, and everything a contractor '
  'must agree to lives in the partner agreement. A document with no version here cannot '
  'be signed.';


-- ── Completion needs that one signature ──────────────────
--
-- Unchanged from 116 except for the agreements arm, which was `count(*) = 2` across both
-- documents and is now the partner agreement alone. Written as EXISTS against a named
-- document rather than a count, so adding a second agreement later cannot silently
-- satisfy this one.
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

  v_professional := coalesce(btrim(r.license_number), '') <> ''
                AND r.business_status IS NOT NULL;

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

  -- The one agreement, at the version currently in force. A signature on a superseded
  -- version does not carry forward — that is what makes a version bump re-ask everybody.
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
    'complete', v_identity AND v_professional AND v_payout
            AND v_emergency AND v_documents AND v_agreements
  );
END $$;

REVOKE ALL ON FUNCTION public.contractor_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contractor_onboarding_status(uuid) TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
-- Expect: partner_agreement → 2026-10-15, terms_of_service → NULL.
--
--   SELECT public.current_agreement_version('partner_agreement') AS partner,
--          public.current_agreement_version('terms_of_service')  AS tos;
--
-- And that no signature was destroyed (0 or more, never fewer than before):
--
--   SELECT document, count(*) FROM public.agreement_acceptances GROUP BY document;
