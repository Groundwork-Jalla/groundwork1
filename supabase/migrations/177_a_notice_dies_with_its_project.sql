-- A notification about a deleted project goes with it.
--
-- ── WHAT IS WRONG ───────────────────────────────────────────────────────────────────
--
-- `notifications.data` carries `project_id` as JSON (009), which is not a reference —
-- so nothing happens to the notice when the project is deleted. Production:
--
--     362 notifications, 353 name a project, 247 of those name one that no longer
--     exists. Seventy per cent.
--
-- Reported 7 Nov 2026 by Favour, on the account `asia@mailinator.com`: the bell shows
-- "Your project is now being tracked — Jalla has set up 'hgfd' from stage 5" twice,
-- while My Projects reads "0 builds in total". Both screens are telling the truth.
-- `hgfd` and `vghbn` were test projects, since deleted; their notices were not, because
-- nothing connected the two. The account owns nothing, follows nothing, and is being
-- told about two builds.
--
-- That is worse than a stale row. The bell is the one surface that is supposed to mean
-- "something happened that concerns you", and a notice you cannot act on, about a thing
-- that is not there, teaches people to stop reading it.
--
-- ── THE FIX: A REAL REFERENCE, STAMPED AUTOMATICALLY ───────────────────────────────
--
-- A `project_id` column with ON DELETE CASCADE, so the database removes the notice when
-- the project goes and nobody has to remember.
--
-- It is filled by a trigger rather than by editing every caller. Notifications are
-- written from at least seven places — 013's two helpers, 074, 076, 097/123, 130 — and
-- a column each of them must remember to set is a column most of them will eventually
-- forget. The trigger reads the `project_id` that is ALREADY in `data` at every one of
-- those call sites, so every existing path gets this for free and so does the next one.
--
-- ── WHY THE TRIGGER CHECKS THE PROJECT EXISTS ──────────────────────────────────────
--
-- A foreign key refuses an id that does not resolve, which would turn "the CRM mentions
-- a project that was just deleted" from a stale row into a FAILED NOTIFICATION — and
-- several of these call sites are triggers inside the transaction that does the real
-- work. A notice that cannot be written must never be able to abort a stage approval.
--
-- So the id is stamped only when it resolves. An unresolvable one is left NULL and the
-- notice is still delivered, exactly as today, carrying its JSON as before.
--
-- Run in: Supabase Dashboard > SQL Editor (after 176)

BEGIN;

-- ── 1. The reference ───────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.notifications.project_id IS
  'The project this notice is about, stamped from data->>project_id on insert (177). '
  'ON DELETE CASCADE: deleting a project takes its notices with it. NULL means the '
  'notice is not about a project, or named one that did not resolve.';

CREATE INDEX IF NOT EXISTS notifications_project
  ON public.notifications (project_id) WHERE project_id IS NOT NULL;

-- ── 2. Stamped on the way in ───────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_notification_project()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_raw  text := NEW.data ->> 'project_id';
  v_uuid uuid;
BEGIN
  IF NEW.project_id IS NOT NULL OR v_raw IS NULL OR v_raw = '' THEN
    RETURN NEW;
  END IF;

  -- Malformed ids are data, not a reason to lose the notification.
  BEGIN
    v_uuid := v_raw::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NEW;
  END;

  -- Only when it resolves. See the header: the foreign key would otherwise refuse the
  -- insert, and several callers are triggers running inside the transaction that does
  -- the real work — a notice that cannot be written must not abort a stage approval.
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v_uuid) THEN
    NEW.project_id := v_uuid;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamp_notification_project ON public.notifications;
CREATE TRIGGER stamp_notification_project
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.stamp_notification_project();

COMMENT ON FUNCTION public.stamp_notification_project() IS
  'Fills notifications.project_id from the data JSON every caller already sets (177), '
  'so no notify path has to remember a new column. Skips an id that does not resolve, '
  'because a foreign key failure here would abort the caller''s own transaction.';

-- ── 3. Everything already in the bell ──────────────────────
UPDATE public.notifications n
   SET project_id = (n.data ->> 'project_id')::uuid
 WHERE n.project_id IS NULL
   AND n.data ->> 'project_id' IS NOT NULL
   AND n.data ->> 'project_id' <> ''
   -- `~*` first: a non-uuid string would raise on the cast and take the whole
   -- statement with it, and this column has only ever been free JSON.
   AND n.data ->> 'project_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = (n.data ->> 'project_id')::uuid);

-- ── 4. The 247 already orphaned ────────────────────────────
/*
 * These could not be linked above, because the project they name is gone. They are
 * what the account in the report is looking at, and the cascade cannot reach backwards
 * to collect them — the delete that should have taken them has already happened.
 *
 * Narrow on purpose: a notice is removed only if it NAMES a project and that project
 * is absent. Anything with no project_id in its data is left alone, whatever it is.
 */
DELETE FROM public.notifications n
 WHERE n.project_id IS NULL
   AND n.data ->> 'project_id' IS NOT NULL
   AND n.data ->> 'project_id' <> ''
   AND n.data ->> 'project_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = (n.data ->> 'project_id')::uuid);

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- no notice should name a project that is not there
--   SELECT count(*) FROM public.notifications n
--    WHERE n.data ->> 'project_id' IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.projects p
--                       WHERE p.id::text = n.data ->> 'project_id');
--   -- expect: 0
--
--   -- and the live ones are linked
--   SELECT count(*) FILTER (WHERE project_id IS NOT NULL) AS linked, count(*) AS total
--     FROM public.notifications;
