-- An invitation email is owed until it is sent, and the database remembers that.
--
-- ── WHAT IS WRONG ───────────────────────────────────────────────────────────────────
--
-- Favour, 9 Nov 2026: "an email invite shouldn't even fail."
--
-- Right, and the honest reading of that is not "handle the failure better" — which is
-- what the panel was changed to do on 7 Nov — it is that nothing is trying twice.
--
-- The send happens in the BROWSER, once:
--
--     invites.ts:  insert the row  →  fetch('/api/send-invite')  →  emailSent = r.ok
--
-- The row is written first, so the invitation always exists. The email is one attempt
-- from the client, and every way it can fail loses it permanently:
--
--   · the person closes the tab or navigates away mid-request;
--   · Resend returns 429 or a 5xx, which is a retry, not a verdict;
--   · a phone drops to no signal between the insert and the fetch — Cameroon-first,
--     this is the ordinary case, not the exotic one;
--   · a Vercel cold start runs past the browser's patience.
--
-- In every one of those the only trace is `console.error` in a browser that has since
-- been closed. Nothing server-side knows an email is owed, so nothing can ever send it.
--
-- `project_viewers` has 0 rows in production and 13 contractor invites exist. Whatever
-- the mix of causes, the client invitation path has produced nothing at all, and the
-- system cannot currently tell "nobody tried" from "every attempt was lost".
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────────────
--
-- Three columns per invitation table, so the SERVER holds the fact:
--
--   email_sent_at    null means still owed. Set only when the provider accepted it.
--   email_attempts   how many times we have tried, so a permanent failure stops.
--   email_error      why the last one failed, so somebody can read it.
--
-- The browser still fires the first attempt — that is what makes the common case
-- instant — but it is no longer the only one. A sweeper on the hourly cron
-- (`lifecycle-run`) picks up anything still owed and tries again.
--
-- ── WHY EVERY EXISTING ROW IS MARKED SENT ──────────────────────────────────────────
--
-- Because we have no record either way, and the two mistakes are not equal. Marking a
-- genuinely-unsent old invitation as sent costs one invitation nobody was waiting on.
-- Leaving them owed would have the first cron run email thirteen people about builds
-- they joined in August, and one person about a three-month-old invitation that has
-- long since been settled some other way.
--
-- So the mechanism starts clean and applies to invitations made from here on.
--
-- Run in: Supabase Dashboard > SQL Editor (after 177)

BEGIN;

-- ── 1. Contractor invitations ──────────────────────────────
ALTER TABLE public.contractor_invites
  ADD COLUMN IF NOT EXISTS email_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_error    text;

COMMENT ON COLUMN public.contractor_invites.email_sent_at IS
  'When the provider accepted the invitation email (178). NULL means it is still '
  'owed and the sweeper will try again. The invitation itself is valid either way — '
  'the row is what grants access, the email is only how they find out.';

-- ── 2. Client / family invitations ─────────────────────────
ALTER TABLE public.project_viewers
  ADD COLUMN IF NOT EXISTS email_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_error    text;

COMMENT ON COLUMN public.project_viewers.email_sent_at IS
  'When the provider accepted the invitation email (178). NULL means still owed. '
  'This table had 0 rows in production when the column was added, so nothing here '
  'is backfilled on faith.';

-- ── 3. What the sweeper reads ──────────────────────────────
-- Partial: the interesting set is tiny and stays tiny, because a row leaves it the
-- moment the email lands. A full index would be almost entirely rows nobody will
-- ever look at again.
CREATE INDEX IF NOT EXISTS contractor_invites_email_owed
  ON public.contractor_invites (created_at)
  WHERE email_sent_at IS NULL AND status = 'pending';

CREATE INDEX IF NOT EXISTS project_viewers_email_owed
  ON public.project_viewers (invited_at)
  WHERE email_sent_at IS NULL AND accepted_at IS NULL AND revoked_at IS NULL;

-- ── 4. Start clean ─────────────────────────────────────────
-- See the header: an old invitation is treated as delivered, because re-sending one
-- is a worse error than never knowing. 12 of the 13 were accepted, which is its own
-- proof the email arrived.
UPDATE public.contractor_invites
   SET email_sent_at = COALESCE(accepted_at, created_at)
 WHERE email_sent_at IS NULL;

UPDATE public.project_viewers
   SET email_sent_at = COALESCE(accepted_at, invited_at)
 WHERE email_sent_at IS NULL;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- nothing is owed yet, because everything predates the mechanism
--   SELECT count(*) FROM public.contractor_invites WHERE email_sent_at IS NULL;
--   SELECT count(*) FROM public.project_viewers    WHERE email_sent_at IS NULL;
--   -- expect: 0 and 0
--
--   -- after a few days, what is stuck and why
--   SELECT email, email_attempts, email_error, created_at
--     FROM public.contractor_invites
--    WHERE email_sent_at IS NULL AND status = 'pending'
--    ORDER BY created_at;
