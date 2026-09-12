-- =========================================================
-- 085  A replayed GoHighLevel webhook must not become a second message
--
-- Phase 4 of the admin re-architecture (docs/groundwork-admin/04-implementation-plan.md),
-- migration R1. Standalone: nothing depends on it, and the Unified Inbox depends on it.
--
-- WHAT WAS WRONG. `conversation-delivery.ts` files a GHL reply into `project_messages`
-- with a plain INSERT. It stamps `ghl_message_id`, but 077 put only a partial index on
-- that column for the *unmirrored* lookup — nothing unique. So the same GHL event
-- delivered twice — a retry, a redeploy mid-request, GHL's own at-least-once semantics —
-- produced two identical rows, and the client got two "You have a new message" emails
-- for one message. Groundwork → GHL was already idempotent (`ghl_outbox.dedupe_key`
-- UNIQUE, 050); this is the other direction.
--
-- WHY A PLAIN UNIQUE INDEX AND NOT A PARTIAL ONE. The obvious index is
-- `UNIQUE (ghl_message_id) WHERE ghl_message_id IS NOT NULL`, since platform messages
-- carry NULL. It does not work with the client: supabase-js `.upsert(row, { onConflict:
-- 'ghl_message_id', ignoreDuplicates: true })` makes PostgREST emit
-- `INSERT … ON CONFLICT (ghl_message_id) DO NOTHING` — no predicate — and Postgres
-- refuses to match that against a partial index ("there is no unique or exclusion
-- constraint matching the ON CONFLICT specification"). Proven on a local PostgreSQL 16
-- before this was written. A plain unique index matches the clause, and because Postgres
-- treats NULLs as distinct, any number of NULL-id platform messages still coexist.
--
-- Existing duplicates are removed first, keeping the earliest row per id, or the index
-- cannot be created. The count removed is raised as a NOTICE so the SQL editor shows it.
--
-- Run in: Supabase Dashboard > SQL Editor (after 084)
-- =========================================================

-- ── 1. Remove duplicates that already exist ──────────────
DO $$
DECLARE
  removed integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY ghl_message_id ORDER BY created_at, id) AS rn
      FROM public.project_messages
     WHERE ghl_message_id IS NOT NULL
  ),
  gone AS (
    DELETE FROM public.project_messages
     WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING id
  )
  SELECT count(*) INTO removed FROM gone;

  RAISE NOTICE '085: removed % duplicate GHL message row(s)', removed;
END $$;

-- ── 2. One row per GHL message, enforced ─────────────────
CREATE UNIQUE INDEX IF NOT EXISTS project_messages_ghl_message_id_key
  ON public.project_messages (ghl_message_id);

COMMENT ON INDEX public.project_messages_ghl_message_id_key IS
  'Inbound idempotency: a GHL message id files once. Plain (not partial) on purpose — '
  'PostgREST''s ON CONFLICT cannot target a partial index. NULLs are distinct, so '
  'platform messages are unaffected. See 085.';

-- ── Verify ───────────────────────────────────────────────
-- Zero rows: no id appears twice.
SELECT ghl_message_id, count(*)
  FROM public.project_messages
 WHERE ghl_message_id IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;
