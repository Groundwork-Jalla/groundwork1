-- =========================================================
-- 065  A reconciliation queue for CRM syncs that failed
--
-- The contractor path now runs the API first and falls back to the legacy webhook only
-- when the API sync fails (see api/ghl/contractor.ts). A fallback record is defective by
-- construction: Philip's workflow does not map the email, so GHL cannot dedupe it, and
-- the record carries no contact id — there is nothing to merge on later.
--
-- That failure was announced with console.error, which is not a queue. Nobody reads
-- Vercel logs at 2am and they age out on the free plan, so the real failure mode was:
-- the API fails, a line is written nobody sees, a defective contact sits in GHL, and
-- somebody works a lead with no email attached to it — with no way to know a backlog
-- exists at all, let alone how big it is.
--
-- A row survives log retention, can be counted, and can be marked done.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.ghl_sync_failures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           TEXT NOT NULL,
  application_id UUID REFERENCES public.contractor_applications(id) ON DELETE CASCADE,
  -- Kept even though it is on the application row: an admin reconciling these needs to
  -- search GHL by address, and the application may have been deleted by then.
  email          TEXT,
  reason         TEXT,
  -- Whether the defective record was reached by the legacy webhook. A failure with no
  -- fallback means nothing is in GHL at all; one WITH a fallback means there is a
  -- record in GHL that needs correcting. Different jobs, so they are distinguishable.
  fell_back      BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghl_sync_failures_open_idx
  ON public.ghl_sync_failures (created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.ghl_sync_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ghl_sync_failures FROM PUBLIC, anon, authenticated;

-- No policies: written by the service role from Vercel, read by admins through the
-- SECURITY DEFINER function below. Same shape as ghl_outbox (050).

CREATE OR REPLACE FUNCTION public.admin_ghl_sync_failures()
RETURNS SETOF public.ghl_sync_failures
LANGUAGE plpgsql STABLE SECURITY DEFINER
-- Empty, not `public`. With a schema on the path a caller can create an object that
-- shadows an unqualified reference inside this body and have it run as the owner.
-- Every reference below is schema-qualified, which is what makes '' safe. Supabase's
-- own linter flags the `= public` form.
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  RETURN QUERY
    SELECT * FROM public.ghl_sync_failures
     WHERE resolved_at IS NULL
     ORDER BY created_at DESC
     LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ghl_sync_failures() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ghl_sync_failures() TO authenticated;

COMMENT ON TABLE public.ghl_sync_failures IS
  'CRM syncs that failed and left something needing a human. Written by the service '
  'role; read by admins via admin_ghl_sync_failures(). Resolve by setting resolved_at.';
