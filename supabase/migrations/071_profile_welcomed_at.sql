-- =========================================================
-- 069  Record which homeowners have had the welcome email
--
-- `contractor_applications.acknowledged_at` is why the contractor backfill correctly
-- reported "1 send, 35 backfill": the column says who has already been written to, so a
-- re-run puts a thread on the other 35 without emailing any of them twice.
--
-- Homeowners had no equivalent, because until 3 Sep 2026 they had never been sent
-- anything at all — the welcome template did not exist. The backfill therefore treated
-- every homeowner as a first contact, which was true for exactly one run. The second run
-- reported "26 send, 0 backfill" and would have delivered a duplicate welcome to the 24
-- people who received one that evening.
--
-- One nullable timestamp, the same shape as the contractor column, so the two paths
-- reason about "have we written to this person" identically.
-- =========================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS crm_welcomed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.crm_welcomed_at IS
  'When the Groundwork welcome email was sent. NULL means never — the CRM backfill '
  'sends to those and only backfills the Conversations thread for everyone else. '
  'Stamped after Resend accepts, never before, so a failed send is retried.';

-- Backfill the people who were emailed on the evening of 3 Sep 2026.
--
-- Their welcome genuinely went out; without this they would be counted as never
-- contacted and emailed again on the next run. Scoped to accounts that existed before
-- that send, so anyone who has signed up since is correctly still owed one.
UPDATE public.profiles
   SET crm_welcomed_at = TIMESTAMPTZ '2026-09-03 19:55:00+00'
 WHERE crm_welcomed_at IS NULL
   AND email IS NOT NULL
   AND created_at < TIMESTAMPTZ '2026-09-03 19:55:00+00';
