-- =========================================================
-- 086  Verifiers: the role's domain, and one definition of project membership
--
-- Phase 4 of the admin re-architecture, migration 2 of 7
-- (docs/groundwork-admin/04-implementation-plan.md §2, decisions §7.1). Depends on 085
-- only by sequence; touches nothing 085 touched.
--
-- WHAT WAS MISSING. `user_roles` has permitted `role = 'verifier'` since migration 001,
-- and nothing has ever used it: no profile for the professional, no assignment of one to
-- a project, no way for them to see the project they would verify. On Jalla Verify the
-- "independent verification" the product promises is an admin approving from photos
-- (audit §4). The 3 Sep meeting decided that an independent professional must visit the
-- site; this migration gives that person a place in the schema. What they DO there —
-- the verification itself — is 087.
--
-- ONE DEFINITION OF MEMBERSHIP. Today "who may see this project" is written three ways
-- across the stage tables: the owner clause, the accepted-contractor subquery, and admin.
-- Adding a verifier arm to each of those copies would make four. Instead:
--
--     project_member(project_id) ⇔ owner ∨ accepted contractor ∨ active verifier
--
-- is one SECURITY DEFINER function (the is_admin() pattern — it reads tables that have
-- RLS of their own, and a definer function is how that is done without policy loops),
-- and each stage-domain table gets ONE SELECT policy that calls it. The old owner FOR ALL
-- policies are split into per-command write policies — exactly what 053 did for
-- `projects` — so no table ends up with two overlapping SELECT paths. Admin SELECT
-- policies are untouched: admin is not membership.
--
-- OWNER WRITES ARE PRESERVED. `approveStage` in approvals.ts still updates stage status
-- as the owner from the browser; that moves into SQL in 087, not here. So the owner
-- keeps INSERT/UPDATE/DELETE on stages and substages, and only the SELECT half is
-- replaced.
--
-- THE ONE RULE ENFORCED HERE. A contractor on a project cannot be its verifier. It is a
-- trigger on the assignment table, not a UI check, because the UI is the least
-- trustworthy place to keep the product's central promise (Phase 3 §6).
--
-- `verification_required` lands on each stage now (from the tier; the verification
-- standard refines it later) so 087 has something to gate on. Set by trigger at seed
-- time and re-synced when a project's tier changes — rather than editing
-- start_project_tracking (072), whose eight-parameter body would have to be re-declared
-- whole to add one line.
--
-- Run in: Supabase Dashboard > SQL Editor (after 085)
-- =========================================================

-- ── 1. Helpers ───────────────────────────────────────────

-- Is this user an accepted contractor on this project? The other half of the
-- contractor-cannot-verify rule.
CREATE OR REPLACE FUNCTION public.is_contractor_on(p_project uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.contractor_invites ci
                  WHERE ci.project_id = p_project
                    AND ci.contractor_user_id = p_user
                    AND ci.status = 'accepted');
$$;

-- One writer for the activity log. Every RPC from here on records what it did through
-- this, in the same transaction, so the log cannot be skipped from a browser and cannot
-- disagree with the change.
--
-- 089 widens project_audit_log with entity_type / entity_id / person_id columns and
-- replaces this function to write them. Until then they travel inside `details`, so
-- nothing written now is lost when the columns arrive.
CREATE OR REPLACE FUNCTION public.log_activity(
  p_project     uuid,
  p_action      text,
  p_entity_type text    DEFAULT NULL,
  p_entity_id   uuid    DEFAULT NULL,
  p_person      uuid    DEFAULT NULL,
  p_details     jsonb   DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_audit_log (project_id, action, actor_id, details)
  VALUES (
    p_project, p_action, auth.uid(),
    COALESCE(p_details, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
           'entity_type', p_entity_type,
           'entity_id',   p_entity_id,
           'person_id',   p_person))
  );
END;
$$;

-- The assignment table comes BEFORE project_member(): that helper is LANGUAGE sql, which
-- Postgres validates at CREATE time, so the table it reads has to exist first. (Caught
-- by the local run — the first draft declared them the other way round and failed on
-- this exact line.) Its policies are in section 3, after the helper they use.
CREATE TABLE IF NOT EXISTS public.project_verifiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  discipline  text NOT NULL,                        -- free text until the standard exists
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at  timestamptz,
  UNIQUE (project_id, user_id, discipline)
);

