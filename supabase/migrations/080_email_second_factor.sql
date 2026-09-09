-- =========================================================
-- 080  Email as a second factor, alongside the authenticator app
--
-- WHY THIS IS HAND-BUILT AND TOTP IS NOT
--
-- Supabase's MFA supports three factor types: `totp`, `phone` and `webauthn`. There is no
-- email factor, so `supabase.auth.mfa.enroll({ factorType: 'email' })` does not exist and
-- this cannot be delegated the way TOTP is.
--
-- The consequence is worth stating plainly rather than discovering later: a code verified
-- here does NOT raise the session's assurance level to `aal2`. Supabase does not know it
-- happened. Enforcement is therefore at the same level TOTP enforcement is today — the
-- app declines to route — and the note in `src/lib/auth/mfa.ts` about closing that at the
-- database applies to both factors equally.
--
-- WHY EMAIL AT ALL, GIVEN THAT
--
-- Philip, 4 September 2026: "can't you use 1) email-based 2FA and 2) authenticator app?"
-- The audience is diaspora clients; requiring an authenticator app is an adoption barrier
-- for people who have never used one. Email is weaker than TOTP and stronger than nothing,
-- and the choice between them belongs to the user.
--
-- SMS remains out, for the reasons in `mfa.ts`: international delivery to MTN and Orange,
-- per-message cost, and a factor that breaks when somebody travels or swaps a SIM — which
-- describes this audience normally, not exceptionally.
-- =========================================================

-- No enrolment secret to store: the address is already verified at signup, so turning
-- email 2FA on is a preference, not a credential.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_mfa_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.email_mfa_enabled IS
  'The user asked for a code by email at sign-in. Not a Supabase MFA factor — see '
  'migration 080 and api/_handlers/mfa-email.ts.';

-- ── In-flight codes ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_otp_challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The code itself is NEVER stored. A leaked backup of this table must not be a list of
  -- live second factors, so it holds sha256(code || id) and the id is per-row, which
  -- makes a rainbow table over six digits useless.
  code_hash   TEXT NOT NULL,

  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  -- Six digits is a million guesses; a few hundred attempts would find one. Counted here
  -- so the limit survives a client that simply retries.
  attempts    INT NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_otp_user_idx
  ON public.email_otp_challenges (user_id, created_at DESC);

-- ── Nobody reads this from a browser ─────────────────────
--
-- RLS on with NO policies at all, the same lock as `app_config`: whatever role a browser
-- session holds, it cannot select, insert or update here. Every path goes through the
-- service role in `api/_handlers/mfa-email.ts`. A user being able to read their own row
-- would defeat the entire mechanism — the hash is not the code, but the attempt counter
-- and expiry are exactly what an attacker wants to see.
ALTER TABLE public.email_otp_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_otp_challenges FROM anon, authenticated;

-- Stated rather than inherited. Supabase's default privileges would grant this anyway,
-- but a table whose only reader is one serverless handler should say so in the migration
-- that creates it — not depend on a project-level setting somebody could change.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_otp_challenges TO service_role;

-- ── Housekeeping ─────────────────────────────────────────
--
-- Consumed and expired challenges have no value and are a standing liability. Cleared
-- opportunistically on insert rather than by a scheduled job, because there is no
-- scheduler here and a table that grows forever is worse than one swept a little late.
CREATE OR REPLACE FUNCTION public.sweep_email_otp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.email_otp_challenges
   WHERE expires_at < now() - INTERVAL '1 day';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_email_otp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sweep_email_otp ON public.email_otp_challenges;
CREATE TRIGGER trg_sweep_email_otp
  AFTER INSERT ON public.email_otp_challenges
  FOR EACH STATEMENT EXECUTE FUNCTION public.sweep_email_otp();
