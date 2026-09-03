-- =========================================================
-- 069_admin_delete_project.sql
--
-- Let an admin delete a single project.
--
-- Until now the only route by which a project row could disappear was
-- `admin_delete_user()` (035), which takes the entire account with it. That is far too
-- blunt for the case this actually exists for: a test project, a duplicate, a build
-- someone started twice, or a client asking support to remove one. Deleting their
-- account to remove one project is not a workaround — it is a second, larger accident.
--
-- OWNERS STILL CANNOT DELETE. 053 removed the owner DELETE policy so the free-plan cap
-- could stay a plain COUNT(*) over rows that never disappear. That is untouched: no
-- owner DELETE policy is added here, and this function is SECURITY DEFINER behind an
-- is_admin() gate. It is a staff action and nothing else.
--
-- ── WHAT THIS DOES TO THE FREE-PLAN CAP — read before using ─────────────────────────
-- Deleting a `self_verify` project DOES give the owner their slot back, because the cap
-- counts rows and this removes one. That is deliberate. The support case this is for is
-- "I created that by mistake and now I am stuck at three", and a delete that left them
-- stuck would not answer it. It does mean an admin can hand slots out, which is why it
-- is staff-only and why every deletion is recorded in the tombstone below.
--
-- If that is ever the wrong trade, the fix is one line: have
-- `check_starter_project_limit()` count `admin_deleted_projects` alongside `projects`.
--
-- ── STORAGE IS NOT IN THE FOREIGN-KEY GRAPH ─────────────────────────────────────────
-- Everything that references projects(id) is ON DELETE CASCADE, so stages, substages,
-- documents, messages, audit log, fees, take-offs and certificates all go on their own.
-- Uploaded FILES do not: nothing in storage.objects references projects, so a cascade
-- leaves every byte behind.
--
-- The paths naming those files live only in the rows about to be destroyed, so this
-- function collects them BEFORE the delete and returns them. The caller then removes
-- them through the Storage API, which is the only thing that frees the bytes. Deleting
-- the storage.objects rows here instead would make the files unreachable AND
-- unenumerable — orphaned forever and still billed.
--
-- Run in: Supabase Dashboard > SQL Editor (after 068)
-- =========================================================

