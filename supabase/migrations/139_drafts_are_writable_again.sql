-- =========================================================
-- 139 — Nobody could save a draft at all
--
-- PRODUCTION BUG, found while testing 138. Every write to
-- `contractor_application_drafts` is refused:
--
--   new row violates row-level security policy for
--   table "contractor_application_drafts"   (42501)
--
-- Both as `anon` (the public form at /contractor-apply) and as `authenticated` (the
-- new partner application). The message matters: "violates row-level security policy"
-- is not "permission denied for table", so the GRANT is intact and the problem is that
-- no permissive INSERT policy matches. 043 wrote those policies; they are not in force
-- on this database.
--
-- Nothing in this repository removed them — no later migration mentions the table
-- except 052, which only reads it. So either 043 was applied in an earlier form, before
-- `TO anon, authenticated` was on the policy, or the policies were changed outside
-- these files. Either way the effect is the same and has been silent, because
-- `saveApplicationDraft` swallows its errors on purpose: an autosave must never
-- interrupt somebody applying. The cost of that decision is that this failed quietly
-- for as long as it has been failing, and /admin/drafts has been listing only rows
-- written before it broke.
--
-- This re-asserts 043's four policies verbatim. Idempotent: every one is dropped first,
-- so running it twice is harmless and running it where they already exist changes
-- nothing.
--
-- Run in: Supabase Dashboard > SQL Editor (after 138)
-- =========================================================

BEGIN;

ALTER TABLE public.contractor_application_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_can_draft"        ON public.contractor_application_drafts;
DROP POLICY IF EXISTS "anyone_can_update_draft" ON public.contractor_application_drafts;
DROP POLICY IF EXISTS "admins_read_drafts"      ON public.contractor_application_drafts;
DROP POLICY IF EXISTS "admins_delete_drafts"    ON public.contractor_application_drafts;

-- ── Write: open, because the applicant has no account ────
--
-- 043's reasoning, unchanged: the id is an unguessable UUID held only in the applicant's
-- browser, and that is what stops one person writing over another's draft. `authenticated`
-- is included because a partner filling the in-app application (133) is signed in.
--
-- SELECT is deliberately NOT granted here. These rows hold names, phone numbers and
-- emails, and only staff read them back.
CREATE POLICY "anyone_can_draft"
  ON public.contractor_application_drafts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "anyone_can_update_draft"
  ON public.contractor_application_drafts FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "admins_read_drafts"
  ON public.contractor_application_drafts FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "admins_delete_drafts"
  ON public.contractor_application_drafts FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- The grants the policies sit on top of. Stated explicitly so a missing GRANT cannot be
-- the next silent cause of the same symptom.
GRANT INSERT, UPDATE ON public.contractor_application_drafts TO anon, authenticated;
GRANT SELECT, DELETE  ON public.contractor_application_drafts TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--
-- Verify with an UPSERT, not a plain insert. `saveApplicationDraft` upserts on `id` so
-- that the first save creates the row and every later one replaces it — which is
-- INSERT ... ON CONFLICT DO UPDATE, and Postgres requires the UPDATE policy for it as
-- well as the INSERT one. A plain insert passes on the INSERT policy alone, so it can
-- report success while every real save still fails. That is exactly how this migration
-- was first mis-verified as applied.
--
--   As the anon key AND again with a user's JWT:
--     POST /rest/v1/contractor_application_drafts
--       Prefer: resolution=merge-duplicates
--       {"id":"<uuid>","full_name":"probe","payload":{},"progress_pct":10}
--     → 201 for both. A 401 or 403 means the UPDATE policy is still missing.
--
--   And staff must still be the only ones who can read them back:
--     GET /rest/v1/contractor_application_drafts   as anon → empty, never rows.
