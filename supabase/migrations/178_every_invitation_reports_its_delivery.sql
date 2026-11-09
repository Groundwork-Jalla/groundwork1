-- Every invitation email says whether it actually arrived.
--
-- ── WHAT WAS ASKED ──────────────────────────────────────────────────────────────────
--
-- Favour, 9 Nov 2026: "an email invite shouldn't even fail... it's to ensure that every
-- email sent out actually delivers."
--
-- ── WHAT IS ALREADY FINE, SO NOBODY SPENDS A DAY ON IT ─────────────────────────────
--
-- The sending domain is configured correctly. Checked in public DNS, 9 Nov 2026:
--
--   resend._domainkey.mail.tryjalla.com   DKIM key published
--   send.mail.tryjalla.com  TXT           v=spf1 include:amazonses.com ~all
--   send.mail.tryjalla.com  MX            feedback-smtp.us-east-1.amazonses.com
--   _dmarc.tryjalla.com     TXT           v=DMARC1; p=quarantine; adkim=r; aspf=r
--
-- There is no `sp=`, so the org policy governs `mail.tryjalla.com`, and relaxed
-- alignment means a DKIM signature of `d=mail.tryjalla.com` aligns with it. SPF passes
-- on the bounce domain and aligns the same way. DMARC passes on both counts.
--
-- Misconfigured DNS is the usual reason mail quietly lands in spam, and it is NOT the
-- reason here. Worth writing down, because it is the first thing anybody will suspect.
--
-- ── WHAT IS ACTUALLY MISSING ───────────────────────────────────────────────────────
--
-- Nothing ever asks what became of the message.
--
-- `fetch('https://api.resend.com/emails')` returning 200 means Resend ACCEPTED it for
-- delivery. That is the beginning of the story. The mailbox may still bounce it, defer
-- it, or file it as spam, and Resend will say so — it emits `email.delivered`,
-- `email.bounced`, `email.complained` and `email.delivery_delayed` for every message.
-- Groundwork subscribes to none of them, keeps no provider id, and therefore cannot
-- answer "did Ada get her invitation?" for any invitation ever sent.
--
-- That is the gap. Not DNS, and not the absence of a retry: the absence of a RECEIPT.
--
-- So each invitation now carries its own delivery state, written by the provider:
--
--   email_message_id   Resend's id, which is what a webhook arrives quoting
--   email_status       queued -> sent -> delivered, or bounced / complained / failed
--   email_sent_at      the provider accepted it
--   email_delivered_at the receiving mail server accepted it
--   email_error        the bounce reason, in the provider's words
--   email_attempts     how many times we have asked
--
-- ── WHY `queued` IS THE DEFAULT AND NOT `sent` ─────────────────────────────────────
--
-- The row is written before the email is attempted, and the attempt is fired from the
-- BROWSER — one shot, no memory. A closed tab, a dropped mobile connection or a 429
-- loses it with no trace but a console line in a browser that has since gone. Starting
-- at `queued` makes "we never got as far as sending this" a state somebody can query,
-- rather than something indistinguishable from success.
--
-- ── WHY EVERY EXISTING ROW IS MARKED DELIVERED ─────────────────────────────────────
--
-- We have no receipts for them and never will. The two mistakes are not equal: calling
-- an old invitation delivered costs nothing, while leaving thirteen of them `queued`
-- would show a permanent false backlog on the first screen that reads this.
--
-- Run in: Supabase Dashboard > SQL Editor (after 177)

BEGIN;

-- ── 1. The states a message can be in ──────────────────────
DO $$ BEGIN
  CREATE TYPE public.email_delivery_status AS ENUM (
    'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE public.email_delivery_status IS
  'queued: not yet handed to the provider. sent: the provider accepted it. delivered: '
  'the receiving server accepted it. bounced / complained / failed: it did not arrive, '
  'or arrived and was reported as spam (178).';

-- ── 2. Contractor invitations ──────────────────────────────
ALTER TABLE public.contractor_invites
  ADD COLUMN IF NOT EXISTS email_message_id   text,
  ADD COLUMN IF NOT EXISTS email_status       public.email_delivery_status NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS email_sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS email_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_error        text,
  ADD COLUMN IF NOT EXISTS email_attempts     integer NOT NULL DEFAULT 0;

-- ── 3. Client / family invitations ─────────────────────────
ALTER TABLE public.project_viewers
  ADD COLUMN IF NOT EXISTS email_message_id   text,
  ADD COLUMN IF NOT EXISTS email_status       public.email_delivery_status NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS email_sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS email_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_error        text,
  ADD COLUMN IF NOT EXISTS email_attempts     integer NOT NULL DEFAULT 0;

-- ── 4. How a webhook finds its row ─────────────────────────
-- A receipt arrives quoting the provider's id and nothing else, so this is the only
-- way back to the invitation. Unique so a replayed webhook cannot match two rows.
CREATE UNIQUE INDEX IF NOT EXISTS contractor_invites_message_id
  ON public.contractor_invites (email_message_id) WHERE email_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_viewers_message_id
  ON public.project_viewers (email_message_id) WHERE email_message_id IS NOT NULL;

-- What is still owed, or went wrong. Partial, because the set is small by design: a
-- row leaves it the moment the receipt says delivered.
CREATE INDEX IF NOT EXISTS contractor_invites_undelivered
  ON public.contractor_invites (created_at)
  WHERE email_status <> 'delivered' AND status = 'pending';
CREATE INDEX IF NOT EXISTS project_viewers_undelivered
  ON public.project_viewers (invited_at)
  WHERE email_status <> 'delivered' AND accepted_at IS NULL AND revoked_at IS NULL;

-- ── 5. Start clean ─────────────────────────────────────────
-- See the header. 12 of the 13 contractor invitations were accepted, which is its own
-- proof the email arrived; `project_viewers` has no rows at all.
UPDATE public.contractor_invites
   SET email_status = 'delivered',
       email_sent_at = COALESCE(email_sent_at, accepted_at, created_at),
       email_delivered_at = COALESCE(email_delivered_at, accepted_at, created_at)
 WHERE email_status = 'queued';

UPDATE public.project_viewers
   SET email_status = 'delivered',
       email_sent_at = COALESCE(email_sent_at, accepted_at, invited_at),
       email_delivered_at = COALESCE(email_delivered_at, accepted_at, invited_at)
 WHERE email_status = 'queued';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- nothing should be outstanding yet; everything predates the mechanism
--   SELECT email_status, count(*) FROM public.contractor_invites GROUP BY 1;
--
--   -- once live: what was sent but never confirmed delivered, and what bounced
--   SELECT email, email_status, email_error, email_attempts, created_at
--     FROM public.contractor_invites
--    WHERE email_status NOT IN ('delivered') AND status = 'pending'
--    ORDER BY created_at DESC;