-- ── Tombstone ────────────────────────────────────────────
--
-- The one irreversible destructive action in the product, performed by staff on someone
-- else's data. `project_audit_log` cannot record it — those rows cascade away with the
-- project they describe — so the record has to outlive the thing it is about.
--
-- `owner_id` deliberately carries NO foreign key. A tombstone that disappears when the
-- account is later deleted is not a tombstone.
CREATE TABLE IF NOT EXISTS public.admin_deleted_projects (
  project_id  uuid PRIMARY KEY,
  name        text NOT NULL,
  owner_id    uuid,
  owner_email text,
  tier        text,
  status      text,
  deleted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  /** What went with it — stages, substages, documents, messages, files. */
  counts      jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.admin_deleted_projects ENABLE ROW LEVEL SECURITY;

-- Read-only, admins only. No INSERT/UPDATE/DELETE policy exists on purpose: the
-- SECURITY DEFINER function below is the only writer, so a record cannot be edited or
-- quietly removed from the browser by the person who created it.
DROP POLICY IF EXISTS "admins_read_deleted_projects" ON public.admin_deleted_projects;
CREATE POLICY "admins_read_deleted_projects"
  ON public.admin_deleted_projects FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS admin_deleted_projects_deleted_at_idx
  ON public.admin_deleted_projects (deleted_at DESC);

-- ── Delete a project ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_delete_project(uuid);

CREATE FUNCTION public.admin_delete_project(p_project_id uuid)
RETURNS TABLE (
  name        text,
  owner_email text,
  tier        text,
  stages      integer,
  substages   integer,
  documents   integer,
  messages    integer,
  files       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_email   text;
  v_stages  integer;
  v_subs    integer;
  v_docs    integer;
  v_msgs    integer;
  v_files   jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may delete a project';
  END IF;

  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: no such project';
  END IF;

  SELECT u.email::text INTO v_email FROM auth.users u WHERE u.id = v_project.user_id;

  -- Counted before the delete, so the caller reports what actually went rather than
  -- what the table said a moment earlier.
  SELECT count(*)::integer INTO v_stages FROM public.project_stages    WHERE project_id = p_project_id;
  SELECT count(*)::integer INTO v_subs   FROM public.project_substages WHERE project_id = p_project_id;
  SELECT count(*)::integer INTO v_docs   FROM public.project_documents WHERE project_id = p_project_id;
  SELECT count(*)::integer INTO v_msgs   FROM public.project_messages  WHERE project_id = p_project_id;

  -- Every file this project owns, with the bucket it lives in. See the header: these
  -- paths exist nowhere else once the cascade has run.
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) INTO v_files FROM (
    SELECT jsonb_build_object('bucket', 'evidence', 'path', e.path) AS entry
      FROM public.project_substages ss
      CROSS JOIN LATERAL jsonb_array_elements_text(ss.evidence_urls) AS e(path)
     WHERE ss.project_id = p_project_id
       AND e.path <> ''
    UNION ALL
    SELECT jsonb_build_object('bucket', 'documents', 'path', d.file_path)
      FROM public.project_documents d
     WHERE d.project_id = p_project_id AND COALESCE(d.file_path, '') <> ''
    UNION ALL
    SELECT jsonb_build_object('bucket', 'certificates', 'path', c.storage_path)
      FROM public.certificates c
     WHERE c.project_id = p_project_id AND COALESCE(c.storage_path, '') <> ''
  ) AS collected;

  INSERT INTO public.admin_deleted_projects
    (project_id, name, owner_id, owner_email, tier, status, deleted_by, counts)
  VALUES (
    p_project_id, v_project.name, v_project.user_id, v_email,
    v_project.tier, v_project.status, auth.uid(),
    jsonb_build_object(
      'stages', v_stages, 'substages', v_subs,
      'documents', v_docs, 'messages', v_msgs,
      'files', jsonb_array_length(v_files)
    )
  )
  ON CONFLICT (project_id) DO UPDATE
    SET deleted_by = EXCLUDED.deleted_by,
        deleted_at = now(),
        counts     = EXCLUDED.counts;

  -- Everything hanging off the project goes with this one statement.
  DELETE FROM public.projects WHERE id = p_project_id;

  name        := v_project.name;
  owner_email := v_email;
  tier        := v_project.tier;
  stages      := v_stages;
  substages   := v_subs;
  documents   := v_docs;
  messages    := v_msgs;
  files       := v_files;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_project(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_project(uuid) IS
  'Delete one project and everything that cascades from it. Admin only. Returns the '
  'storage paths it could not delete itself, for the caller to remove through the '
  'Storage API. Frees a free-plan slot by design — see 069 header.';

-- ── Storage: let an admin remove the files ───────────────
--
-- The owner policies in 012 resolve through `projects`, so the moment the project row
-- is gone nobody can touch its files — including the admin who just deleted it. This
-- policy is deliberately NOT joined to `projects` for that exact reason: it has to keep
-- working after the row it would have joined to has been destroyed.
--
-- Scoped to the three buckets a project owns. `id-documents`, `contractor-docs` and
-- `agent-outputs` belong to a person or a job rather than a project and are untouched.
DROP POLICY IF EXISTS "admin_delete_project_files" ON storage.objects;
CREATE POLICY "admin_delete_project_files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id IN ('evidence', 'documents', 'certificates')
    AND public.is_admin()
  );

-- ── Verify ───────────────────────────────────────────────
-- Should return one row: admin_delete_project.
SELECT proname FROM pg_proc WHERE proname = 'admin_delete_project';