CREATE INDEX IF NOT EXISTS project_verifiers_user_active_idx
  ON public.project_verifiers (user_id) WHERE status = 'active';

-- The contractor-cannot-verify rule, at the database boundary. Also refuses a user who
-- does not hold the verifier role at all.
CREATE OR REPLACE FUNCTION public.project_verifiers_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = 'verifier') THEN
    RAISE EXCEPTION 'not_verifier: user % does not hold the verifier role', NEW.user_id;
  END IF;
  IF public.is_contractor_on(NEW.project_id, NEW.user_id) THEN
    RAISE EXCEPTION 'contractor_cannot_verify: user % is a contractor on project %', NEW.user_id, NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_verifiers_guard ON public.project_verifiers;
CREATE TRIGGER project_verifiers_guard
  BEFORE INSERT OR UPDATE ON public.project_verifiers
  FOR EACH ROW EXECUTE FUNCTION public.project_verifiers_guard();

ALTER TABLE public.project_verifiers ENABLE ROW LEVEL SECURITY;


-- Is the caller a member of this project? Owner, accepted contractor, or active verifier.
-- STABLE + SECURITY DEFINER so it can be used inside RLS policies on the very tables it
-- reads (is_admin(), 075, is the precedent). search_path is empty, so every name is
-- schema-qualified and a malicious search_path cannot redirect it.
CREATE OR REPLACE FUNCTION public.project_member(p_project uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = p_project AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.contractor_invites ci
                WHERE ci.project_id = p_project
                  AND ci.contractor_user_id = auth.uid()
                  AND ci.status = 'accepted')
    OR EXISTS (SELECT 1 FROM public.project_verifiers pv
                WHERE pv.project_id = p_project
                  AND pv.user_id = auth.uid()
                  AND pv.status = 'active');
$$;

