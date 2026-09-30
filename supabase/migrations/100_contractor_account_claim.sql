-- =========================================================
-- 100  A contractor's account, and the approval that earns it
--
-- WHY
--
-- One contractor has had three identities that were never joined:
--
--   contractor_applications   the form they filled      — no user_id
--   contractors               the directory listing     — no user_id
--   contractor_invites        a per-project assignment  — the ONLY one with an account
--
-- So an approved contractor was a listing, not a user: nothing to sign in as, nothing to
-- assign work to. This makes the ACCOUNT the spine and hangs the other two off it.
--
-- ── Why not self-registration ────────────────────────────────────────────────────────
-- An earlier draft of this file granted the contractor role from
-- `raw_user_meta_data->>'account_type'`. That field is set by the browser in signUp(),
-- so it let anyone grant themselves the role. Harmless while the role opened nothing —
-- project access is `contractor_invites.status = 'accepted'`, checked by
-- `is_contractor_on()` (086), not the role — but contractors are about to be able to
-- bring their own clients, and a self-granted role must never reach that.
--
-- So: the role is earned by an application an ADMIN accepted, and claimed with a token
-- we emailed. That trigger is dropped below rather than left to rot.
--
-- ── The token is the capability ──────────────────────────────────────────────────────
-- Same model as `contractor_invites` (20260714000000): we mail the token to the address
-- on the application, and holding it is what proves you are that applicant. There is no
-- second email check at claim time — an applicant who signs up with a different address
-- than they applied with is still the person who opened the mail.
--
-- Run in: Supabase Dashboard > SQL Editor (after 099)
-- =========================================================

BEGIN;

-- ── 0. Undo the draft ────────────────────────────────────
-- This file previously shipped a self-grant trigger. It may have been applied locally;
-- dropping it unconditionally is the only way to be sure it is gone.
DROP TRIGGER  IF EXISTS on_auth_contractor_signup ON auth.users;
DROP FUNCTION IF EXISTS public.register_contractor_signup();

-- ── 1. The application learns whose it is ────────────────
ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_token     uuid,
  ADD COLUMN IF NOT EXISTS claim_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at      timestamptz;

-- Claimed and linked are the same fact. Either both or neither.
ALTER TABLE public.contractor_applications
  DROP CONSTRAINT IF EXISTS contractor_application_claim_shape;
ALTER TABLE public.contractor_applications
  ADD  CONSTRAINT contractor_application_claim_shape
  CHECK ((claimed_at IS NULL) = (user_id IS NULL));

-- A token is a secret; two applications must never share one.
CREATE UNIQUE INDEX IF NOT EXISTS contractor_applications_claim_token
  ON public.contractor_applications (claim_token) WHERE claim_token IS NOT NULL;

-- One account, one application. Without this a single person could claim several and
-- collect several directory listings.
CREATE UNIQUE INDEX IF NOT EXISTS contractor_applications_one_per_account
  ON public.contractor_applications (user_id) WHERE user_id IS NOT NULL;

