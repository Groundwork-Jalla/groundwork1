-- =========================================================
-- 112  Letting a client share their build with their family
--
-- WHY
--
-- A project has exactly one owner. A spouse, a parent, a sibling paying toward the build
-- — none of them can see any of it. The person who asks "how far along is the house?"
-- has to be shown somebody else's phone, and the only workaround is sharing a password,
-- which is the worst possible answer: it hands over the whole account, every project, and
-- the ability to authorise things.
--
-- This adds a fourth kind of project member: somebody the OWNER invited to watch.
--
-- ── Read, and nothing else ───────────────────────────────────────────────────────────
-- `project_member()` (086) is the one gate this hangs off, and every policy that uses it
-- — projects, stages, substages, documents, site updates, stage verifications, and the
-- storage bucket (092) — is FOR SELECT. There is no write anywhere behind it. So adding a
-- viewer arm grants exactly what the name says and cannot be widened by accident: a new
-- WRITE policy using project_member() would be the mistake, and it would be a mistake for
-- contractors and verifiers too.
--
-- A viewer therefore cannot approve a stage, authorise money, invite anybody, change the
-- budget, or upload. They see the build.
--
-- ── Why the owner invites, and only the owner ────────────────────────────────────────
-- It is their project and their family. An admin inviting somebody's relative would be
-- deciding who gets to see a person's private finances on their behalf. A contractor
-- doing it would be worse.
--
-- ── Why an email and a token ─────────────────────────────────────────────────────────
-- Same shape as every other invitation here (100, 105): we mail the address, holding the
-- token is what proves you are the person it was sent to, and the preview is readable
-- before sign-in so the page can say whose build it is — a page that cannot reads as a
-- phishing link. A family member may have no Groundwork account at all, and must not need
-- one to be invited.
--
-- Run in: Supabase Dashboard > SQL Editor (after 111)
-- =========================================================

BEGIN;

-- ── 1. The invitation ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_viewers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email        text NOT NULL,
  -- What they are to the owner, in the owner's words. Shown back to them so a list of
  -- three addresses is a list of three people.
  relationship text,
  invited_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_at   timestamptz NOT NULL DEFAULT now(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT project_viewer_claim_shape  CHECK ((accepted_at IS NULL) = (user_id IS NULL)),
  CONSTRAINT project_viewer_revoke_shape CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS project_viewers_token
  ON public.project_viewers (token);

-- One live invitation per address per project. Re-inviting resends the same link rather
-- than leaving two valid ones in one inbox.
CREATE UNIQUE INDEX IF NOT EXISTS project_viewers_one_open_per_email
  ON public.project_viewers (project_id, lower(email))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS project_viewers_by_user
  ON public.project_viewers (user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE public.project_viewers IS
  'Somebody the project owner invited to watch their build (112) — family, a co-owner, '
  'whoever is paying toward it. Read-only: every policy behind project_member() is FOR '
  'SELECT. Never a way to act on a project.';

ALTER TABLE public.project_viewers ENABLE ROW LEVEL SECURITY;

-- The owner manages their own list; a viewer sees the row that names them; staff see all.
-- Nobody writes directly — the RPCs below are the only writers, so every invitation has
-- an inviter the server chose.
DROP POLICY IF EXISTS "owner_reads_project_viewers" ON public.project_viewers;
CREATE POLICY "owner_reads_project_viewers"
  ON public.project_viewers FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = project_id AND p.user_id = auth.uid())
  );

-- ── 2. The fourth kind of member ─────────────────────────
--
-- 086's definition with one arm added. Reproduced rather than altered because there is no
-- way to append to a SQL function body, and `search_path = ''` means every name stays
-- fully qualified.
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
                  AND pv.status = 'active')
    -- 112: somebody the owner invited to watch. Read only, because everything behind
    -- this function is a SELECT policy.
    OR EXISTS (SELECT 1 FROM public.project_viewers v
                WHERE v.project_id = p_project
                  AND v.user_id = auth.uid()
                  AND v.accepted_at IS NOT NULL
                  AND v.revoked_at IS NULL);
$$;

