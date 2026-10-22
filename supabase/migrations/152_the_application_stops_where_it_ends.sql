-- =========================================================
-- 152 — The application records where it ended, and why
--
-- Philip's walkthrough: the form runs as steps, and "if a question that they answer
-- disqualifies them then they should not see the remaining steps. The application gets
-- discontinued for them."
--
-- Two of his questions stopped being yes/no, which is the substance of this migration:
--
--   "Do you have an active project?"  →  already running | about to start | no
--        running  → which stage is it in
--        starting → when does it start
--        no       → the application ends here
--
--   "Can the client be on site daily?" →  yes ends it; no asks why not
--
-- ── The one that reads backwards ────────────────────────────────────────────────────
-- A client who CAN be on site every day disqualifies the application. That is not a
-- mistake: Groundwork exists for the client who cannot stand on the slab, and somebody
-- who can is supervising in person already. Philip was explicit that this is not only
-- about the diaspora — a client in the same country and a different region needs us
-- exactly as much — so the follow-up asks why they cannot come, with an Other.
--
-- ── Why the sub-answers are constrained ─────────────────────────────────────────────
-- A stage recorded against a project that has not started, or a start date against one
-- already running, is a contradiction the form cannot produce but a hand-written UPDATE
-- can. The CHECK makes the parent/sub relationship Philip described a property of the
-- table rather than a property of one screen.
--
-- Run in: Supabase Dashboard > SQL Editor (after 151)
-- =========================================================

BEGIN;

ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS project_status              TEXT,
  ADD COLUMN IF NOT EXISTS project_stage               TEXT,
  ADD COLUMN IF NOT EXISTS project_start_window        TEXT,
  ADD COLUMN IF NOT EXISTS client_on_site_daily        BOOLEAN,
  ADD COLUMN IF NOT EXISTS client_offsite_reason       TEXT,
  ADD COLUMN IF NOT EXISTS client_offsite_reason_other TEXT,
  ADD COLUMN IF NOT EXISTS will_use_groundwork         TEXT,
  ADD COLUMN IF NOT EXISTS disqualified_reason         TEXT;

COMMENT ON COLUMN public.contractor_applications.project_status IS
  'running | starting | none (152). ''none'' ends the application.';
COMMENT ON COLUMN public.contractor_applications.project_stage IS
  'Which stage the running project is in — asked only when project_status = running.';
COMMENT ON COLUMN public.contractor_applications.project_start_window IS
  'When the project starts — asked only when project_status = starting.';
COMMENT ON COLUMN public.contractor_applications.client_on_site_daily IS
  'TRUE ends the application (152): a client who can be on site daily is supervising in '
  'person and does not need Groundwork. Not a diaspora test — a client in the same '
  'country and another region qualifies.';
COMMENT ON COLUMN public.contractor_applications.will_use_groundwork IS
  'yes | maybe | no (152). "Maybe, I need to understand the system better" is a request '
  'for the demo, which is what the call is for. Only an outright no ends it.';
COMMENT ON COLUMN public.contractor_applications.disqualified_reason IS
  'Which rule ended it (152), so the funnel shows WHERE people are lost rather than '
  'only how many. Null on an application that was never disqualified.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_applications_project_status') THEN
    ALTER TABLE public.contractor_applications
      ADD CONSTRAINT contractor_applications_project_status
      CHECK (project_status IS NULL OR project_status IN ('running', 'starting', 'none'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_applications_groundwork_use') THEN
    ALTER TABLE public.contractor_applications
      ADD CONSTRAINT contractor_applications_groundwork_use
      CHECK (will_use_groundwork IS NULL
             OR will_use_groundwork IN ('yes', 'maybe', 'no'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_applications_disqualified_reason') THEN
    ALTER TABLE public.contractor_applications
      ADD CONSTRAINT contractor_applications_disqualified_reason
      -- Three, and only three. The form document is explicit that years of experience
      -- does not disqualify: it ranks an applicant in the directory instead.
      CHECK (disqualified_reason IS NULL OR disqualified_reason IN (
        'no_project', 'client_on_site_daily', 'not_using_groundwork'));
  END IF;

  -- The parent/sub relationship, as a property of the table.
  --
  -- Written to allow NULL on both sides so a half-finished draft and every application
  -- filed before today still satisfy it: this forbids the contradiction, it does not
  -- demand the answer.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_applications_project_detail_matches') THEN
    ALTER TABLE public.contractor_applications
      ADD CONSTRAINT contractor_applications_project_detail_matches
      CHECK (
            (project_stage        IS NULL OR project_status = 'running')
        AND (project_start_window IS NULL OR project_status = 'starting')
      );
  END IF;

  -- A reason for being off site only means anything when they are off site.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_applications_offsite_reason_matches') THEN
    ALTER TABLE public.contractor_applications
      ADD CONSTRAINT contractor_applications_offsite_reason_matches
      CHECK (client_offsite_reason IS NULL OR client_on_site_daily IS DISTINCT FROM true);
  END IF;
END $$;

-- Where the funnel loses people, not just how many. Partial: almost every row is NULL.
CREATE INDEX IF NOT EXISTS contractor_applications_disqualified
  ON public.contractor_applications (disqualified_reason)
  WHERE disqualified_reason IS NOT NULL;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   A contradiction is refused:
--     UPDATE public.contractor_applications
--        SET project_status = 'starting', project_stage = 'foundation' WHERE id = '<id>';
--     → violates contractor_applications_project_detail_matches
--   And where applications end:
--     SELECT disqualified_reason, count(*) FROM public.contractor_applications
--      WHERE source = 'in_app' GROUP BY 1 ORDER BY 2 DESC;
