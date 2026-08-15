-- =========================================================
-- 039_project_takeoffs.sql
--
-- Contractor take-offs (Phase C).
--
-- Philip's decision, made concrete: one cost engine, two front doors. The client wizard
-- keeps its room counts and quick estimate. A contractor gets the same engine's LINES,
-- pre-filled, and edits only what differs from their own supplier. Nothing about the
-- client flow changes.
--
-- ── Why inputs + overrides, not line rows ────────────────
-- Lines are deterministic given the inputs, the overrides and the rate card. Storing ~30
-- rows per take-off would put each behind its own RLS check and require every one to stay
-- in step with engine.ts — which is drift, guaranteed, and drift in this engine is what
-- produced the 118.7% percentage bug. So the JSONB holds the two things a human actually
-- supplied, and the lines are recomputed.
--
-- ── Why snapshots ────────────────────────────────────────
-- Vanessa's re-baselined Bill of Quantity must not retroactively move a number a
-- contractor already quoted. Drafts recompute live; anything submitted freezes its lines,
-- its engine version, its city and its FX rate. Same reasoning migration 020 gives for
-- refusing to recalculate budget_usd.
--
-- ── Why RLS scopes on created_by, NOT on the project ─────
-- The existing contractor policies (contractors_select_stages) are per-project: anyone
-- invited to a project can read its rows. Copying that shape here would let EVERY bidding
-- contractor read every other bidder's pricing. Authorship is the boundary, and a draft
-- is private even from the project owner.
--
-- Run in: Supabase Dashboard > SQL Editor (after 038)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.project_takeoffs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES auth.users(id),

  -- What the author supplied. `inputs` is the wizard payload plus length/width/perimeter;
  -- `overrides` is { [bqCode]: { qty, rate, note } }.
  inputs          JSONB NOT NULL DEFAULT '{}'::jsonb,
  overrides       JSONB NOT NULL DEFAULT '{}'::jsonb,

  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'submitted', 'accepted', 'superseded')),

  -- Provenance. Without these a submitted take-off silently re-prices whenever the rate
  -- card moves, which would destroy a contractor's trust in the document faster than any
  -- wrong number.
  engine_version  TEXT,
  city_code       TEXT,
  currency_code   TEXT NOT NULL DEFAULT 'XAF',
  -- approx_fx_rate is a rounded constant (600 for XAF), so it is snapshotted per take-off
  -- and the USD column is labelled indicative. A local-currency figure that moved because
  -- a stored FX rate changed would be indefensible.
  fx_rate         NUMERIC(12,4),

  -- Frozen at submit. NULL while draft.
  lines_snapshot     JSONB,
  sections_snapshot  JSONB,
  total_local        NUMERIC(16,2),

  note            TEXT,
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_takeoffs_project_idx ON public.project_takeoffs(project_id);
CREATE INDEX IF NOT EXISTS project_takeoffs_author_idx  ON public.project_takeoffs(created_by);

ALTER TABLE public.project_takeoffs ENABLE ROW LEVEL SECURITY;

-- ── Read ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "authors_select_takeoffs" ON public.project_takeoffs;
DROP POLICY IF EXISTS "owners_select_takeoffs"  ON public.project_takeoffs;
DROP POLICY IF EXISTS "admins_all_takeoffs"     ON public.project_takeoffs;

-- The author sees their own, at any status.
CREATE POLICY "authors_select_takeoffs"
  ON public.project_takeoffs FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

-- The project owner sees SUBMITTED ones only. A contractor's draft is their working
-- document, not a live feed of their pricing to the person they are bidding to.
CREATE POLICY "owners_select_takeoffs"
  ON public.project_takeoffs FOR SELECT
  TO authenticated
  USING (
    status <> 'draft'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_takeoffs.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "admins_all_takeoffs"
  ON public.project_takeoffs FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── Write ────────────────────────────────────────────────
DROP POLICY IF EXISTS "authors_insert_takeoffs" ON public.project_takeoffs;
DROP POLICY IF EXISTS "authors_update_takeoffs" ON public.project_takeoffs;
DROP POLICY IF EXISTS "authors_delete_takeoffs" ON public.project_takeoffs;

-- Invite-first: you must own the project or hold an ACCEPTED invite to it. Cold bidding
-- is deliberately not supported — /tools/budget already serves the anonymous case, and
-- the variance comparison that makes this feature worth building needs a project to
-- compare against.
CREATE POLICY "authors_insert_takeoffs"
  ON public.project_takeoffs FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_takeoffs.project_id AND p.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.contractor_invites ci
        WHERE ci.project_id = project_takeoffs.project_id
          AND ci.contractor_user_id = auth.uid()
          AND ci.status = 'accepted'
      )
    )
  );

-- Editable while draft or submitted; frozen once accepted or superseded. USING gates the
-- row's CURRENT status, WITH CHECK its new one — without the second clause an author
-- could move their own row straight to 'accepted' and lock in a price the owner never
-- agreed to.
CREATE POLICY "authors_update_takeoffs"
  ON public.project_takeoffs FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() AND status IN ('draft', 'submitted'))
  WITH CHECK (created_by = auth.uid() AND status IN ('draft', 'submitted'));

-- Only a draft can be deleted. A submitted take-off is a document the owner may have
-- already read and compared against their budget; it is superseded, never removed.
CREATE POLICY "authors_delete_takeoffs"
  ON public.project_takeoffs FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() AND status = 'draft');

-- ── admin_delete_user must know about these ──────────────
-- `created_by` has no ON DELETE clause, so a contractor account with a take-off would
-- abort the delete on a foreign-key violation halfway through — exactly the class of bug
-- migration 035's own header describes running into.
--
-- Placed BEFORE the projects delete so a take-off on someone else's project goes too.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id UUID)
RETURNS TABLE (deleted_projects integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_projects   integer;
  v_admins     integer;
  v_is_admin   boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may delete a user';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'self_delete: you cannot delete your own account';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin')
    INTO v_is_admin;
  SELECT count(*) INTO v_admins FROM public.user_roles WHERE role = 'admin';
  IF v_is_admin AND v_admins <= 1 THEN
    RAISE EXCEPTION 'last_admin: that is the only administrator left';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'not_found: no such user';
  END IF;

  -- Their take-offs, wherever they live. New in 039.
  DELETE FROM public.project_takeoffs WHERE created_by = p_user_id;

  -- Their projects. Everything hanging off a project cascades from here, including
  -- project_fees (036) and any take-off another contractor wrote against them.
  DELETE FROM public.projects WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_projects = ROW_COUNT;

  -- References with no ON DELETE clause.
  DELETE FROM public.contractor_invites  WHERE invited_by = p_user_id;
  UPDATE public.contractor_invites  SET contractor_user_id = NULL WHERE contractor_user_id = p_user_id;
  DELETE FROM public.project_documents   WHERE uploaded_by = p_user_id;
  DELETE FROM public.project_messages    WHERE sender_id   = p_user_id;
  UPDATE public.project_audit_log   SET actor_id    = NULL WHERE actor_id    = p_user_id;
  UPDATE public.project_substages   SET approved_by = NULL WHERE approved_by = p_user_id;

  DELETE FROM auth.users WHERE id = p_user_id;

  deleted_projects := v_projects;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

COMMENT ON TABLE public.project_takeoffs IS
  'Contractor quantity take-offs. Stores author inputs and per-BQ-code overrides; lines '
  'are recomputed by the engine. Submitted rows freeze lines_snapshot so a later rate '
  'change cannot move a quoted figure.';
