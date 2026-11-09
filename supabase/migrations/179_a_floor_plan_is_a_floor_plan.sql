-- A floor plan is filed as a floor plan, so "qualified" can be computed at all.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────
--
-- Philip's memo, 9 Nov 2026, states the shared definition the whole team reports on:
--
--   "Qualified Projects are those that are already ongoing or starting within 60 days,
--    and the contractor has uploaded their bill of quantities AND FLOOR PLAN."
--
-- The platform cannot answer that last clause. `project_documents.category` has
-- allowed contract / permit / receipt / invoice / report / site_photo / boq / other
-- since 096, and nothing for a drawing — so `plan-answer.ts` files every floor plan
-- the wizard collects as `other`. Production: 8 `boq`, 11 `other`, 1 `contract`. The
-- eleven are mostly plans, and nothing distinguishes them from a random attachment.
--
-- `hasArchitecturePlan` does not help either. The wizard asks it, routes on it, and
-- never writes it anywhere — it exists only for the length of the session.
--
-- So the definition in the memo is currently uncomputable, and 169 quietly implements
-- a different one (BOQ + a start date) because that is all the data supports.
--
-- ── WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────────
--
-- It adds the category and nothing else. From here a plan uploaded through the wizard
-- is identifiable, which is what any version of the rule needs first.
--
-- It does NOT change `project_business_status`. Tightening the rule would move the
-- number the team reports on mid-week, and that number is already disputed — see
-- below. The rule change waits for Philip.
--
-- It does NOT guess at the existing eleven. A filename is not evidence, and promoting
-- an attachment to a floor plan would be inventing the very fact this migration exists
-- to start recording honestly. They stay `other`; projects created from here on are
-- measurable, and the backfill can be done by hand against real files if anyone wants
-- the history.
--
-- ── A DISCREPANCY WORTH RECORDING HERE ─────────────────────────────────────────────
--
-- Checked 9 Nov 2026. The memo names three qualified projects: Edgar, Fidelis, Olivia.
-- `project_business_status` returns three as well — EMECHEBE CLINTON, Eta Rapheal
-- Bissong, Chimewah Joseph. The count matches; not one of the projects does, and no
-- profile named Olivia exists. The reported figure is being kept by hand somewhere
-- other than this database, and the two have never agreed.
--
-- Run in: Supabase Dashboard > SQL Editor (after 178)

BEGIN;

ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_category_check;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_category_check
  CHECK (category IN ('contract', 'permit', 'receipt', 'invoice', 'report',
                      'site_photo', 'boq', 'floor_plan', 'other'));

COMMENT ON COLUMN public.project_documents.category IS
  'What the document is. `boq` since 096, `floor_plan` since 179 — the two the '
  'qualified definition depends on. Before 179 a plan was filed as `other`, so a '
  'project created earlier cannot be asked whether it has one.';

-- Finding one is the only query this is for, and the set stays small.
CREATE INDEX IF NOT EXISTS project_documents_plans
  ON public.project_documents (project_id)
  WHERE category = 'floor_plan';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- the category is accepted
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'project_documents_category_check';
--
--   -- what is on file, before and after projects start using it
--   SELECT category, count(*) FROM public.project_documents GROUP BY 1 ORDER BY 2 DESC;
--
--   -- and the gap the memo's rule would hit today: BOQ but no identifiable plan
--   SELECT p.name FROM public.projects p
--    WHERE EXISTS (SELECT 1 FROM public.project_documents d
--                   WHERE d.project_id = p.id AND d.category = 'boq')
--      AND NOT EXISTS (SELECT 1 FROM public.project_documents d
--                       WHERE d.project_id = p.id AND d.category = 'floor_plan');
