-- =========================================================
-- 156 — A partner applicant's account can actually be deleted
--
-- Found by deleting a test account at the end of an end-to-end run. The delete failed:
--
--   23514  new row for relation "contractor_applications" violates check constraint
--          "contractor_application_claim_shape"
--
-- Two correct decisions that together forbid something neither intended:
--
--   100  `user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL` — written for the
--        apply-first flow, where an application genuinely outlived any account.
--   137  an in-app application must always carry its user: "linked from birth", because
--        133 inverted the order and the applicant signs up before applying.
--
-- Deleting the account sets user_id to NULL; the CHECK refuses the row; the whole
-- delete rolls back. So ANY partner who applied from inside Groundwork cannot be
-- removed — not by the admin's "Delete contractor account", and not when staff action
-- the deletion request the applicant themselves filed from their profile. A data-rights
-- request that cannot be carried out is worse than one that is slow.
--
-- ── CASCADE, not a relaxed constraint ───────────────────────────────────────────────
-- The alternative was to let an in-app row keep a NULL user_id once the account was
-- gone. That keeps the funnel's history intact — and keeps the applicant's name, phone
-- number, email and everything they wrote about themselves, on a row belonging to
-- somebody who asked to be forgotten. Their application IS their personal data.
--
-- So the row goes with the person. The cost is real and worth stating plainly: a
-- deletion removes that applicant from the funnel's history, and counts taken before
-- and after will differ by one. That is the correct consequence of somebody exercising
-- deletion, not a bug to be designed around.
--
-- The public `contractor_applications` of the apply-first era are untouched: their
-- user_id was always nullable by design, and nulling it is still right for them.
--
-- Run in: Supabase Dashboard > SQL Editor (after 155)
-- =========================================================

BEGIN;

-- The constraint stays exactly as 137 wrote it. What changes is that nothing tries to
-- violate it any more.
ALTER TABLE public.contractor_applications
  DROP CONSTRAINT IF EXISTS contractor_applications_user_id_fkey;

ALTER TABLE public.contractor_applications
  ADD CONSTRAINT contractor_applications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.contractor_applications.user_id IS
  'The applicant''s account. CASCADE since 156: an in-app application must always carry '
  'its user (137), so SET NULL made the row unsatisfiable and blocked the account from '
  'ever being deleted. The application is the applicant''s own personal data and goes '
  'with them.';

-- The draft holds the same answers, half-finished, and the same personal details.
ALTER TABLE public.contractor_application_drafts
  DROP CONSTRAINT IF EXISTS contractor_application_drafts_user_id_fkey;

ALTER TABLE public.contractor_application_drafts
  ADD CONSTRAINT contractor_application_drafts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   An in-app applicant can now be removed:
--     DELETE FROM auth.users WHERE id = '<a partner applicant>';
--     → succeeds; their application and any draft go with them.
--   And a public application still survives its claimant, as 100 intended:
--     SELECT count(*) FROM public.contractor_applications
--      WHERE source <> 'in_app' AND user_id IS NULL;
