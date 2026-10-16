-- =========================================================
-- 126  A project message reaches the phone
--
-- WHY
--
-- Reported from testing: a client has a real WhatsApp number on file, their contractor
-- writes to them in Groundwork, and nothing arrives on their phone. 123 gave them a bell
-- and an email; neither is the thing they actually carry.
--
-- The reason was a boundary, not an omission. `sendWhatsAppMessage` — the one call that
-- makes a phone buzz — was reachable only from the admin Inbox, on a `whatsapp` thread,
-- for an `outbound` message. A contractor and a client talking on the project's own
-- Groundwork thread satisfy none of those three, so the carry never happened. The
-- project-chat mirror that did exist posts `type: 'Custom'`, which files a record inside
-- the CRM and sends nothing.
--
-- So: every non-internal message on a project's Groundwork thread is now carried to each
-- OTHER participant's WhatsApp. Decided deliberately, not inferred — a mirror of every
-- message costs one provider send per recipient and puts the same message on the bell,
-- in the inbox and on the phone.
--
-- ── Why a trigger and not the browser ───────────────────────────────────────────────
-- The existing CRM mirror is fire-and-forget from the page that sent the message, so it
-- simply does not happen if the tab closes first — and it cannot happen at all for a
-- message Groundwork wrote server-side. The email in 123 already fans out from a trigger;
-- putting the phone on the same event means one thing decides who hears about a message,
-- rather than two that can disagree.
--
-- ── Why it cannot loop ──────────────────────────────────────────────────────────────
-- Two independent reasons, because one would be a promise rather than a guarantee:
--
--   1. SCOPE. This fires only on the project's `jalla` thread. What the fan-out sends
--      lands on a `whatsapp` conversation, which belongs to a PERSON and carries no
--      project (091) — outside this trigger's reach. A provider echo therefore cannot
--      re-enter the fan-out.
--   2. THE LEDGER. `message_deliveries` is unique on (message, recipient, channel), so a
--      given message is carried to a given person at most once, whatever calls the
--      endpoint and however often.
--
-- ── Why the ledger is a table and not a log line ────────────────────────────────────
-- A send that failed is a message somebody never got. 077 established the pattern: record
-- the attempt, leave the provider id null when it did not land, and a partial index is
-- then the backlog a reconcile reads. A console line is not a backlog.
--
-- Run in: Supabase Dashboard > SQL Editor (after 125)
--
-- ── Not SQL, and the feature is inert without it ────────────────────────────────────
--   INSERT INTO public.app_config (key, value) VALUES
--     ('message_fanout_url', 'https://www.tryjalla.com/api/events?action=message-fanout')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- The shared secret is `agent_dispatch_secret`, which is already set — the DB→our-API
-- trust boundary is the same one 059 and 063 cross. A dedicated `message_fanout_secret`
-- is read first if you later want to rotate them separately.
-- =========================================================

BEGIN;

-- ── The ledger ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_deliveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES public.project_messages(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL,
  channel     TEXT NOT NULL,
  -- `pending` is written BEFORE the provider is called, which is what makes the unique
  -- index an idempotency guard rather than a report: a second caller finds the row and
  -- stops instead of sending a duplicate while the first is still in flight.
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  -- Why it was skipped or how it failed: 'no_phone', 'not_configured', a provider error.
  -- Named, because "it did not send" is not an answer anybody can act on.
  reason      TEXT,
  provider_message_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_deliveries_once
  ON public.message_deliveries (message_id, recipient_id, channel);

-- The backlog a reconcile reads: attempted, never landed.
CREATE INDEX IF NOT EXISTS message_deliveries_unsent
  ON public.message_deliveries (created_at)
  WHERE status IN ('pending', 'failed');

COMMENT ON TABLE public.message_deliveries IS
  'Every attempt to carry a Groundwork message to somebody off-platform (126). One row '
  'per message per person per channel, written before the provider is called so the '
  'unique index stops a duplicate send. A row with no provider_message_id and status '
  'pending or failed is a message somebody never received.';

ALTER TABLE public.message_deliveries ENABLE ROW LEVEL SECURITY;

-- Admin may read it: "did the client actually get that?" is a support question, and
-- answering it from the console is not answering it. Nobody writes from the browser —
-- the fan-out runs as service_role, which RLS does not apply to.
DROP POLICY IF EXISTS "admin_read_message_deliveries" ON public.message_deliveries;
CREATE POLICY "admin_read_message_deliveries" ON public.message_deliveries
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.message_deliveries FROM PUBLIC, anon;
GRANT SELECT ON public.message_deliveries TO authenticated;

-- ── The trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fanout_message_to_phones()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  endpoint TEXT;
  secret   TEXT;
BEGIN
  -- An internal note is staff talking among themselves. It must never leave Groundwork,
  -- let alone arrive on the client's phone.
  IF NEW.direction = 'internal' THEN RETURN NEW; END IF;

  -- Only the project's own Groundwork thread. A `whatsapp` row is already on somebody's
  -- phone by definition, and carrying it again would both duplicate it and reopen the
  -- loop this scope closes.
  IF NEW.project_id IS NULL OR COALESCE(NEW.channel, 'jalla') <> 'jalla' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO endpoint FROM public.app_config WHERE key = 'message_fanout_url';
  SELECT value INTO secret   FROM public.app_config WHERE key = 'message_fanout_secret';
  -- The same DB→our-API boundary 059 and 063 cross. Falling back means this works the
  -- moment the URL is set, without a second secret to distribute first.
  secret := COALESCE(secret, (SELECT value FROM public.app_config WHERE key = 'agent_dispatch_secret'));

  -- Unconfigured is a normal state, not an error. Nobody should be unable to send a
  -- message because an outbound transport has not been set up.
  IF endpoint IS NULL OR endpoint = '' OR secret IS NULL OR secret = '' THEN
    RETURN NEW;
  END IF;

  -- Nothing here may cost the message. The row is already written and already on the
  -- recipient's screen; an AFTER trigger that raises still aborts the statement, so the
  -- whole call is swallowed. A transport failure is never a lost message.
  BEGIN
    PERFORM net.http_post(
      url     := endpoint,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || secret),
      body    := jsonb_build_object('messageId', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fanout_message_to_phones: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fanout_message_to_phones() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fanout_message_to_phones() IS
  'Asks the server to carry a project message to the other participants WhatsApp (126). '
  'Only the project jalla thread, never an internal note. Swallows every failure: the '
  'message is already real in Groundwork and must not be undone by a transport.';

DROP TRIGGER IF EXISTS trg_fanout_message_to_phones ON public.project_messages;
CREATE TRIGGER trg_fanout_message_to_phones
  AFTER INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.fanout_message_to_phones();

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- the trigger is attached, and only the one:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.project_messages'::regclass AND NOT tgisinternal;
--
--   -- after a real message on a project thread, who it was carried to:
--   SELECT d.recipient_id, d.status, d.reason, d.provider_message_id
--     FROM public.message_deliveries d
--     JOIN public.project_messages m ON m.id = d.message_id
--    ORDER BY d.created_at DESC LIMIT 10;
--
--   -- the backlog: attempted, never landed
--   SELECT count(*) FROM public.message_deliveries WHERE status IN ('pending','failed');
