-- Give `client_intent` back to the onboarding status.
--
-- 118 added the column and the question it answers; 142's copy of this function
-- returned it. 160 rewrote the function for the Contractor Terms of Service and the
-- key was simply lost — the column kept being written, nothing read it back.
--
-- The cost was a loop nobody could get out of. `/work` lets a contractor through on
-- `signed && decided && complete`, and `decided` is
--
--     !status.complete || status.clientIntent !== null
--
-- With the key absent the client reads `clientIntent` as null, so any contractor whose
-- onboarding IS complete fails `decided` — forever. They were sent back to
-- "Step 6 of 6 · You're almost there" every time, including straight after creating a
-- project, and the final card kept offering "Create a project / I don't have a project"
-- because that panel is marked done by the very same field.
--
-- Verified 29 October by creating a real project end to end: the project, the
-- contractor's membership and the chosen stage were all written correctly, and the
-- redirect still bounced — because this one key was missing from the payload.
--
-- Nothing else changes. The function is 160 verbatim plus the restored line.

BEGIN;

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
    -- Restored. 118 added it, 142 still returned it, 160 lost it in a rewrite.
    'client_intent',       r.client_intent,
    'complete', v_agreements AND v_identity AND v_professional
            AND v_payout AND v_emergency
  );
END $$;

REVOKE ALL ON FUNCTION public.contractor_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contractor_onboarding_status(uuid) TO authenticated;

COMMIT;
