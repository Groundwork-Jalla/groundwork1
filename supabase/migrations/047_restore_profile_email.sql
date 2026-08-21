-- =========================================================
-- 047_restore_profile_email.sql
--
-- Put the email back into handle_new_user(), and backfill everyone it missed.
--
-- 025 made the function insert (id, full_name, email) so that profiles.email
-- mirrors auth.users.email — the app cannot read auth.users from the browser, so
-- that mirror is the only address every outbound email has to work with.
--
-- 027 rewrote the same function to fix OAuth display names and, in doing so,
-- inserted only (id, full_name, avatar_url). The email was dropped silently.
-- sync_profile_email() (025) fires only on an address *change*, so it never
-- filled the gap in. Every account created since 027 therefore has
-- profiles.email = NULL, and these two both quietly return without sending:
--
--     src/lib/supabase/approvals.ts:283   if (profile?.email)
--     src/lib/supabase/approvals.ts:362   if (!profile?.email) return;
--
-- which is the stage-approved and rework-requested emails to project owners.
-- No error, no log — the code reads as though it sent.
--
-- This is a merge of the two, not a revert: 027's name/avatar precedence is kept
-- exactly as written, with the email restored alongside it.
--
-- Three details that are load-bearing:
--
--   * set_config('app.email_sync', ...) must stay. guard_profile_email() (025)
--     reverts any email write that arrives without it, and ON CONFLICT DO UPDATE
--     below takes the UPDATE path where that trigger lives.
--   * ON CONFLICT DO UPDATE, not 027's DO NOTHING. 027 chose DO NOTHING to avoid
--     ever blocking a sign-up on a duplicate row; DO UPDATE keeps that property
--     (still no error) while letting a pre-existing row pick up its mirror.
--   * SET search_path = public is restored. 025 had it, 027 dropped it, and this
--     is a SECURITY DEFINER function — without a pinned search_path the resolution
--     of `public.profiles` depends on the caller's path.
--
-- Not addressed here, deliberately: 005's handle_new_user() also inserted a
-- user_profiles row, and 025/027 dropped that too. `user_profiles` has no readers
-- anywhere in the application, so it is left alone rather than resurrected blind.
--
-- Run in: Supabase Dashboard > SQL Editor (after migration 046)
-- =========================================================

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

  -- Tells guard_profile_email() this write is ours.
  PERFORM set_config('app.email_sync', 'on', true);

  INSERT INTO public.profiles (id, full_name, avatar_url, email)
  VALUES (NEW.id, v_name, v_avatar, NEW.email)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;             -- never block sign-up; just fix the mirror

  RETURN NEW;
END $$;

-- Backfill every account created since 027. Scoped to rows that actually differ so
-- re-running is free, and wrapped in the same flag the guard looks for.
DO $$
BEGIN
  PERFORM set_config('app.email_sync', 'on', true);

  UPDATE public.profiles p
  SET email      = u.email,
      updated_at = NOW()
  FROM auth.users u
  WHERE u.id = p.id
    AND p.email IS DISTINCT FROM u.email;
END $$;

-- Expected: 0. Anything else means the guard reverted the backfill.
-- SELECT count(*) FROM public.profiles p
--   JOIN auth.users u ON u.id = p.id
--  WHERE p.email IS DISTINCT FROM u.email;