-- ── 3. Invite one ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_project_viewer(
  p_project      uuid,
  p_email        text,
  p_relationship text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_owner uuid;
  v_token uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email: an invitation needs an address to send to';
  END IF;

  SELECT user_id INTO v_owner FROM public.projects WHERE id = p_project;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'no_project: no such project'; END IF;
  -- Only the owner. Deliberately not an admin: who may see a person's finances is that
  -- person's decision, not staff's.
  IF v_owner <> v_actor THEN
    RAISE EXCEPTION 'not_owner: only the person whose project this is may share it';
  END IF;

  IF v_email = lower((SELECT email FROM public.profiles WHERE id = v_actor)) THEN
    RAISE EXCEPTION 'self_invite: you already have this project';
  END IF;

  -- Idempotent: an open invitation returns the token already in their inbox.
  SELECT token INTO v_token FROM public.project_viewers
   WHERE project_id = p_project AND lower(email) = v_email AND revoked_at IS NULL;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;

  INSERT INTO public.project_viewers (project_id, email, relationship, invited_by)
  VALUES (p_project, v_email, NULLIF(btrim(coalesce(p_relationship, '')), ''), v_actor)
  RETURNING token INTO v_token;

  PERFORM public.log_activity(p_project, 'project.viewer_invited', NULL, NULL, v_actor,
    jsonb_build_object('email', v_email));
  RETURN v_token;
END $$;

-- ── 4. Whose build is this? ──────────────────────────────
--
-- Anon, like 100's and 105's previews: the person may have no account yet, and a page
-- that cannot name the project it is inviting them to reads as a phishing link. The
-- projection is deliberately thin — a project name and who invited them, nothing about
-- the money.
CREATE OR REPLACE FUNCTION public.project_viewer_preview(p_token uuid)
RETURNS TABLE (project_name text, invited_by_name text, accepted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.name,
         COALESCE(NULLIF(btrim(o.full_name), ''), 'A Groundwork client'),
         v.accepted_at IS NOT NULL
    FROM public.project_viewers v
    JOIN public.projects p ON p.id = v.project_id
    LEFT JOIN public.profiles o ON o.id = v.invited_by
   WHERE v.token = p_token AND v.revoked_at IS NULL;
$$;

-- ── 5. Accept ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_project_viewer(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v       public.project_viewers%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in: create an account first'; END IF;

  SELECT * INTO v FROM public.project_viewers WHERE token = p_token FOR UPDATE;
  IF NOT FOUND              THEN RAISE EXCEPTION 'invalid_token: no invitation matches that link'; END IF;
  IF v.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked: that invitation has been withdrawn'; END IF;

  -- Accepting twice from the same account is a refresh.
  IF v.accepted_at IS NOT NULL THEN
    IF v.user_id = v_actor THEN RETURN v.project_id; END IF;
    RAISE EXCEPTION 'already_accepted: another account has accepted this invitation';
  END IF;

  UPDATE public.project_viewers
     SET user_id = v_actor, accepted_at = now()
   WHERE id = v.id;

  PERFORM public.log_activity(v.project_id, 'project.viewer_accepted', NULL, NULL, v_actor,
    jsonb_build_object('email', v.email));
  RETURN v.project_id;
END $$;

-- ── 6. Take it back ──────────────────────────────────────
--
-- The owner changes their mind, or the relationship does. Immediate: `project_member()`
-- reads `revoked_at IS NULL`, so access stops on the next request.
CREATE OR REPLACE FUNCTION public.revoke_project_viewer(p_viewer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v       public.project_viewers%ROWTYPE;
  v_owner uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO v FROM public.project_viewers WHERE id = p_viewer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such invitation'; END IF;

  SELECT user_id INTO v_owner FROM public.projects WHERE id = v.project_id;
  -- The owner, or the viewer removing their own access.
  IF v_actor <> v_owner AND v_actor IS DISTINCT FROM v.user_id THEN
    RAISE EXCEPTION 'not_permitted: only the owner, or the person themselves, may remove this';
  END IF;

  UPDATE public.project_viewers
     SET revoked_at = now(), revoked_by = v_actor
   WHERE id = v.id;

  PERFORM public.log_activity(v.project_id, 'project.viewer_removed', NULL, NULL, v_actor,
    jsonb_build_object('email', v.email));
END $$;

-- ── 7. Grants ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.invite_project_viewer(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.project_viewer_preview(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_project_viewer(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_project_viewer(uuid)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_project_viewer(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_viewer_preview(uuid)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_project_viewer(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_project_viewer(uuid)             TO authenticated;

COMMIT;
