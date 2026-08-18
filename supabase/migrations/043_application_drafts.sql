-- =========================================================
-- 043_application_drafts.sql
--
-- Capture a contractor application while it is being filled in, before Submit.
--
-- ── Why ──────────────────────────────────────────────────
--
-- The application asks for around eighteen things, including file uploads and three past
-- projects with references. A lot of people will start it and not finish, and today we
-- learn nothing from any of them — the row only exists once Submit succeeds.
--
-- This table holds the in-progress answers so that (a) an applicant can close the tab and
-- come back, and (b) we can see who started and follow up.
--
-- ── Consent ──────────────────────────────────────────────
--
-- The form says, visibly, that progress is saved. That sentence is what makes this
-- honest rather than covert: someone typing their phone number into a form that tells
-- them it is being saved has given it to us; someone typing it into a form that says
-- nothing has not.
--
-- Do not remove that line from the UI without removing this table.
--
-- ── Shape ────────────────────────────────────────────────
--
-- One row per draft, keyed on a client-minted UUID kept in the applicant's browser. Not
-- keyed on email: the email field is itself something they type part-way through, and
-- keying on it would create a new row on every keystroke of it.
--
-- `payload` is the whole form state as JSONB rather than a column per field. A draft is a
-- snapshot for a human to read, not something we query by field — and mirroring eighteen
-- columns here would mean changing this table every time the form changes.
--
-- Run in: Supabase Dashboard > SQL Editor (after 042)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.contractor_application_drafts (
  -- Minted in the browser. The applicant is anonymous, so this id IS the credential
  -- that lets them keep writing to their own row — same reasoning as the unguessable
  -- storage paths in 026.
  id           UUID PRIMARY KEY,

  -- Lifted out of the payload purely so a human can scan the list. Nullable, because
  -- someone may type their name and abandon before reaching the email field.
  full_name    TEXT,
  email        TEXT,
  phone        TEXT,
  role         TEXT,

  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- How far they got, 0-100. Cheap way to sort "nearly finished" above "typed one word".
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),

  -- Set when the same draft id reaches submitContractorApplication, so the follow-up
  -- list can exclude people who actually finished.
  submitted_application_id UUID REFERENCES public.contractor_applications(id) ON DELETE SET NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contractor_drafts_updated_idx
  ON public.contractor_application_drafts (updated_at DESC);

-- The follow-up list: started, never finished.
CREATE INDEX IF NOT EXISTS contractor_drafts_unsubmitted_idx
  ON public.contractor_application_drafts (updated_at DESC)
  WHERE submitted_application_id IS NULL;

ALTER TABLE public.contractor_application_drafts ENABLE ROW LEVEL SECURITY;

-- ── Write: anonymous, like the form itself ───────────────
--
-- INSERT and UPDATE are open to anon because the applicant has no account. The id is an
-- unguessable UUID held only in their browser, which is what stops one person writing
-- over another's draft.
--
-- SELECT is NOT granted. These rows hold names, phone numbers and emails; nobody but an
-- admin reads them back. That also means the client must never call `.select()` on a
-- write — PostgREST would re-read the row under RLS and fail with 42501, which is the
-- exact trap documented in contractor-applications.ts.
DROP POLICY IF EXISTS "anyone_can_draft"        ON public.contractor_application_drafts;
DROP POLICY IF EXISTS "anyone_can_update_draft" ON public.contractor_application_drafts;
DROP POLICY IF EXISTS "admins_read_drafts"      ON public.contractor_application_drafts;
DROP POLICY IF EXISTS "admins_delete_drafts"    ON public.contractor_application_drafts;

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

COMMENT ON TABLE public.contractor_application_drafts IS
  'In-progress contractor applications, saved before Submit. The form tells applicants '
  'their progress is saved — that disclosure is what makes this collection consented. '
  'Rows with submitted_application_id IS NULL are the abandoned ones.';
