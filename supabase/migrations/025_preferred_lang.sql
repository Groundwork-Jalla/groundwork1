-- =========================================================
-- 025_preferred_lang.sql
--
-- Two things, both needed before outbound email can be translated.
--
-- 1. `profiles.preferred_lang` — the language a user has explicitly chosen, so email
--    is written in the *recipient's* language rather than the sender's. The two are
--    routinely different: a Jalla admin working in English approves a stage, and the
--    owner receiving the notification is in Douala and reads French.
--
-- 2. `profiles.email` — WHICH DOES NOT EXIST TODAY. This is a live bug, not new work.
--    src/lib/supabase/approvals.ts does:
--
--        supabase.from('profiles').select('full_name, email').eq('id', ...)
--
--    `profiles` (migration 001) has id, full_name, avatar_url, country, phone and the
--    Stripe columns from 021 — no email. PostgREST rejects the whole select, the
--    handler reads `profile?.email` off a null row, short-circuits, and the send is
--    skipped. Both branches are wrapped in `.catch(() => {})`, so it fails silently.
--
--    The upshot is that the "Stage Approved" and "Rework Requested" emails have never
--    reached anyone. Translating those templates without this column would just
--    produce untranslated silence instead of English silence.
-- =========================================================

-- ── 1. Language ──────────────────────────────────────────
--
-- NULL is meaningful: it means "this person has never told us". It is NOT a synonym
-- for English. `resolveRecipientLang()` in src/lib/i18n/translate.ts falls back through
-- the profile country, mirroring the in-app default, so a francophone Cameroonian who
-- never touches the toggle still gets French mail.
--
-- Deliberately NOT backfilled from country. Cameroon is officially bilingual — roughly
-- a fifth of the population is anglophone — so writing 'fr' onto every CM profile would
-- turn a reasonable default into a stored fact indistinguishable from a real choice.
-- Resolving at send time keeps the guess reversible.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_lang TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_preferred_lang_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_preferred_lang_check
      CHECK (preferred_lang IS NULL OR preferred_lang IN ('en', 'fr'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.preferred_lang IS
  'Explicit language choice (en|fr). NULL = never chosen; resolve from country at send time.';

-- ── 2. Email ─────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill every existing profile from the auth record.
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE u.id = p.id
   AND p.email IS DISTINCT FROM u.email;

COMMENT ON COLUMN public.profiles.email IS
  'Mirror of auth.users.email. Kept in sync by the triggers below so the mail path can '
  'read it under RLS without querying the auth schema.';

-- New signups: carry the email across from the start.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Transaction-local flag telling guard_profile_email() that this write is ours.
  PERFORM set_config('app.email_sync', 'on', true);
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END $$;

-- Address changes: keep the mirror honest, or we mail the old address forever.
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    PERFORM set_config('app.email_sync', 'on', true);
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email();

-- ── 3. Guard ─────────────────────────────────────────────
--
-- `email` is a mirror of an auth-controlled value. The existing "Users can update their
-- own profile" policy (001) is FOR UPDATE with no column list, and Postgres has no
-- column-level RLS, so without this a user could PATCH their own profiles.email to any
-- address — including someone else's — while auth.users still held the real one. Every
-- later notification for that account would then go to an address the account owner
-- never proved they control.
--
-- Same shape as the subscription-column guard in 021.

CREATE OR REPLACE FUNCTION public.guard_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;

  -- Our own sync path (handle_new_user / sync_profile_email) sets this flag. Without
  -- the exemption the guard would revert the very write that keeps the mirror correct
  -- whenever an email change arrives inside a request that carries JWT claims.
  IF coalesce(current_setting('app.email_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- service_role (server-side, no end user) may write freely.
  IF coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.email := OLD.email;   -- silently ignore rather than error the whole update
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_profile_email ON public.profiles;
CREATE TRIGGER trg_guard_profile_email
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_email();
