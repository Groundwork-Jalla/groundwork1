-- =========================================================
-- 067  Somewhere to keep the Marketplace app's OAuth token
--
-- ── Why a second credential exists at all ────────────────────────────────────────────
-- Everything Groundwork asks of GoHighLevel authenticates with a Private Integration
-- Token: contacts, custom fields, media, pipelines. One credential, no refresh, issued
-- straight to the sub-account.
--
-- `/conversations/messages/inbound` is the exception. It posts a message *as a
-- conversation provider*, and a provider belongs to a Marketplace app — so GHL appears
-- to require the caller to BE that app, authenticated with the app's OAuth access token.
-- A PIT is scoped to the location and is not the app, which is why granting it
-- `conversations/message.write` changed nothing and the call kept returning 401 on
-- 3 Sep 2026.
--
-- ── Why the token needs a table ──────────────────────────────────────────────────────
-- Unlike the PIT, an OAuth access token expires (GHL issues ~24h) and must be refreshed
-- with a refresh token. That is state: it changes on its own schedule, has to survive a
-- deploy, and has to be shared by every serverless instance. app_config would work but
-- would mix a rotating credential in with settings a human edits by hand — and someone
-- pasting over a live access token at 3am is exactly the failure this avoids.
--
-- Nothing else in the integration depends on this. If the token is missing or expired
-- and cannot be refreshed, the email log falls back to writing a note, which is what it
-- did before any of this existed.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.ghl_oauth_tokens (
  location_id   TEXT PRIMARY KEY,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  -- Absolute, not a duration: `expires_in` is only meaningful at the moment of issue,
  -- and storing the duration means every reader has to know when that was.
  expires_at    TIMESTAMPTZ NOT NULL,
  scope         TEXT,
  user_type     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ghl_oauth_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ghl_oauth_tokens FROM PUBLIC, anon, authenticated;

-- No policies, deliberately. Same reasoning as app_config (058): the only readers are
-- Vercel functions holding the service role. Nothing reachable from a browser can read
-- an access token, whatever role the session carries.

COMMENT ON TABLE public.ghl_oauth_tokens IS
  'OAuth access/refresh tokens for the GoHighLevel Marketplace app, per location. '
  'Used only for /conversations/messages/inbound, which will not accept a Private '
  'Integration Token. Written by the OAuth callback and by the refresh path.';


-- ── The client credentials the refresh needs ─────────────────────────────────────────
-- From the Marketplace app: MANAGE → Secrets → Client keys. Uncomment, paste, run.
--
-- INSERT INTO public.app_config (key, value) VALUES
--   ('ghl_client_id',     'PASTE_CLIENT_ID'),
--   ('ghl_client_secret', 'PASTE_CLIENT_SECRET')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();


-- ── What is stored right now ─────────────────────────────────────────────────────────
-- Never prints a token, only whether one exists and when it expires.
--
--   SELECT location_id,
--          length(access_token)  AS access_len,
--          length(refresh_token) AS refresh_len,
--          expires_at,
--          expires_at < now() AS expired,
--          updated_at
--     FROM public.ghl_oauth_tokens;
