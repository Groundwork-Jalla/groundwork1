-- =========================================================
-- 052_resume_contractor_draft.sql
--
-- Let an applicant come back and carry on.
--
-- 043 saves a draft on every keystroke and keeps the id in the applicant's localStorage,
-- and the form has always told them:
--
--     "Your answers are saved as you go, so you can close this page and finish later."
--
-- That has never been true. Drafts were write-only: `admins_read_drafts` is the sole
-- SELECT policy, so the anonymous applicant who wrote the row cannot read it back. Every
-- one of them started again from an empty form, having been told they would not have to.
--
-- The cost of that rose sharply when the form became eight steps: somebody who answers
-- seven screens, closes the tab to go and find a reference's phone number, and comes back
-- now loses all seven.
--
-- ── Why a function rather than a SELECT policy ───────────────────────────────────────
-- A policy permissive enough for an anonymous applicant to read their own row is a policy
-- that has to express "knows the id" — and RLS cannot see what the caller knows, only
-- what they are. So the id is passed as an argument to a SECURITY DEFINER function
-- instead, which makes the credential explicit at the call site and lets the row be
-- filtered on more than identity.
--
-- ── The security model, which 043 already chose ──────────────────────────────────────
-- 043 states it plainly: "this id IS the credential that lets them keep writing to their
-- own row — same reasoning as the unguessable storage paths in 026." A random v4 UUID is
-- 122 bits and lives only in that person's browser. Reading by the same credential that
-- already permits writing does not widen the surface; it is the same door.
--
-- Two conditions narrow it further, and both matter:
--   * submitted drafts return nothing, so a finished application cannot be replayed into
--     a fresh form;
--   * drafts stop resuming after 30 days, which bounds how long a leaked id is worth
--     anything and stops someone resuming a form whose questions have since changed.
-- =========================================================

CREATE OR REPLACE FUNCTION public.get_contractor_draft(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.payload
  FROM public.contractor_application_drafts d
  WHERE d.id = p_id
    AND d.submitted_application_id IS NULL
    AND d.updated_at > now() - interval '30 days';
$$;

-- Anonymous by necessity: the applicant has no account. The uuid argument is the gate.
REVOKE ALL ON FUNCTION public.get_contractor_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contractor_draft(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_contractor_draft(uuid) IS
  'Returns an unsubmitted contractor draft payload by its id, for resuming the form. '
  'SECURITY DEFINER because the applicant is anonymous and cannot SELECT the table; the '
  'unguessable id is the credential, exactly as it already is for writing. Submitted and '
  'drafts older than 30 days return NULL.';
