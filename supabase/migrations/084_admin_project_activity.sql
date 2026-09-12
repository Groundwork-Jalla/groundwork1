-- =========================================================
-- 084  When did anything last happen on each project?
--
-- The /admin overview scores every project's health, and the loudest signal is silence:
-- a build with no evidence, no review, no message and no audit entry for a fortnight is
-- the one nobody is watching. `projects.updated_at` alone cannot say that — it moves on
-- any row write and stays still through a month of chat.
--
-- The honest sources are four tables, and the browser could read all of them: admins
-- have SELECT on substages, documents, messages and the audit log (009). But "the latest
-- message per project" from the client means fetching every message row for every
-- project and reducing in JavaScript — thousands of rows to learn forty timestamps, on
-- every open of the overview. One GROUP BY per source, joined, is the shape this wants.
--
-- Read-only. SECURITY DEFINER only so it is one grant rather than four, and gated on
-- is_admin() like every other admin_* function.
--
-- The overview degrades without it: if this has not been applied, the page still renders
-- with `updated_at` as the only signal and says so, rather than showing nothing.
--
-- Run in: Supabase Dashboard > SQL Editor (after 083)
-- =========================================================

DROP FUNCTION IF EXISTS public.admin_project_activity();

CREATE FUNCTION public.admin_project_activity()
RETURNS TABLE (
  project_id       uuid,
  -- Substage completed or approved, or a document uploaded — proof arriving.
  last_evidence_at timestamptz,
  -- A stage submitted, approved, or sent back — the review conversation moving.
  last_review_at   timestamptz,
  last_message_at  timestamptz,
  -- Anything at all in the audit log, whatever it was.
  last_audit_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ev AS (
    SELECT s.project_id, max(GREATEST(s.completed_at, s.approved_at)) AS at
      FROM public.project_substages s
     WHERE s.completed_at IS NOT NULL OR s.approved_at IS NOT NULL
     GROUP BY s.project_id
  ),
  docs AS (
    SELECT d.project_id, max(d.created_at) AS at
      FROM public.project_documents d
     GROUP BY d.project_id
  ),
  rev AS (
    SELECT a.project_id, max(a.created_at) AS at
      FROM public.project_audit_log a
     WHERE a.action IN ('stage_submitted_for_review', 'stage_approved',
                        'stage_approved_by_admin', 'rework_requested')
     GROUP BY a.project_id
  ),
  msg AS (
    SELECT m.project_id, max(m.created_at) AS at
      FROM public.project_messages m
     GROUP BY m.project_id
  ),
  aud AS (
    SELECT a.project_id, max(a.created_at) AS at
      FROM public.project_audit_log a
     GROUP BY a.project_id
  )
  SELECT
    p.id,
    GREATEST(ev.at, docs.at) AS last_evidence_at,
    rev.at                   AS last_review_at,
    msg.at                   AS last_message_at,
    aud.at                   AS last_audit_at
  FROM public.projects p
  LEFT JOIN ev   ON ev.project_id   = p.id
  LEFT JOIN docs ON docs.project_id = p.id
  LEFT JOIN rev  ON rev.project_id  = p.id
  LEFT JOIN msg  ON msg.project_id  = p.id
  LEFT JOIN aud  ON aud.project_id  = p.id
  WHERE public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.admin_project_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_project_activity() TO authenticated;

COMMENT ON FUNCTION public.admin_project_activity() IS
  'Latest evidence / review / message / audit timestamp per project, for the admin '
  'overview health score. Admin only; returns nothing to anyone else.';

-- ── Verify ───────────────────────────────────────────────
-- One row per project when run as an admin; zero rows otherwise.
SELECT count(*) AS projects_with_activity FROM public.admin_project_activity();
