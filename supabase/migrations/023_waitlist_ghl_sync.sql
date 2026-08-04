-- 023_waitlist_ghl_sync.sql
--
-- Records whether a waitlist signup reached GoHighLevel.
--
-- Waitlist leads are mirrored to a GHL inbound webhook from api/ghl/waitlist.ts, and that
-- call is deliberately fire-and-forget: Supabase is the source of truth, and a CRM outage
-- must never turn a successful signup into a visible error for the person joining.
--
-- The cost of that choice is that a failed forward is otherwise invisible. Without this
-- column there is no way to tell which leads never reached the CRM during an outage, and
-- no way to backfill them afterwards — the information simply does not exist anywhere.
--
-- Defaults to false so existing rows are correctly marked as un-forwarded: they predate
-- the integration and genuinely are not in GHL.

ALTER TABLE public.waitlist_emails
  ADD COLUMN IF NOT EXISTS synced_to_ghl   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synced_to_ghl_at TIMESTAMPTZ;

COMMENT ON COLUMN public.waitlist_emails.synced_to_ghl IS
  'True once the lead was accepted by the GoHighLevel webhook. Written by the service '
  'role from api/ghl/waitlist.ts — never by the client.';

-- Find leads that need backfilling after an outage:
--   SELECT email, created_at FROM waitlist_emails
--    WHERE NOT synced_to_ghl ORDER BY created_at;

CREATE INDEX IF NOT EXISTS waitlist_emails_unsynced_idx
  ON public.waitlist_emails (created_at)
  WHERE NOT synced_to_ghl;

-- The anon INSERT policy from 002_waitlist.sql stays as-is. It has no WITH CHECK on
-- individual columns, so in principle a crafted client insert could set synced_to_ghl
-- true. That is harmless — the flag only drives an internal backfill query, carries no
-- entitlement, and the row is still a real signup.
