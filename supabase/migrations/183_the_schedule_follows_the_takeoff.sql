-- =========================================================
-- 183  A stage's share is this building's, so it needs decimals
--
-- ── WHAT PHILIP SAW, 9 NOV 2026 ────────────────────────────────────────────────────
--
-- Reading a live project's costing down the screen with its owner: the platform
-- "incorrectly distributes funds starting from stage five onwards", and should "stick to
-- the exact amounts allocated to specific stages". The fix he asked for was that the
-- distribution "flow to previous stages rather than only building from current stages
-- upward".
--
-- ── WHY IT HAPPENED ────────────────────────────────────────────────────────────────
--
-- Every project got ONE list of percentages — 2 / 8 / 30 / 8 / 17 / 30 / 5, from
-- `stage-seeds.ts` — applied to its construction fee. A good national average, and not
-- any particular building. The take-off had already priced the building section by
-- section and nothing read that back out.
--
-- Measured against the four Cameroonian bills of quantities the engine is calibrated on.
-- Buea Residence, $86,339 of construction:
--
--     stage                  flat model   its own take-off
--     foundation                 $6,907            $13,125   paid HALF
--     structure & walls         $25,902            $44,039   paid 59%
--     electrical & plumbing     $14,678             $7,203   paid DOUBLE
--     finishing                 $25,902            $14,011   paid 85% over
--
-- Back-loaded exactly as described: money belonging to the foundation and the frame is
-- held back and released later, against work that costs less than the schedule claims.
--
-- ── WHAT THIS MIGRATION CHANGES ────────────────────────────────────────────────────
--
-- One column type. `budget_pct` has been INTEGER since 003, when every project shared
-- the same whole-number split. A share read off a real take-off is 48.456%, not 48%, and
-- on a 2,300,000,000 XAF build the truncated half-percent is about 10 million francs
-- landing on the wrong stage. The whole correction is computed in TypeScript and written
-- through the existing `apply_budget_milestones`, which already derives every milestone
-- from this column — so widening it is the only thing SQL has to do.
--
-- Nothing is recomputed here. Existing projects keep the integers they have: their
-- schedule was agreed with a contractor and a client, and silently re-cutting a live
-- payment plan under them is not a migration's business. New projects get their own
-- split. A live project that needs re-cutting goes through a re-price, where somebody
-- sees the new figures before they are committed to.
--
-- Widening INTEGER to NUMERIC rewrites the table. `project_stages` is small — ten rows
-- per project — and the statement takes an ACCESS EXCLUSIVE lock for the rewrite, which
-- at this size is milliseconds. No default, no constraint and no index is dropped.
-- =========================================================

ALTER TABLE public.project_stages
  ALTER COLUMN budget_pct TYPE numeric(9,6);

COMMENT ON COLUMN public.project_stages.budget_pct IS
  'This stage''s share of the CONSTRUCTION fee, as a percentage. Derived per project '
  'from its own take-off sections (183) and no longer a fixed national average; a '
  'project with no take-off still carries the seed percentages. Six decimal places '
  'because the share is a ratio of priced work, not a round number. Milestones are '
  'derived from it by apply_budget_milestones (036/072) — never written directly.';
