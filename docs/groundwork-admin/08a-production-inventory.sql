-- =========================================================
-- Production inventory for the stage-tree decision (spec 08 §7)
--
-- READ-ONLY. No INSERT, UPDATE, DELETE, ALTER or CREATE anywhere in this file.
-- Run in: Supabase Dashboard > SQL Editor. Nothing here can change a row.
--
-- Purpose: decide MIGRATE vs GRANDFATHER for existing projects before Tree 1.
--
-- The three that decide it:
--   Q3   can we identify the rows safely?
--   Q8   has money already attached to affected stage history?
--   Q12  does the hardest one-to-many Foundation split carry real state or evidence?
--
-- ── How to read them ─────────────────────────────────────────────────────────────────
--
--   Q3 = 0 and Q8 = 0
--     Key-based UPDATE throughout. Cheapest case.
--
--   Q3 = 0, Q8 non-zero
--     Migration is viable, but no stage row may be deleted and reseeded: payments
--     reference project_stages.id.
--
--   Q3 non-zero
--     Those ROWS cannot be safely AUTO-remapped by key. That blocks automatic migration,
--     not every possible migration — grandfather OR an explicit/manual mapping is
--     required for them. It does not condemn the rows that do carry keys.
--
--   Q12 all locked, no evidence, no approver
--     The split carries no historical execution state, so a deterministic migration rule
--     MAY be safe. It still needs to be written and reviewed; this is not a licence to
--     decide the split informally.
--
--   Q12 any complete row, or any evidence or approver
--     The split carries real history. There is no honest generic transformation (spec 08
--     §10) — project-by-project mapping or grandfathering.
-- =========================================================

-- ── Q1 · Projects by current stage ────────────────────────
SELECT 'Q1 projects by stage' AS q, current_stage::text AS k, count(*)::text AS n
  FROM public.projects WHERE status <> 'archived'
 GROUP BY current_stage ORDER BY current_stage;

-- ── Q2 · Foundation reached, and its substage states ──────
SELECT 'Q2 foundation stage status' AS q, status AS k, count(*)::text AS n
  FROM public.project_stages WHERE stage_number = 4 GROUP BY status;

SELECT 'Q2b foundation substage states' AS q,
       COALESCE(sub.substage_key, '(NULL KEY)') AS k,
       sub.status || ' x' || count(*)::text     AS n
  FROM public.project_substages sub
  JOIN public.project_stages ps ON ps.id = sub.stage_id
 WHERE ps.stage_number = 4
 GROUP BY sub.substage_key, sub.status ORDER BY 2, 3;

-- ── Q3 · NULL keys — the migrate/grandfather decider ──────
-- Key-based remapping is impossible for any row answering > 0 here.
SELECT 'Q3 NULL keys' AS q, 'stages with NULL stage_key' AS k, count(*)::text AS n
  FROM public.project_stages WHERE stage_key IS NULL
UNION ALL SELECT 'Q3 NULL keys', 'substages with NULL substage_key', count(*)::text
  FROM public.project_substages WHERE substage_key IS NULL
UNION ALL SELECT 'Q3 NULL keys', 'projects holding any NULL-key substage', count(DISTINCT project_id)::text
  FROM public.project_substages WHERE substage_key IS NULL;

-- ── Q4 · Duplicate keys within one project ────────────────
-- A duplicate means a key does not uniquely identify an activity, so an UPDATE-by-key
-- migration would touch more than one row.
SELECT 'Q4 duplicate substage keys' AS q,
       project_id::text || ' / ' || substage_key AS k, count(*)::text AS n
  FROM public.project_substages
 WHERE substage_key IS NOT NULL
 GROUP BY project_id, substage_key HAVING count(*) > 1;

SELECT 'Q4b duplicate stage keys' AS q,
       project_id::text || ' / ' || stage_key AS k, count(*)::text AS n
  FROM public.project_stages
 WHERE stage_key IS NOT NULL
 GROUP BY project_id, stage_key HAVING count(*) > 1;

-- ── Q5 · Roofing and Electrical/Plumbing already underway ─
SELECT 'Q5 stage underway' AS q,
       CASE stage_number WHEN 6 THEN 'roofing' WHEN 7 THEN 'electrical+plumbing' END AS k,
       status || ' x' || count(*)::text AS n
  FROM public.project_stages
 WHERE stage_number IN (6, 7) AND status <> 'locked'
 GROUP BY stage_number, status;

