-- =========================================================
-- 102  A phone number for everyone we need to reach
--
-- WHY
--
-- WhatsApp addresses a person by an E.164 number, and `project-whatsapp` refuses with
-- `no_phone` when `profiles.phone` is NULL. Three groups arrive with no number at all:
--
--   clients      — signup never asked, and onboarding never asked
--   contractors  — they DID give one: `contractor_applications.phone` is NOT NULL (026).
--                  `claim_contractor_account` (100) never copied it, so an approved
--                  contractor who filled in a nine-section application still has a NULL
--                  phone and cannot be messaged. The data was collected and discarded.
--   verifiers    — there is no verifier signup at all; a verifier is an existing account
--                  granted the role from /admin/team, so the number has to come from
--                  wherever that account was created.
--
-- ── ONE NORMALISER, AND IT IS NOT THIS FILE ──────────────────────────────────────────
-- `src/lib/phone.ts` is canonical. It knows 24 dial codes, which countries use a trunk
-- prefix, and — deliberately — that Cameroon does NOT, because stripping a leading zero
-- from a CM mobile breaks a valid number. Reimplementing that in plpgsql would be a second
-- rule that drifts from the first, and the failure mode is a number that looks stored and
-- reaches a stranger.
--
-- So the trigger below NORMALISES NOTHING. It accepts a value only when it is already
-- E.164 and stores NULL otherwise. The browser normalises before it ever gets here.
-- `normalised_phone()` exists for the backfill and handles only the two cases that need no
-- country knowledge; anything else is left for the person to give us again.
--
-- ── A number is either messageable or absent ──────────────────────────────────────────
-- No half-stored values. A field that looks filled in and cannot be messaged is worse than
-- an empty one: it reads as "we can reach them" on every screen that shows it.
--
-- Run in: Supabase Dashboard > SQL Editor (after 101)
-- =========================================================