REVOKE ALL ON FUNCTION public.project_member(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_contractor_on(uuid, uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_activity(uuid, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.project_member(uuid)            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_contractor_on(uuid, uuid)     TO authenticated;
-- log_activity is called only from other definer functions; no direct grant.

-- ── 2. The verifier's profile ────────────────────────────
CREATE TABLE IF NOT EXISTS public.verifier_profiles (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  disciplines       text[] NOT NULL DEFAULT '{}',   -- e.g. {civil, electrical, architect, land}
  registration_body text,                           -- ONIGC, ONAC, …
  registration_no   text,
  city              text,
  available         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- A profile is meaningless without the role. The role value has existed since 001.
CREATE OR REPLACE FUNCTION public.verifier_profiles_require_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = 'verifier') THEN
    RAISE EXCEPTION 'not_verifier: user % does not hold the verifier role', NEW.user_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS verifier_profiles_require_role ON public.verifier_profiles;
CREATE TRIGGER verifier_profiles_require_role
  BEFORE INSERT OR UPDATE ON public.verifier_profiles
  FOR EACH ROW EXECUTE FUNCTION public.verifier_profiles_require_role();

ALTER TABLE public.verifier_profiles ENABLE ROW LEVEL SECURITY;

-- Profile records are directory data, like `contractors`: admins write them directly
-- (admins_write_contractors is the precedent). Assignments, below, go through RPCs.
DROP POLICY IF EXISTS "admins_all_verifier_profiles" ON public.verifier_profiles;
CREATE POLICY "admins_all_verifier_profiles"
  ON public.verifier_profiles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "verifiers_read_own_profile" ON public.verifier_profiles;
CREATE POLICY "verifiers_read_own_profile"
  ON public.verifier_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "verifiers_update_own_profile" ON public.verifier_profiles;
CREATE POLICY "verifiers_update_own_profile"
  ON public.verifier_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Members of a project may see the profiles of the verifiers assigned to it — the
-- Team tab. Nothing else about verifiers is visible to non-staff.
DROP POLICY IF EXISTS "members_read_assigned_verifier_profiles" ON public.verifier_profiles;
CREATE POLICY "members_read_assigned_verifier_profiles"
  ON public.verifier_profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.project_verifiers pv
                  WHERE pv.user_id = verifier_profiles.user_id
                    AND pv.status = 'active'
                    AND public.project_member(pv.project_id)));

-- ── 3. Assignment policies ──────────────────────────────
-- Read: admin, the project owner, the verifier themself. Write: RPCs only — with RLS on
-- and no INSERT/UPDATE/DELETE policy for authenticated, the browser cannot.
DROP POLICY IF EXISTS "admins_read_project_verifiers" ON public.project_verifiers;
CREATE POLICY "admins_read_project_verifiers"
  ON public.project_verifiers FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "owners_read_project_verifiers" ON public.project_verifiers;
CREATE POLICY "owners_read_project_verifiers"
  ON public.project_verifiers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "verifiers_read_own_assignments" ON public.project_verifiers;
CREATE POLICY "verifiers_read_own_assignments"
  ON public.project_verifiers FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 4. Assignment RPCs ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_verifier(
  p_project    uuid,
  p_user       uuid,
  p_discipline text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may assign a verifier';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project) THEN
    RAISE EXCEPTION 'not_found: no such project';
  END IF;
  IF p_discipline IS NULL OR btrim(p_discipline) = '' THEN
    RAISE EXCEPTION 'discipline_required: a discipline is required';
  END IF;
  -- The trigger enforces the role and the contractor rule; a refusal surfaces as its
  -- own prefixed message, which the client matches on.

  -- Re-assigning someone who was removed reactivates the same row rather than erroring
  -- on the UNIQUE — the history stays on one row.
  INSERT INTO public.project_verifiers (project_id, user_id, discipline, assigned_by)
  VALUES (p_project, p_user, btrim(p_discipline), auth.uid())
  ON CONFLICT (project_id, user_id, discipline) DO UPDATE
    SET status = 'active', assigned_by = auth.uid(), assigned_at = now(), removed_at = NULL
  RETURNING id INTO v_id;

  PERFORM public.log_activity(p_project, 'verifier.assigned', 'project_verifier', v_id, p_user,
                              jsonb_build_object('discipline', btrim(p_discipline)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.remove_verifier(p_assignment uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project uuid;
  v_user    uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may remove a verifier';
  END IF;
  UPDATE public.project_verifiers
     SET status = 'removed', removed_at = now()
   WHERE id = p_assignment AND status = 'active'
  RETURNING project_id, user_id INTO v_project, v_user;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'not_found: no active assignment %', p_assignment;
  END IF;
  PERFORM public.log_activity(v_project, 'verifier.removed', 'project_verifier', p_assignment, v_user);
END $$;

REVOKE ALL ON FUNCTION public.assign_verifier(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_verifier(uuid)             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.assign_verifier(uuid, uuid, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.remove_verifier(uuid)             TO authenticated;

-- ── 5. Does this stage need independent verification? ────
ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS verification_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_stages.verification_required IS
  'Independent verification gates approval (087). From the tier today; the verification '
  'standard refines it per stage later. Set at seed and re-synced on tier change (086).';

-- Backfill: every stage of every non-self-verify project.
UPDATE public.project_stages s
   SET verification_required = true
  FROM public.projects p
 WHERE p.id = s.project_id
   AND p.tier NOT IN ('self_verify', 'starter');

-- New stages take the project's tier at seed time.
CREATE OR REPLACE FUNCTION public.stages_default_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT (p.tier NOT IN ('self_verify', 'starter')) INTO NEW.verification_required
    FROM public.projects p WHERE p.id = NEW.project_id;
  NEW.verification_required := COALESCE(NEW.verification_required, false);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stages_default_verification ON public.project_stages;
CREATE TRIGGER stages_default_verification
  BEFORE INSERT ON public.project_stages
  FOR EACH ROW EXECUTE FUNCTION public.stages_default_verification();

-- A tier change (Stripe webhook, 021; admin, 061) re-syncs stages that are not yet
-- complete. A stage already approved keeps whatever requirement it was approved under.
CREATE OR REPLACE FUNCTION public.projects_sync_stage_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tier IS DISTINCT FROM OLD.tier THEN
    UPDATE public.project_stages
       SET verification_required = (NEW.tier NOT IN ('self_verify', 'starter'))
     WHERE project_id = NEW.id AND status <> 'complete';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS projects_sync_stage_verification ON public.projects;
CREATE TRIGGER projects_sync_stage_verification
  AFTER UPDATE OF tier ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_sync_stage_verification();

-- ── 6. One SELECT policy per stage-domain table ──────────
--
-- The owner FOR ALL policies are split into per-command write policies (053's pattern),
-- and the owner + contractor SELECT pair is replaced by one member policy. Admin SELECT
-- policies (009) stay as they are. Names are new so nothing here collides with a policy
-- a re-run of an older migration might recreate.

-- projects
DROP POLICY IF EXISTS "owner_select_projects"               ON public.projects;
DROP POLICY IF EXISTS "contractors_select_invited_projects" ON public.projects;
DROP POLICY IF EXISTS "member_select_projects"              ON public.projects;
CREATE POLICY "member_select_projects"
  ON public.projects FOR SELECT TO authenticated
  USING (public.project_member(id));

-- project_stages
DROP POLICY IF EXISTS "owner_all_stages"         ON public.project_stages;
DROP POLICY IF EXISTS "contractors_select_stages" ON public.project_stages;
DROP POLICY IF EXISTS "member_select_stages"      ON public.project_stages;
CREATE POLICY "member_select_stages"
  ON public.project_stages FOR SELECT TO authenticated
  USING (public.project_member(project_id));
DROP POLICY IF EXISTS "owner_insert_stages" ON public.project_stages;
CREATE POLICY "owner_insert_stages"
  ON public.project_stages FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "owner_update_stages" ON public.project_stages;
CREATE POLICY "owner_update_stages"
  ON public.project_stages FOR UPDATE TO authenticated
  USING      (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "owner_delete_stages" ON public.project_stages;
CREATE POLICY "owner_delete_stages"
  ON public.project_stages FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

-- project_substages (contractors_update_evidence is an UPDATE policy; it stays)
DROP POLICY IF EXISTS "owner_all_substages"         ON public.project_substages;
DROP POLICY IF EXISTS "contractors_select_substages" ON public.project_substages;
DROP POLICY IF EXISTS "member_select_substages"      ON public.project_substages;
CREATE POLICY "member_select_substages"
  ON public.project_substages FOR SELECT TO authenticated
  USING (public.project_member(project_id));
DROP POLICY IF EXISTS "owner_insert_substages" ON public.project_substages;
CREATE POLICY "owner_insert_substages"
  ON public.project_substages FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "owner_update_substages" ON public.project_substages;
CREATE POLICY "owner_update_substages"
  ON public.project_substages FOR UPDATE TO authenticated
  USING      (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "owner_delete_substages" ON public.project_substages;
CREATE POLICY "owner_delete_substages"
  ON public.project_substages FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

-- project_documents (contractors had no access; verifiers need the evidence)
DROP POLICY IF EXISTS "owner_all_documents"     ON public.project_documents;
DROP POLICY IF EXISTS "member_select_documents" ON public.project_documents;
CREATE POLICY "member_select_documents"
  ON public.project_documents FOR SELECT TO authenticated
  USING (public.project_member(project_id));
DROP POLICY IF EXISTS "owner_insert_documents" ON public.project_documents;
CREATE POLICY "owner_insert_documents"
  ON public.project_documents FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "owner_update_documents" ON public.project_documents;
CREATE POLICY "owner_update_documents"
  ON public.project_documents FOR UPDATE TO authenticated
  USING      (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "owner_delete_documents" ON public.project_documents;
CREATE POLICY "owner_delete_documents"
  ON public.project_documents FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

-- ── Verify ───────────────────────────────────────────────
-- Exactly one member_select_* policy on each of the four tables.
SELECT tablename, count(*) FILTER (WHERE policyname LIKE 'member_select_%') AS member_select_policies
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('projects', 'project_stages', 'project_substages', 'project_documents')
 GROUP BY tablename ORDER BY tablename;
