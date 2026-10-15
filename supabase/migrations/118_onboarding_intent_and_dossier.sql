-- =========================================================
-- 118  No uploads, a client question at the end, and a dossier admin can actually read
--
-- Three changes, all from using the thing:
--
-- 1. DOCUMENTS ARE NO LONGER ASKED FOR. Uploading a licence scan was a step most people
--    cannot finish on a phone on a site, and it gated everything behind it. The table
--    and its RPC stay — a document already uploaded is kept, and asking again later is
--    one line here — but it no longer counts toward completion.
--
-- 2. THE LAST STEP IS NOW THE EMERGENCY CONTACTS, and finishing them asks one question:
--    do you have a client to bring on? A contractor on Groundwork is either a partner
--    with their own client or somebody waiting to be assigned, and until now the
--    product guessed. Now it asks, once, and records the answer — which also tells
--    Philip which contractors are partners without anybody having to ask them.
--
-- 3. ADMIN CAN SEE WHAT THEY FILLED IN. `admin_contractor_onboarding` (116) returned
--    only a progress summary — six booleans. Nobody could read the emergency contacts
--    or the account the money is going to, which is most of the reason the form exists.
--    `admin_contractor_dossier` returns the whole record.
--
-- Run in: Supabase Dashboard > SQL Editor (after 117)
-- =========================================================

BEGIN;

-- ── 1. The answer to "do you have a client?" ─────────────
--
-- Nullable: null means not asked yet, which is what makes the question appear exactly
-- once. Stored rather than kept in the browser because it must survive a new device —
-- being asked again every sign-in would read as the product forgetting them.
ALTER TABLE public.contractor_onboarding
  ADD COLUMN IF NOT EXISTS client_intent text
    CHECK (client_intent IN ('onboard_client', 'no_client')),
  ADD COLUMN IF NOT EXISTS client_intent_at timestamptz;

-- A claim about an answer carries when it was given, or it is not that claim.
ALTER TABLE public.contractor_onboarding
  DROP CONSTRAINT IF EXISTS contractor_onboarding_intent_dated;
ALTER TABLE public.contractor_onboarding
  ADD CONSTRAINT contractor_onboarding_intent_dated
    CHECK ((client_intent IS NULL) = (client_intent_at IS NULL));

COMMENT ON COLUMN public.contractor_onboarding.client_intent IS
  'What they answered at the end of onboarding (118): onboard_client sends them into '
  'the client wizard, no_client releases them to the dashboard. NULL means not asked '
  'yet, which is what makes the question appear exactly once.';


