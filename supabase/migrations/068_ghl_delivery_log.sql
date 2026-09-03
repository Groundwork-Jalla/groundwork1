-- =========================================================
-- 068  A record of every reply GoHighLevel asks us to send
--
-- When somebody types into a Conversations thread and presses send, GHL does not deliver
-- anything itself: it POSTs the message to the conversation provider's delivery URL and
-- expects that provider to do the sending. We are the provider.
--
-- On 3 Sep 2026 a reply sent from the thread never arrived, and there was no way to tell
-- which half had failed:
--
--   · GHL never called us          → a routing problem on their side
--   · GHL called and we refused    → our secret, or a payload we could not read
--   · we sent it and Resend balked → a deliverability problem
--
-- Three completely different fixes, and from the outside all three look identical: a
-- message sitting in the thread that the contractor never got. The Vercel logs hold the
-- answer for a few days and then do not.
--
-- So every attempt is written down — the ones that worked as well as the ones that did
-- not, because "no rows at all" is itself the diagnosis for the first case and cannot be
-- distinguished from "nothing went wrong" unless successes are recorded too.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.ghl_delivery_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'sent' | 'rejected' | 'unauthorized' | 'unusable_payload' | 'wrong_location'
  outcome     TEXT NOT NULL,
  recipient   TEXT,
  subject     TEXT,
  -- GHL's message id, so a row here can be matched to a message in the thread.
  ghl_message_id TEXT,
  detail      TEXT,
  -- The body as received, trimmed. The field names in GHL's delivery payload are not
  -- documented and were written from guesswork; the first real one is what settles them.
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghl_delivery_log_recent_idx
  ON public.ghl_delivery_log (created_at DESC);

ALTER TABLE public.ghl_delivery_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ghl_delivery_log FROM PUBLIC, anon, authenticated;

-- No policies: written by the service role, read by admins through the function below.
-- The payload can carry a contractor's name and address, so it is not browser-readable.

CREATE OR REPLACE FUNCTION public.admin_ghl_delivery_log()
RETURNS SETOF public.ghl_delivery_log
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  RETURN QUERY
    SELECT * FROM public.ghl_delivery_log
     ORDER BY created_at DESC
     LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ghl_delivery_log() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ghl_delivery_log() TO authenticated;

COMMENT ON TABLE public.ghl_delivery_log IS
  'Every reply GoHighLevel asked us to deliver, successful or not. An empty table after '
  'a reply was sent from a thread means GHL never called the delivery URL.';
