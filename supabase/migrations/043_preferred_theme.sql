-- =========================================================
-- 043_preferred_theme.sql
--
-- `profiles.preferred_theme` — the light/dark choice a user has explicitly made.
--
-- Until now the choice lived only in this browser's localStorage, so it was a
-- property of the *device*, not the account: signing in from a phone, or from a
-- second laptop, dropped you back to the OS default. The requirement is that the
-- choice belongs to the account and holds until it is changed, so it has to be
-- stored server-side like preferred_lang (025).
--
-- NULL is meaningful in exactly the same way it is for preferred_lang: it means
-- "never chosen", not "light". A NULL profile follows the OS via
-- prefers-color-scheme, and the pre-paint script in app/root.tsx makes that
-- decision before first paint so there is no flash.
--
-- Deliberately no backfill. Writing 'light' onto every existing row would turn
-- "we don't know" into a stored fact, and those users would stop following their
-- OS setting without ever having asked for that.
-- =========================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_theme TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_preferred_theme_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_preferred_theme_check
      CHECK (preferred_theme IS NULL OR preferred_theme IN ('light', 'dark'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.preferred_theme IS
  'Explicit colour-scheme choice (light|dark). NULL = never chosen; follow the OS.';
