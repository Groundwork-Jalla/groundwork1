-- =========================================================
-- 137 — An in-app partner application has no claim to make
--
-- BLOCKING BUG. Every submission of the in-app partner application (133) was refused:
--
--   new row for relation "contractor_applications"
--   violates check constraint "contractor_application_claim_shape" (23514)
--
-- 100 added that constraint as `(claimed_at IS NULL) = (user_id IS NULL)`, with the
-- comment "Claimed and linked are the same fact. Either both or neither." That was true
-- of the apply-first flow it was written for: a stranger applied with no account, and
-- `user_id` appeared only at the moment they claimed one from an acceptance email.
--
-- 133 inverted the order. The applicant now signs up FIRST and applies from inside the
-- product, so the row is linked to them from birth and there is never anything to claim.
-- `user_id` is set, `claimed_at` stays NULL, and the old equality rejects the row.
--
-- 133 added the column and the insert policy but never revisited this constraint, so the
-- whole of funnel step 4 — "partner applications completed" — was unreachable. The
-- applicant saw a form, filled it in, pressed send and got a Postgres error.
--
-- The rule restated: a claim is a thing that happens to a PUBLIC application. An in-app
-- application is linked and unclaimable.
--
-- Run in: Supabase Dashboard > SQL Editor (after 136)
-- =========================================================

BEGIN;

ALTER TABLE public.contractor_applications
  DROP CONSTRAINT IF EXISTS contractor_application_claim_shape;

ALTER TABLE public.contractor_applications
  ADD  CONSTRAINT contractor_application_claim_shape
  CHECK (
    CASE source
      -- Filed from inside the product by somebody who already holds the account. Linked
      -- from birth, and claiming is not a thing that can happen to it.
      WHEN 'in_app' THEN user_id IS NOT NULL AND claimed_at IS NULL
      -- The public form, unchanged: 100's rule exactly.
      ELSE (claimed_at IS NULL) = (user_id IS NULL)
    END
  );

COMMENT ON CONSTRAINT contractor_application_claim_shape ON public.contractor_applications IS
  'Two shapes, one per source (137). A public application is linked only when claimed, '
  'which is 100''s original rule. An in-app application (133) is filed by somebody who '
  'already has an account: linked from birth, never claimed. Collapsing the two is what '
  'made every in-app submission fail with 23514.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   An in-app application inserts with user_id and no claimed_at:
--     INSERT INTO public.contractor_applications (source, user_id, full_name, email)
--     VALUES ('in_app', '<a user uuid>', 'Test', 't@example.com');   → succeeds
--   A public application still cannot be linked without being claimed:
--     INSERT INTO public.contractor_applications (source, user_id, full_name, email)
--     VALUES ('public', '<a user uuid>', 'Test', 't@example.com');   → 23514
