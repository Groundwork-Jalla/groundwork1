-- =========================================================
-- 20261127000000 — Drop legacy one-per-account application index
--
-- BLOCKING BUG. Any contractor whose previous partner application ended in
-- `disqualified` (for example answering "no active project" or "homeowner can visit
-- site daily" on /work/partner) or `rejected` could never submit a fresh application:
--
--   23505  duplicate key value violates unique constraint
--          "contractor_applications_one_per_account"
--
-- Why this happened:
--   100_contractor_account_claim.sql created `contractor_applications_one_per_account`
--   on `(user_id) WHERE user_id IS NOT NULL` — blocking ANY second row for the same
--   account regardless of status.
--   133_partner_application.sql later added `contractor_applications_one_open_per_user`
--   on `(user_id) WHERE user_id IS NOT NULL AND status IN ('pending', 'reviewing', 'accepted')`
--   specifically so disqualified and rejected rows would not block a fresh attempt —
--   but never dropped 100's wider index.
--
-- Because /work/partner renders the form again whenever the latest row is `disqualified`
-- or `rejected`, every second attempt failed on INSERT with 23505, surfacing the generic
-- "We couldn't save your application" error (including on disqualifying stops).
--
-- Dropping `contractor_applications_one_per_account` leaves
-- `contractor_applications_one_open_per_user` as the single source of truth:
--   - At most ONE live (`pending`, `reviewing`, `accepted`) application per user_id
--     (which also preserves 100's `claim_contractor_account` invariant, since only
--     `accepted` applications can be claimed, backed by `contractors_one_per_account`).
--   - `disqualified` and `rejected` applications stay recorded for funnel analytics
--     without locking the contractor out of reapplying when their situation changes.
--
-- Run in: Supabase Dashboard > SQL Editor
-- =========================================================

BEGIN;

DROP INDEX IF EXISTS public.contractor_applications_one_per_account;

CREATE UNIQUE INDEX IF NOT EXISTS contractor_applications_one_open_per_user
  ON public.contractor_applications (user_id)
  WHERE user_id IS NOT NULL AND status IN ('pending', 'reviewing', 'accepted');

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND tablename = 'contractor_applications'
--      AND indexname IN (
--        'contractor_applications_one_per_account',
--        'contractor_applications_one_open_per_user'
--      );
--   → Expect ONLY `contractor_applications_one_open_per_user`.
