-- =========================================================
-- 048_application_acknowledged.sql
--
-- Record when an applicant was told we received their application.
--
-- The acknowledgement is sent automatically at submission, but between the 20 August
-- meeting and 21 August 11:32 it was reaching nobody: api/contractor-application-notify
-- crashed before sending, and the browser discarded the error, so applicants saw
-- "submitted" and heard nothing. Those people are still waiting.
--
-- The fix ships an admin button that sends the acknowledgement by hand. That only works
-- as a recovery tool if you can see who still needs one — without this column there is
-- no way to tell an applicant who was emailed from one who was not, and the person
-- working through the backlog either double-sends or skips someone.
--
-- Deliberately a timestamp, not a boolean: "when" answers "did the automatic send work
-- for this row" as well as "have we caught up on the backlog", and a boolean answers
-- neither. NULL means never acknowledged.
--
-- Backfilling is not possible. Resend accepted every one of those sends before the
-- handler died, so nothing on our side knows which addresses were actually reached —
-- every pre-fix row is NULL and must be judged by its created_at.
--
-- Run in: Supabase Dashboard > SQL Editor (after migration 047)
-- =========================================================

ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

COMMENT ON COLUMN public.contractor_applications.acknowledged_at IS
  'When the applicant was last sent the "we received your application" email. NULL means '
  'never — either the send failed or the row predates the fix. Set by '
  'api/send-application-acknowledgement.ts and by the automatic send at submission.';

-- Finding the backlog is the whole point, so make that query cheap.
CREATE INDEX IF NOT EXISTS contractor_applications_unacknowledged_idx
  ON public.contractor_applications (created_at DESC)
  WHERE acknowledged_at IS NULL;

-- Who is still owed an email:
--   SELECT id, full_name, email, created_at
--     FROM public.contractor_applications
--    WHERE acknowledged_at IS NULL
--    ORDER BY created_at;