-- ── 1. The shape test, shared by everything below ────────
CREATE OR REPLACE FUNCTION public.is_e164(p_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  -- Mirrors isE164() in src/lib/phone.ts: 7–15 digits after the +, per the ITU.
  SELECT p_value IS NOT NULL AND p_value ~ '^\+[0-9]{7,15}$';
$$;

COMMENT ON FUNCTION public.is_e164(text) IS
  'Can a provider message this number? Mirrors isE164() in src/lib/phone.ts, which is the '
  'canonical implementation. See 102.';

/**
 * The two normalisations that need no country knowledge.
 *
 * `+237670000000` is kept. `00237670000000` becomes `+237670000000`. Everything else —
 * a bare local number, which needs to know the country AND whether that country uses a
 * trunk prefix — returns NULL, because guessing is how a valid number becomes a wrong one.
 *
 * Used by the backfill only. New writes come from the browser already normalised.
 */
CREATE OR REPLACE FUNCTION public.normalised_phone(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text := btrim(COALESCE(p_raw, ''));
  d text;
BEGIN
  IF v = '' THEN RETURN NULL; END IF;

  IF left(v, 1) = '+' THEN
    d := regexp_replace(substr(v, 2), '[^0-9]', '', 'g');
    RETURN CASE WHEN length(d) BETWEEN 7 AND 15 THEN '+' || d ELSE NULL END;
  END IF;

  d := regexp_replace(v, '[^0-9]', '', 'g');
  IF left(d, 2) = '00' THEN
    d := substr(d, 3);
    RETURN CASE WHEN length(d) BETWEEN 7 AND 15 THEN '+' || d ELSE NULL END;
  END IF;

  -- A bare local number. Which country's dial code belongs on the front is not a question
  -- this function may answer; src/lib/phone.ts does, with the country in hand.
  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.normalised_phone(text) IS
  'The country-independent half of normalisePhone() (src/lib/phone.ts): keeps E.164, '
  'converts a 00 prefix, and returns NULL for a bare local number rather than guessing '
  'its country. Backfill use only. See 102.';

-- ── 2. Signup carries the number through ─────────────────
--
-- Rewritten from 047, adding `phone` and nothing else. Everything 047 did — the name
-- fallback chain for Google/OIDC, the avatar claim, the email mirror and its guard flag —
-- is kept verbatim, because this trigger must never be the reason a signup fails.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta       JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name     TEXT;
  v_avatar   TEXT;
  v_phone    TEXT;
  v_given    TEXT := NULLIF(TRIM(meta->>'given_name'), '');
  v_family   TEXT := NULLIF(TRIM(meta->>'family_name'), '');
BEGIN
  v_name := COALESCE(
    NULLIF(TRIM(meta->>'full_name'), ''),   -- our signup form
    NULLIF(TRIM(meta->>'name'), ''),        -- Google / most OIDC providers
    NULLIF(TRIM(CONCAT_WS(' ', v_given, v_family)), ''),
    NULLIF(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), '')
  );

  v_avatar := COALESCE(
    NULLIF(TRIM(meta->>'avatar_url'), ''),
    NULLIF(TRIM(meta->>'picture'), '')      -- Google's claim name
  );

  -- NEW IN 102. The signup form normalises with src/lib/phone.ts and sends E.164. Anything
  -- else — a number typed straight into the metadata by some other client, a local format
  -- that never went through the form — is dropped rather than stored unmessageable.
  v_phone := NULLIF(TRIM(meta->>'phone'), '');
  IF NOT public.is_e164(v_phone) THEN v_phone := NULL; END IF;

  -- Tells guard_profile_email() this write is ours.
  PERFORM set_config('app.email_sync', 'on', true);

  INSERT INTO public.profiles (id, full_name, avatar_url, email, phone)
  VALUES (NEW.id, v_name, v_avatar, NEW.email, v_phone)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,             -- never block sign-up; just fix the mirror
        -- A number already on the profile is the person's own and wins. This only fills a
        -- blank, so a re-run cannot overwrite what somebody later corrected by hand.
        phone = COALESCE(public.profiles.phone, EXCLUDED.phone);

  RETURN NEW;
END $$;

-- ── 3. The claim carries the application's number over ───
--
-- Rewritten from 100 with one addition at the end. The applicant gave us this number on
-- their application; asking for it again because we dropped it on the floor is the kind of
-- thing that makes a platform feel unfinished.
CREATE OR REPLACE FUNCTION public.claim_contractor_account(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  a       public.contractor_applications%ROWTYPE;
  v_phone text;
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

  -- NEW IN 102. Only the cases that need no country knowledge; the claim page finishes the
  -- job in the browser, where the real normaliser and the application's country both are.
  -- COALESCE, so a number the contractor has already corrected is never overwritten.
  v_phone := public.normalised_phone(a.phone);
  IF v_phone IS NOT NULL THEN
    UPDATE public.profiles SET phone = COALESCE(phone, v_phone) WHERE id = v_actor;
  END IF;

  PERFORM public.log_activity(NULL, 'contractor.account_claimed', 'contractor_application', a.id, v_actor,
    jsonb_build_object('had_listing', EXISTS (SELECT 1 FROM public.contractors WHERE application_id = a.id)));
  RETURN a.id;
END $$;

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

REVOKE ALL ON FUNCTION public.is_e164(text)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalised_phone(text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_e164(text)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.normalised_phone(text) TO authenticated;

-- ── Verify ───────────────────────────────────────────────
SELECT 'profiles with a messageable phone' AS what, count(*)::text AS n
  FROM public.profiles WHERE public.is_e164(phone)
UNION ALL
SELECT 'profiles with a phone that is NOT messageable (expect 0)', count(*)::text
  FROM public.profiles WHERE phone IS NOT NULL AND NOT public.is_e164(phone)
UNION ALL
SELECT 'claimed contractors still with no phone', count(*)::text
  FROM public.contractor_applications a
  JOIN public.profiles p ON p.id = a.user_id
 WHERE a.claimed_at IS NOT NULL AND p.phone IS NULL;

-- ── Rollback (not run; here so the reviewer can see it is complete) ───────────
-- Restore handle_new_user() from 047 and claim_contractor_account() from 100 verbatim.
-- DROP FUNCTION IF EXISTS public.is_e164(text), public.normalised_phone(text);
-- Backfilled phone numbers are the people's own and are NOT removed by a rollback.