CREATE OR REPLACE FUNCTION public.set_contractor_client_intent(p_intent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := public.assert_own_onboarding();
BEGIN
  IF p_intent NOT IN ('onboard_client', 'no_client') THEN
    RAISE EXCEPTION 'bad_intent: answer is onboard_client or no_client';
  END IF;

  INSERT INTO public.contractor_onboarding (user_id, client_intent, client_intent_at)
  VALUES (v_user, p_intent, now())
  ON CONFLICT (user_id) DO UPDATE
    SET client_intent    = EXCLUDED.client_intent,
        client_intent_at = now(),
        updated_at       = now();

  RETURN public.contractor_onboarding_status(v_user);
END $$;

REVOKE ALL ON FUNCTION public.set_contractor_client_intent(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contractor_client_intent(text) TO authenticated;


-- ── 2. Completion, without the documents step ────────────
--
-- `documents` is still reported, so the admin view and any older client can still read
-- it, but it no longer feeds `complete`. Reporting it as false while not requiring it
-- would be a checklist nobody can finish; reporting it at all is what lets us put the
-- step back without another migration to the callers.
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

  -- Reported, not required.
  v_documents := EXISTS (
    SELECT 1 FROM public.contractor_documents
     WHERE user_id = v_user AND kind = 'professional_license');

  v_agreements := EXISTS (
    SELECT 1 FROM public.agreement_acceptances a
     WHERE a.user_id = v_user
       AND a.document = 'partner_agreement'
       AND a.version = public.current_agreement_version('partner_agreement')
  );

  RETURN jsonb_build_object(
    'user_id', v_user,
    'steps', jsonb_build_object(
      'agreements',   v_agreements,
      'identity',     v_identity,
      'professional', v_professional,
      'payout',       v_payout,
      'emergency',    v_emergency,
      'documents',    v_documents
    ),
    'business_status',    r.business_status,
    'needs_business_doc', coalesce(v_registered, false),
    'emergency_count',    (SELECT count(*) FROM public.contractor_emergency_contacts
                            WHERE user_id = v_user),
    'client_intent',      r.client_intent,
    -- Documents are NOT in this conjunction. That is the whole of change 1.
    'complete', v_agreements AND v_identity AND v_professional
            AND v_payout AND v_emergency
  );
END $$;

REVOKE ALL ON FUNCTION public.contractor_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contractor_onboarding_status(uuid) TO authenticated;


-- ── 3. The whole record, for admin ───────────────────────
--
-- Everything a contractor filled in, in one call: who they are, their licence and
-- business, every emergency contact, every payout destination, what they signed and
-- when, and any document they did upload before 118 stopped asking.
--
-- ── Account numbers are NOT masked here ─────────────────────────────────────────────
-- Deliberate, and the reason this is admin-only. The product masks destinations
-- everywhere else (`maskDestination`), which is right for a contractor glancing at
-- their own list. But staff releasing a payment have to be able to check the number
-- against what the contractor told them, and a masked number cannot be checked. This
-- function is the one place the full value is readable, it refuses everyone who is not
-- an administrator, and `is_admin()` is evaluated before any row is produced.
CREATE OR REPLACE FUNCTION public.admin_contractor_dossier(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator reads a contractor dossier';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'no_user: nobody named';
  END IF;

  SELECT jsonb_build_object(
    'user_id', p_user,
    'profile', (
      SELECT jsonb_build_object('email', p.email, 'full_name', p.full_name, 'phone', p.phone)
        FROM public.profiles p WHERE p.id = p_user),
    'onboarding', (
      SELECT to_jsonb(o) FROM public.contractor_onboarding o WHERE o.user_id = p_user),
    'emergency_contacts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'position', c.position, 'full_name', c.full_name,
               'relationship', c.relationship, 'phone', c.phone)
             ORDER BY c.position)
        FROM public.contractor_emergency_contacts c WHERE c.user_id = p_user), '[]'::jsonb),
    'payout_destinations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'country_code', d.country_code, 'method', d.method,
               'mobile_no', d.mobile_no, 'bank_code', d.bank_code,
               'account_number', d.account_number, 'account_name', d.account_name,
               'status', d.status, 'is_default', d.is_default,
               'created_at', d.created_at)
             ORDER BY d.is_default DESC, d.created_at)
        FROM public.payout_destinations d
       WHERE d.owner_id = p_user AND d.status <> 'retired'), '[]'::jsonb),
    'agreements', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'document', a.document, 'version', a.version,
               'signed_name', a.signed_name, 'accepted_at', a.accepted_at)
             ORDER BY a.accepted_at)
        FROM public.agreement_acceptances a WHERE a.user_id = p_user), '[]'::jsonb),
    'documents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', x.kind, 'filename', x.filename, 'path', x.path,
               'uploaded_at', x.uploaded_at))
        FROM public.contractor_documents x WHERE x.user_id = p_user), '[]'::jsonb),
    'status', public.contractor_onboarding_status(p_user)
  ) INTO v_out;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.admin_contractor_dossier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_contractor_dossier(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_contractor_dossier(uuid) IS
  'Everything a contractor filled in, for staff (118). Account numbers are unmasked '
  'here and nowhere else, because somebody releasing a payment has to be able to check '
  'them. Refuses every caller who is not an administrator.';


-- ── The list, now carrying enough to be useful ───────────
--
-- 116's version returned only the status jsonb, so the admin list could say "4 of 6"
-- and nothing else. Adding the answer to the client question and the signature date
-- means the table is readable without opening every row.
-- Dropped first: this gains columns, and Postgres refuses to CREATE OR REPLACE a
-- function whose return type changed ("cannot change return type of existing
-- function"). Without this line the whole migration aborts at this statement.
DROP FUNCTION IF EXISTS public.admin_contractor_onboarding();

CREATE OR REPLACE FUNCTION public.admin_contractor_onboarding()
RETURNS TABLE (
  user_id       uuid,
  email         text,
  full_name     text,
  phone         text,
  client_intent text,
  signed_at     timestamptz,
  status        jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.email, p.full_name, p.phone,
         o.client_intent,
         (SELECT max(a.accepted_at) FROM public.agreement_acceptances a
           WHERE a.user_id = p.id AND a.document = 'partner_agreement'),
         public.contractor_onboarding_status(p.id)
    FROM public.profiles p
    LEFT JOIN public.contractor_onboarding o ON o.user_id = p.id
   WHERE public.is_admin()
     AND public.holds_contractor_access(p.id)
   ORDER BY p.full_name NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.admin_contractor_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_contractor_onboarding() TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT public.contractor_onboarding_status('<a contractor uuid>');
--     → `steps.documents` still reported, `complete` no longer depends on it.
--   SELECT public.admin_contractor_dossier('<a contractor uuid>');
--     → one jsonb with profile, onboarding, contacts, destinations and signatures.
