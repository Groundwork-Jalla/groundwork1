-- =========================================================
-- Link existing profiles to their GoHighLevel contact — Source 1: Groundwork's own evidence
--
-- Phase 6 linkage task (docs/groundwork-admin/06-unified-inbox.md §17). NOT a migration:
-- run by hand in the Supabase SQL editor, as many times as you like. Re-running after
-- success writes zero rows.
--
-- EVIDENCE. `ghl_outbox` rows that were SENT through the API carry the contact id GHL
-- answered with. Identity is established per event type, from Groundwork-owned data:
--   user_signup      payload.user_id                       → profiles.id
--   project_created  payload.project_id → projects.user_id → profiles.id
--                    (never payload.user_id: until 22 Sep 2026 crm-project wrote the
--                     CALLER's id there, which for admin-created projects is the admin)
-- and, for both, lower(outbox.email) must equal lower(profile.email) — evidence about a
-- different address is not evidence about this profile. Any other event type is ignored.
--
-- DECISIONS, per profile with ghl_contact_id IS NULL:
--   eligible   exactly one distinct contact id across its evidence   → written
--   conflict   more than one distinct contact id                     → reported, never written
--   mismatch   evidence exists but its email is not the profile's    → reported, never written
--   orphan     evidence whose project/profile no longer resolves     → counted, never written
-- Profiles already linked are outside the population entirely.
--
-- THE SAME CTE DRIVES THE REPORT AND THE APPLY. Run part A to review; part B applies
-- exactly what part A called `eligible`, guarded again by `ghl_contact_id IS NULL` at
-- write time, and returns every row it changed. Keep that RETURNING output: it is the
-- rollback list (UPDATE profiles SET ghl_contact_id = NULL WHERE id = … AND ghl_contact_id = …).
-- =========================================================

-- ─── A. REPORT ──────────────────────────────────────────────────────────────────────
WITH evidence AS (
  -- user_signup: the outbox row names the person directly.
  SELECT o.id AS outbox_id, o.event, o.contact_id, lower(o.email) AS outbox_email,
         p.id AS profile_id, lower(p.email) AS profile_email
    FROM public.ghl_outbox o
    LEFT JOIN public.profiles p
      ON p.id::text = o.payload->>'user_id'
   WHERE o.event = 'user_signup' AND o.status = 'sent' AND o.contact_id IS NOT NULL
     AND o.payload->>'user_id' ~* '^[0-9a-f-]{36}$'
  UNION ALL
  -- project_created: the outbox row names the project; the project names its owner.
  SELECT o.id, o.event, o.contact_id, lower(o.email),
         p.id, lower(p.email)
    FROM public.ghl_outbox o
    LEFT JOIN public.projects pr ON pr.id::text = o.payload->>'project_id'
    LEFT JOIN public.profiles p  ON p.id = pr.user_id
   WHERE o.event = 'project_created' AND o.status = 'sent' AND o.contact_id IS NOT NULL
     AND o.payload->>'project_id' ~* '^[0-9a-f-]{36}$'
),
judged AS (
  SELECT e.*,
         CASE WHEN e.profile_id IS NULL THEN 'orphan'
              WHEN e.outbox_email IS DISTINCT FROM e.profile_email THEN 'mismatch'
              ELSE 'consistent' END AS evidence_state
    FROM evidence e
),
per_profile AS (
  SELECT j.profile_id,
         count(DISTINCT j.contact_id) FILTER (WHERE j.evidence_state = 'consistent') AS consistent_ids,
         min(j.contact_id)           FILTER (WHERE j.evidence_state = 'consistent') AS contact_id,
         count(*)                    FILTER (WHERE j.evidence_state = 'mismatch')   AS mismatched_rows,
         array_agg(DISTINCT j.contact_id) AS all_contact_ids
    FROM judged j
   WHERE j.profile_id IS NOT NULL
   GROUP BY j.profile_id
),
decisions AS (
  SELECT pp.profile_id, p.email, pp.all_contact_ids, pp.contact_id,
         CASE WHEN p.ghl_contact_id IS NOT NULL       THEN 'already_linked'
              WHEN pp.consistent_ids = 1              THEN 'eligible'
              WHEN pp.consistent_ids > 1              THEN 'conflict'
              WHEN pp.mismatched_rows > 0             THEN 'mismatch'
              ELSE 'none' END AS decision
    FROM per_profile pp
    JOIN public.profiles p ON p.id = pp.profile_id
)
SELECT decision, count(*) AS profiles
  FROM decisions GROUP BY decision
UNION ALL
SELECT 'orphan_rows', count(*) FROM judged WHERE evidence_state = 'orphan'
ORDER BY 1;

-- To see the rows behind a decision, replace the final SELECT with e.g.:
--   SELECT * FROM decisions WHERE decision IN ('eligible','conflict','mismatch') ORDER BY decision, email;

-- ─── B. APPLY — identical CTE, then the guarded write ───────────────────────────────
WITH evidence AS (
  SELECT o.id AS outbox_id, o.event, o.contact_id, lower(o.email) AS outbox_email,
         p.id AS profile_id, lower(p.email) AS profile_email
    FROM public.ghl_outbox o
    LEFT JOIN public.profiles p ON p.id::text = o.payload->>'user_id'
   WHERE o.event = 'user_signup' AND o.status = 'sent' AND o.contact_id IS NOT NULL
     AND o.payload->>'user_id' ~* '^[0-9a-f-]{36}$'
  UNION ALL
  SELECT o.id, o.event, o.contact_id, lower(o.email), p.id, lower(p.email)
    FROM public.ghl_outbox o
    LEFT JOIN public.projects pr ON pr.id::text = o.payload->>'project_id'
    LEFT JOIN public.profiles p  ON p.id = pr.user_id
   WHERE o.event = 'project_created' AND o.status = 'sent' AND o.contact_id IS NOT NULL
     AND o.payload->>'project_id' ~* '^[0-9a-f-]{36}$'
),
judged AS (
  SELECT e.*, CASE WHEN e.profile_id IS NULL THEN 'orphan'
                   WHEN e.outbox_email IS DISTINCT FROM e.profile_email THEN 'mismatch'
                   ELSE 'consistent' END AS evidence_state
    FROM evidence e
),
per_profile AS (
  SELECT j.profile_id,
         count(DISTINCT j.contact_id) FILTER (WHERE j.evidence_state = 'consistent') AS consistent_ids,
         min(j.contact_id)           FILTER (WHERE j.evidence_state = 'consistent') AS contact_id
    FROM judged j WHERE j.profile_id IS NOT NULL GROUP BY j.profile_id
),
eligible AS (
  SELECT pp.profile_id, pp.contact_id
    FROM per_profile pp JOIN public.profiles p ON p.id = pp.profile_id
   WHERE p.ghl_contact_id IS NULL AND pp.consistent_ids = 1
)
UPDATE public.profiles p
   SET ghl_contact_id = e.contact_id
  FROM eligible e
 WHERE p.id = e.profile_id
   AND p.ghl_contact_id IS NULL          -- the guard, again, at write time
RETURNING p.id AS profile_id, p.email, p.ghl_contact_id;