-- ── 2. The directory learns whose it is ──────────────────
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contractors_one_per_account
  ON public.contractors (user_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.contractors.user_id IS
  'The account behind this listing, set when the applicant claims it (100). NULL means '
  'a listing nobody has claimed yet — visible in the directory, but not yet a user.';

-- ── 3. Issue a claim ─────────────────────────────────────
--
-- Admin-only, and only for an application that was actually accepted. Idempotent: an
-- unclaimed application returns the token it already has, so re-sending the email never
-- invalidates the link already in the applicant's inbox.
CREATE OR REPLACE FUNCTION public.issue_contractor_claim(p_application uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.contractor_applications%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator invites a contractor to claim an account';
  END IF;

  SELECT * INTO a FROM public.contractor_applications WHERE id = p_application FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such application'; END IF;

  -- The approval IS the entitlement. Nothing else issues a token.
  IF a.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_accepted: only an accepted application can be claimed';
  END IF;
  IF a.claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_claimed: this application already has an account';
  END IF;

  IF a.claim_token IS NULL THEN
    UPDATE public.contractor_applications
       SET claim_token = gen_random_uuid(), claim_issued_at = now()
     WHERE id = p_application
     RETURNING claim_token INTO a.claim_token;
  ELSE
    UPDATE public.contractor_applications SET claim_issued_at = now() WHERE id = p_application;
  END IF;

  -- Deliberately NOT written to the activity log. `log_activity` requires a project or a
  -- person as its subject (089), and at this moment the applicant has no account — that
  -- is the whole reason a claim exists. `claim_issued_at` above records that it happened,
  -- the admin's acceptance is already audited by 093, and the claim itself is logged
  -- below, where there is finally a person to name.
  RETURN a.claim_token;
END $$;

-- ── 4. What the claim page may show before sign-in ───────
--
-- Granted to anon, because the visitor has not signed up yet and a page that cannot say
-- who it is for reads as a phishing link. It returns the applicant's own name and email
-- and nothing else — no other applicant is reachable without their token.
CREATE OR REPLACE FUNCTION public.contractor_claim_preview(p_token uuid)
RETURNS TABLE (full_name text, email text, business_name text, claimed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.full_name, a.email, a.business_name, a.claimed_at IS NOT NULL
    FROM public.contractor_applications a
   WHERE a.claim_token = p_token AND a.status = 'accepted';
$$;

-- ── 5. Claim it ──────────────────────────────────────────
--
-- Links the application and the directory listing to the signed-in account and grants
-- the role. This is the ONLY way the contractor role is granted other than accepting a
-- project invite, which carries its own admin-issued token.
CREATE OR REPLACE FUNCTION public.claim_contractor_account(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  a       public.contractor_applications%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: create an account first, then claim';
  END IF;

  SELECT * INTO a FROM public.contractor_applications
   WHERE claim_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token: no application matches that link'; END IF;
  IF a.status <> 'accepted' THEN RAISE EXCEPTION 'not_accepted: this application is not approved'; END IF;

  -- Claiming twice from the same account is a refresh, not an error.
  IF a.claimed_at IS NOT NULL THEN
    IF a.user_id = v_actor THEN RETURN a.id; END IF;
    RAISE EXCEPTION 'already_claimed: another account has claimed this application';
  END IF;

  UPDATE public.contractor_applications
     SET user_id = v_actor, claimed_at = now()
   WHERE id = a.id;

  -- The listing published at approval now points at a real user.
  UPDATE public.contractors SET user_id = v_actor WHERE application_id = a.id;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_actor, 'contractor')
  ON CONFLICT (user_id, role) DO NOTHING;

  PERFORM public.log_activity(NULL, 'contractor.account_claimed', 'contractor_application', a.id, v_actor,
    jsonb_build_object('had_listing', EXISTS (SELECT 1 FROM public.contractors WHERE application_id = a.id)));
  RETURN a.id;
END $$;

-- ── 6. An applicant may read their own application ───────
DROP POLICY IF EXISTS "applicant_read_own_application" ON public.contractor_applications;
CREATE POLICY "applicant_read_own_application"
  ON public.contractor_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 7. Grants ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.issue_contractor_claim(uuid)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contractor_claim_preview(uuid)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_contractor_account(uuid)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_contractor_claim(uuid)   TO authenticated;  -- is_admin() inside
GRANT EXECUTE ON FUNCTION public.contractor_claim_preview(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_contractor_account(uuid) TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
SELECT 'self-grant trigger gone (expect 0)' AS what,
       count(*)::text AS n FROM pg_trigger WHERE tgname = 'on_auth_contractor_signup'
UNION ALL SELECT 'application columns (expect 4)', count(*)::text FROM information_schema.columns
  WHERE table_name = 'contractor_applications' AND column_name IN ('user_id','claim_token','claim_issued_at','claimed_at')
UNION ALL SELECT 'contractors.user_id (expect 1)', count(*)::text FROM information_schema.columns
  WHERE table_name = 'contractors' AND column_name = 'user_id'
UNION ALL SELECT 'claimed applications (expect 0 on a fresh install)', count(*)::text
  FROM public.contractor_applications WHERE claimed_at IS NOT NULL;
