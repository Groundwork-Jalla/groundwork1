-- =========================================================
-- 050_ghl_contact_and_outbox.sql
--
-- Phase 2 of the CRM plan: remember who is who, and stop losing events.
--
-- Two separate problems, one migration because the outbox stores the contact id it
-- resolved and they are meaningless apart.
--
-- ── 1. ghl_contact_id ────────────────────────────────────────────────────────────────
-- Everything we send today is fire-and-forget into a webhook, which cannot tell us the
-- id of the contact it created. So nothing can ever be updated afterwards: no tags, no
-- pipeline moves, no second event attaching to the same person. Storing the id GHL
-- returns is the single change that lifts that ceiling — it is why the roadmap says the
-- rest is "impossible rather than merely unbuilt" without it.
--
-- On both tables because the same human can arrive twice: as a homeowner who signed up
-- and as a contractor who applied. They are different rows here and should be one
-- contact there, matched on email by the upsert.
--
-- ── 2. ghl_outbox ────────────────────────────────────────────────────────────────────
-- A CRM outage currently loses the event permanently. Every push happens inline, and if
-- GHL is down the caller shrugs — correctly, because a signup must not fail over a CRM.
-- The event simply never happened.
--
-- The outbox records the intent before the attempt, so a failure leaves a row to retry
-- rather than nothing at all. Modelled on billing_events (021): write first, let a
-- unique key make replays no-ops.
--
-- Run in: Supabase Dashboard > SQL Editor (after migration 049)
-- =========================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;

ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;

COMMENT ON COLUMN public.profiles.ghl_contact_id IS
  'GoHighLevel contact id, returned by the v2 upsert. NULL means never synced through '
  'the API (a Phase 1 webhook push does not produce one). Service role writes only.';

CREATE INDEX IF NOT EXISTS profiles_ghl_contact_idx
  ON public.profiles (ghl_contact_id) WHERE ghl_contact_id IS NOT NULL;

-- ── The outbox ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ghl_outbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  event        TEXT NOT NULL,
  -- Everything needed to retry without re-deriving it from tables that may have moved
  -- on. An event replayed a day later should send what was true when it happened.
  payload      JSONB NOT NULL,

  -- Who it is about, for grouping in the admin view and for resolving the contact id.
  email        TEXT NOT NULL,
  contact_id   TEXT,

  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'sent', 'failed')),
  attempts     INT  NOT NULL DEFAULT 0,
  last_error   TEXT,

  -- Idempotency. Two pushes for the same thing — a double-click, a Stripe retry, a
  -- browser that fires on every session — collapse to one row.
  dedupe_key   TEXT NOT NULL UNIQUE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at      TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ
);

COMMENT ON TABLE public.ghl_outbox IS
  'Intent to tell GoHighLevel something. Written before the attempt so an outage leaves '
  'a retryable row instead of nothing. Rows are never deleted by the app — they are the '
  'record of what the CRM was told and when.';

-- The retry query, and the only one that runs often.
CREATE INDEX IF NOT EXISTS ghl_outbox_pending_idx
  ON public.ghl_outbox (created_at)
  WHERE status <> 'sent';

CREATE INDEX IF NOT EXISTS ghl_outbox_email_idx ON public.ghl_outbox (email);

ALTER TABLE public.ghl_outbox ENABLE ROW LEVEL SECURITY;

-- No policy for anon or authenticated: the service role bypasses RLS and is the only
-- writer, and admins read it through a SECURITY DEFINER function rather than directly.
-- The payload can hold a phone number and an address; it is not a browser-readable table.

/**
 * What the CRM still owes, newest first. Admin-only.
 *
 * SECURITY DEFINER with a hard is_admin() check, rather than an RLS policy, so the
 * table stays unreadable by default and there is exactly one way in.
 */
CREATE OR REPLACE FUNCTION public.admin_ghl_outbox(limit_n INT DEFAULT 100)
RETURNS TABLE (
  id UUID, event TEXT, email TEXT, status TEXT, attempts INT,
  last_error TEXT, created_at TIMESTAMPTZ, sent_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;

  RETURN QUERY
    SELECT o.id, o.event, o.email, o.status, o.attempts,
           o.last_error, o.created_at, o.sent_at
      FROM public.ghl_outbox o
     WHERE o.status <> 'sent'
     ORDER BY o.created_at DESC
     LIMIT GREATEST(1, LEAST(limit_n, 500));
END $$;

REVOKE ALL ON FUNCTION public.admin_ghl_outbox(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ghl_outbox(INT) TO authenticated;

-- What has not reached the CRM:
--   SELECT event, email, attempts, last_error, created_at
--     FROM public.ghl_outbox WHERE status <> 'sent' ORDER BY created_at;

-- ── Inbound: what GHL tells us ───────────────────────────────────────────────────────
--
-- Everything else is one-way. This is the landing table for appointments booked, replies
-- and unsubscribes — see api/ghl/inbound.ts, which records and never acts. GHL's
-- outbound webhooks are not signed, so that endpoint authenticates on a shared header
-- secret, which is weaker than Stripe's signature. Weaker auth is precisely why the
-- events land here inert instead of changing an application's status.

CREATE TABLE IF NOT EXISTS public.ghl_inbound_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     TEXT NOT NULL,
  email          TEXT,
  ghl_contact_id TEXT,
  payload        JSONB NOT NULL,
  handled_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ghl_inbound_events IS
  'Raw events received from GoHighLevel. Recorded, never acted on automatically — the '
  'endpoint authenticates on a shared secret rather than a signature, so nothing here '
  'may drive a decision without a person. handled_at is for whoever adds that later.';

CREATE INDEX IF NOT EXISTS ghl_inbound_unhandled_idx
  ON public.ghl_inbound_events (created_at DESC) WHERE handled_at IS NULL;
CREATE INDEX IF NOT EXISTS ghl_inbound_email_idx
  ON public.ghl_inbound_events (email) WHERE email IS NOT NULL;

ALTER TABLE public.ghl_inbound_events ENABLE ROW LEVEL SECURITY;
-- No policies: service role writes, admins read through a function, browsers never.
