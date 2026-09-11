-- =========================================================
-- 082  An admin may create a project on a client's behalf
--
-- WHY
--
-- Jalla Management is the tier where Jalla runs the build. The software already knows
-- this in two places: the tier guard (061) trusts an admin to set `jalla_management`
-- outright — its own comment says "an administrator setting up a negotiated contract" —
-- and Step 11 of the wizard says the Management budget "is produced and confirmed by a
-- Jalla admin after creation". Both halves assume an admin can put the project there in
-- the first place. Nothing lets them.
--
-- The block is the INSERT policy on `projects`: `auth.uid() = user_id`. A project has to
-- belong to the CLIENT — it is their build, their dashboard, their row-level access — so
-- an admin creating it must insert a row whose owner is somebody else, and that is
-- exactly the write the policy refuses. The same shape repeats on the three tables
-- `createProject` seeds in the same call.
--
-- WHAT THIS DOES NOT LOOSEN
--
-- The tier guard still runs and still clamps a non-admin. The Self Verify limit still
-- runs, and does not apply to a Management project because it counts only
-- `self_verify` rows. And these policies are INSERT only: an admin could already read
-- and update every project (009), so the surface that changes is "may put a row in",
-- and only for the role that already had every other verb.
-- =========================================================

CREATE POLICY "admin_insert_projects"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_insert_stages"
  ON public.project_stages FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_insert_substages"
  ON public.project_substages FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_insert_fees"
  ON public.project_fees FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- The contract they attach at creation. Owner-insert exists; this is the same for the
-- admin doing it for them.
CREATE POLICY "admin_insert_documents"
  ON public.project_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ── Who it was created by ────────────────────────────────
--
-- A Management project created by an admin and one created by the client look identical
-- afterwards. That is right for access — it is the client's project either way — and
-- wrong for the record: "who set this up" is a question the ops team and the audit trail
-- both need answered. Null means the owner did it themselves, which is every project
-- before this migration.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.projects.created_by IS
  'The admin who created this project on the owner''s behalf. Null when the owner did.';

-- The browser cannot claim a creator. A session inserting its own project has no
-- business setting this, and an admin's is stamped from the session rather than the
-- body, so it cannot be spoofed to somebody else.
CREATE OR REPLACE FUNCTION public.stamp_project_creator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> NEW.user_id THEN
    -- Somebody other than the owner is inserting. The INSERT policy above means that
    -- somebody is an admin; record which one.
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_project_creator() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_project_creator ON public.projects;
CREATE TRIGGER trg_stamp_project_creator
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_creator();