SELECT 'Q5b stage 7 substages touched' AS q,
       COALESCE(sub.substage_key, '(NULL KEY)') AS k, sub.status || ' x' || count(*)::text AS n
  FROM public.project_substages sub
  JOIN public.project_stages ps ON ps.id = sub.stage_id
 WHERE ps.stage_number = 7 AND sub.status <> 'locked'
 GROUP BY sub.substage_key, sub.status;

-- ── Q6 · Finish level usage (premium/luxury removal) ──────
SELECT 'Q6 finish_level' AS q, finish_level AS k, count(*)::text AS n
  FROM public.projects GROUP BY finish_level;

-- ── Q7 · Roof type usage (variant selection point) ────────
SELECT 'Q7 roof_type' AS q, roof_type AS k, count(*)::text AS n
  FROM public.projects GROUP BY roof_type;

-- ── Q8 · Money tied to affected stages ────────────────────
-- The other decider. A payments row references project_stages.id; any migration that
-- deletes and reseeds a stage breaks it.
SELECT 'Q8 payments on affected stages' AS q,
       'stage ' || ps.stage_number::text || ' / ' || p.direction || ' / ' || p.state AS k,
       count(*)::text || '  total ' || COALESCE(sum(p.amount), 0)::text AS n
  FROM public.payments p
  JOIN public.project_stages ps ON ps.id = p.stage_id
 WHERE ps.stage_number IN (4, 5, 6, 7)
 GROUP BY ps.stage_number, p.direction, p.state ORDER BY 2;

-- ── Q9 · Verification history on affected stages ──────────
SELECT 'Q9 verifications on affected stages' AS q,
       'stage ' || ps.stage_number::text AS k, v.decision || ' x' || count(*)::text AS n
  FROM public.stage_verifications v
  JOIN public.project_stages ps ON ps.id = v.stage_id
 WHERE ps.stage_number IN (4, 5, 6, 7)
 GROUP BY ps.stage_number, v.decision;

-- ── Q10 · Evidence on affected substages ──────────────────
SELECT 'Q10 evidence on affected substages' AS q,
       'stage ' || ps.stage_number::text AS k,
       count(*)::text || ' substages, '
         || COALESCE(sum(jsonb_array_length(COALESCE(sub.evidence_urls, '[]'::jsonb))), 0)::text
         || ' files' AS n
  FROM public.project_substages sub
  JOIN public.project_stages ps ON ps.id = sub.stage_id
 WHERE ps.stage_number IN (4, 5, 6, 7)
   AND jsonb_array_length(COALESCE(sub.evidence_urls, '[]'::jsonb)) > 0
 GROUP BY ps.stage_number;

-- ── Q11 · Joined-mid-build population ─────────────────────
SELECT 'Q11 joined mid-build' AS q, 'projects with joined_at_stage' AS k, count(*)::text AS n
  FROM public.projects WHERE joined_at_stage IS NOT NULL
UNION ALL SELECT 'Q11 joined mid-build', 'pre_existing stages', count(*)::text
  FROM public.project_stages WHERE pre_existing
UNION ALL SELECT 'Q11 joined mid-build', 'pre_existing within stages 4-7', count(*)::text
  FROM public.project_stages WHERE pre_existing AND stage_number BETWEEN 4 AND 7;

-- ── Q12 · The hardest split: foundationPillarsBeams ───────
-- Does the one-to-many split carry real history, or is it theoretical?
-- Row-level on purpose: if these carry status or evidence there is no generic rule.
SELECT sub.project_id,
       sub.id,
       sub.substage_key,
       sub.name,
       sub.status,
       sub.completed_at,
       sub.approved_by,
       sub.approved_at,
       jsonb_array_length(COALESCE(sub.evidence_urls, '[]'::jsonb)) AS evidence_count
  FROM public.project_substages sub
  JOIN public.project_stages ps ON ps.id = sub.stage_id
 WHERE ps.stage_key = 'foundation'
   AND sub.substage_key = 'foundationPillarsBeams'
 ORDER BY sub.project_id;

-- Same question as a one-line summary, for when the row list is long.
SELECT 'Q12 summary' AS q, sub.status AS k,
       count(*)::text || ' rows, '
         || count(*) FILTER (WHERE sub.approved_by IS NOT NULL)::text || ' approved, '
         || COALESCE(sum(jsonb_array_length(COALESCE(sub.evidence_urls, '[]'::jsonb))), 0)::text
         || ' evidence files' AS n
  FROM public.project_substages sub
  JOIN public.project_stages ps ON ps.id = sub.stage_id
 WHERE ps.stage_key = 'foundation' AND sub.substage_key = 'foundationPillarsBeams'
 GROUP BY sub.status;
