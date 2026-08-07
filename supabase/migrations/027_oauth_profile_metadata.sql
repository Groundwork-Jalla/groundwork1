-- =========================================================
-- 027_oauth_profile_metadata.sql
--
-- Make profile creation work for OAuth sign-ups (Google), not just the form.
--
-- The original handle_new_user() read exactly one key:
--     NEW.raw_user_meta_data->>'full_name'
-- Our signup form sets that explicitly, so email/password sign-ups were fine.
-- A Google user never touches that form: their metadata comes from Google's
-- OIDC claims (`name`, `given_name`, `family_name`, `picture`, `avatar_url`).
-- Depending on how the provider normalises them, `full_name` can be absent —
-- and the profile is then created with a NULL name, which surfaces as a blank
-- display name everywhere in the app.
--
-- `avatar_url` has existed on profiles since 001 but was never populated at all.
-- Google supplies one, so take it.
--
-- Fix: fall back through the plausible keys instead of trusting exactly one.
-- Order matters — most-specific and most-trusted first, email local-part last
-- so there is always *something* to show.
--
-- Run in: Supabase Dashboard > SQL Editor (after migration 026)
-- =========================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
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

  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, v_name, v_avatar)
  ON CONFLICT (id) DO NOTHING;              -- never block sign-up on a dup row

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill anyone who already signed up with a blank name or missing avatar.
-- Same precedence as above, applied to existing auth.users metadata.
UPDATE public.profiles p
SET
  full_name = COALESCE(
    NULLIF(TRIM(p.full_name), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    NULLIF(TRIM(CONCAT_WS(' ',
      u.raw_user_meta_data->>'given_name',
      u.raw_user_meta_data->>'family_name')), ''),
    NULLIF(SPLIT_PART(COALESCE(u.email, ''), '@', 1), '')
  ),
  avatar_url = COALESCE(
    NULLIF(TRIM(p.avatar_url), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'avatar_url'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'picture'), '')
  ),
  updated_at = NOW()
FROM auth.users u
WHERE u.id = p.id
  AND (
    COALESCE(TRIM(p.full_name), '') = ''
    OR COALESCE(TRIM(p.avatar_url), '') = ''
  );
