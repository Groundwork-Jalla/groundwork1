-- Where a person is signed in.
--
-- The approved Profile screen shows "Signed in on · 2 devices · This laptop · a
-- phone in Limbe". Supabase does not expose a user's other sessions to the
-- browser, so until now the card could only offer "sign out everywhere" — Favour,
-- 30 October: "we need to actually capture it, so if it means having it in
-- Supabase, so be it."
--
-- WHAT THIS IS, AND IS NOT
--
-- It is a record of the devices a person has signed in from, written by the
-- browser itself. It is NOT the session list: revoking a row here does not end a
-- session, and the page never pretends otherwise. Ending sessions stays with
-- `auth.signOut({ scope: 'global' })`, which the card still offers.
--
-- WHAT IS STORED
--
-- A random per-browser id, a label the person can read ("Chrome on Windows"), and
-- when it was last seen. NOT the raw user agent, which is a fingerprint, and not
-- an IP address. The city shown beside a device comes from the profile the person
-- already gave us, not from geolocating them.
--
-- RLS: a person sees and writes only their own rows. Nobody else — not even an
-- admin surface — reads this table, because a list of somebody's devices answers
-- no question Groundwork staff need to ask.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Generated in the browser and kept in localStorage. Clearing site data makes
  -- the same machine look new, which is the honest outcome: we can no longer tell.
  device_key  TEXT NOT NULL,
  label       TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_key)
);

COMMENT ON TABLE public.user_devices IS
  'Devices a person has signed in from (168). A record for their own Profile page, '
  'not a session list — removing a row does not end a session.';

CREATE INDEX IF NOT EXISTS user_devices_mine
  ON public.user_devices (user_id, last_seen_at DESC);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_devices_select ON public.user_devices;
CREATE POLICY own_devices_select ON public.user_devices
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS own_devices_write ON public.user_devices;
CREATE POLICY own_devices_write ON public.user_devices
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS own_devices_touch ON public.user_devices;
CREATE POLICY own_devices_touch ON public.user_devices
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS own_devices_forget ON public.user_devices;
CREATE POLICY own_devices_forget ON public.user_devices
  FOR DELETE TO authenticated USING (user_id = auth.uid());

COMMIT;
