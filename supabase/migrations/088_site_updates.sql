-- =========================================================
-- 088  A site update is a record; the evidence index stays where it is
--
-- Phase 4 of the admin re-architecture, migration 4 of 7
-- (docs/groundwork-admin/04-implementation-plan.md §2; Phase 2 §2.1; Phase 3 §3.5).
-- Depends on 086 (project_member, log_activity) and 087 (stage_verifications).
--
-- WHAT WAS MISSING. Evidence arrives as bare storage paths appended to
-- `project_substages.evidence_urls` from the browser. Nothing records WHO uploaded,
-- WHEN, against which stage, or what they said about it. The Site Updates feed, the
-- Action Center's "evidence requested" item, the lifecycle's `evidence_submitted` state
-- and 087's `site_update_id` all need that record.
--
-- THE RULE THIS MIGRATION IS BUILT AROUND (Phase 2 §7.2, reviewer note on 088):
--
--     site_updates          = the operational record   (who, when, stage, description, paths)
--     evidence_urls         = the existing evidence index (what the client renders,
--                             what the bucket RLS is keyed on)
--
-- Two views of one event, written in ONE transaction by submit_site_update(). Neither
-- replaces the other. `evidence_urls` is not migrated into rows; `site_updates` does not
-- become the thing the client reads. If the RPC fails, both writes roll back.
--
-- WHO SUBMITS. Owner, accepted contractor, admin. NOT a verifier — they assess the work,
-- they do not report it, and a verifier who could file the evidence they then verify
-- would be a conflict the schema should refuse (Phase 3 §1).
--
-- EVIDENCE NEEDS A SUBSTAGE. The only evidence index is `project_substages.evidence_urls`;
-- there is no stage-level one and this migration does not invent one. So an update that
-- carries paths must name the substage they belong to (substage_required:), or the record
-- and the index would disagree by construction. A description-only update may sit at
-- stage level. Enforced in the RPC, not as a table CHECK: `substage_id` is ON DELETE SET
-- NULL so history survives a substage deletion, and a CHECK would make that deletion fail.
--
-- PATHS ARE STRINGS. `evidence_paths` must be a JSON array of strings — a table CHECK via
-- jsonb_is_string_array(), and the RPC refuses anything else as bad_paths: before touching
-- the index.
--
-- RETRIES, INCLUDING CONCURRENT ONES. The browser uploads to storage first, then calls the
-- RPC. If the answer is lost it retries with the same `p_client_ref`. A plain "SELECT then
-- INSERT" races: two retries in flight both see no row, one inserts, the other hits the
-- unique index and errors. So the INSERT itself is the arbiter — `ON CONFLICT (client_ref)
-- WHERE client_ref IS NOT NULL DO NOTHING`; the loser reads the winner's id and returns it,
-- having appended nothing and logged nothing. The pre-check stays as the cheap path for the
-- ordinary sequential retry. Paths are deduplicated on append regardless.
--
-- Run in: Supabase Dashboard > SQL Editor (after 087)
-- =========================================================

-- ── 0. Helper: is this a JSON array whose every element is a string? ──
CREATE OR REPLACE FUNCTION public.jsonb_is_string_array(j jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT jsonb_typeof(j) = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j) e WHERE jsonb_typeof(e) <> 'string');
$$;

-- ── 1. The record ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_updates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id)          ON DELETE CASCADE,
  stage_id       uuid NOT NULL REFERENCES public.project_stages(id)    ON DELETE CASCADE,
  substage_id    uuid          REFERENCES public.project_substages(id) ON DELETE SET NULL,
  submitted_by   uuid NOT NULL REFERENCES auth.users(id),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  description    text,
  -- The paths THIS update added. Same strings as evidence_urls, so the two can be joined.
  evidence_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  location       jsonb,
  -- Client-generated per submission attempt; makes a retry a no-op.
  client_ref     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT site_updates_has_content
    CHECK (jsonb_array_length(evidence_paths) > 0 OR (description IS NOT NULL AND btrim(description) <> '')),
  CONSTRAINT site_updates_paths_is_array
    CHECK (jsonb_typeof(evidence_paths) = 'array'),
  CONSTRAINT site_updates_paths_are_strings
    CHECK (public.jsonb_is_string_array(evidence_paths))
);

CREATE UNIQUE INDEX IF NOT EXISTS site_updates_client_ref_key
  ON public.site_updates (client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_updates_project_idx ON public.site_updates (project_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS site_updates_stage_idx   ON public.site_updates (stage_id,   submitted_at DESC);

-- 087 left this as a plain uuid until the table existed.
ALTER TABLE public.stage_verifications
  DROP CONSTRAINT IF EXISTS stage_verifications_site_update_id_fkey;
ALTER TABLE public.stage_verifications
  ADD CONSTRAINT stage_verifications_site_update_id_fkey
  FOREIGN KEY (site_update_id) REFERENCES public.site_updates(id) ON DELETE SET NULL;

ALTER TABLE public.site_updates ENABLE ROW LEVEL SECURITY;

-- Read: every project member and admin. Write: the RPC only.
DROP POLICY IF EXISTS "members_read_site_updates" ON public.site_updates;
CREATE POLICY "members_read_site_updates"
  ON public.site_updates FOR SELECT TO authenticated
  USING (public.project_member(project_id) OR public.is_admin());

-- ── 2. Submit ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_site_update(
  p_stage       uuid,
  p_substage    uuid    DEFAULT NULL,
  p_description text    DEFAULT NULL,
  p_paths       jsonb   DEFAULT '[]'::jsonb,
  p_location    jsonb   DEFAULT NULL,
  p_client_ref  uuid    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage    public.project_stages%ROWTYPE;
  v_actor    uuid := auth.uid();
  v_owner    boolean;
  v_contr    boolean;
  v_admin    boolean := public.is_admin();
  v_paths    jsonb;
  v_existing uuid;
  v_id       uuid;
  v_bad      text;
BEGIN
  -- Retry: same client_ref → same row, nothing re-appended.
  IF p_client_ref IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.site_updates WHERE client_ref = p_client_ref;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;

  -- Who may report work: owner, accepted contractor, admin. A verifier is a member but
  -- must not file the evidence they will assess.
  v_owner := EXISTS (SELECT 1 FROM public.projects WHERE id = v_stage.project_id AND user_id = v_actor);
  v_contr := public.is_contractor_on(v_stage.project_id, v_actor);
  IF NOT (v_owner OR v_contr OR v_admin) THEN
    IF EXISTS (SELECT 1 FROM public.project_verifiers WHERE project_id = v_stage.project_id AND user_id = v_actor AND status = 'active') THEN
      RAISE EXCEPTION 'not_submitter: a verifier assesses evidence and does not submit it';
    END IF;
    RAISE EXCEPTION 'not_member: only the owner, a contractor or an administrator may submit a site update';
  END IF;

  -- Work is reported on a stage that is open: active, or pending_review (more evidence
  -- after a rejection or on request). Not on a locked or completed stage.
  IF v_stage.status NOT IN ('active', 'pending_review') THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;

  IF p_substage IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.project_substages WHERE id = p_substage AND stage_id = p_stage) THEN
    RAISE EXCEPTION 'substage_mismatch: that substage does not belong to this stage';
  END IF;

  -- Paths: an array of strings, each under this project's prefix. A path from another
  -- project's bucket folder would be unreadable anyway (the bucket RLS keys on
  -- path_tokens[1]), but it must not be indexed here either.
  v_paths := COALESCE(p_paths, '[]'::jsonb);
  IF NOT public.jsonb_is_string_array(v_paths) THEN
    RAISE EXCEPTION 'bad_paths: evidence paths must be an array of strings';
  END IF;
  IF jsonb_array_length(v_paths) > 0 AND p_substage IS NULL THEN
    RAISE EXCEPTION 'substage_required: evidence must be associated with a substage — the evidence index lives there';
  END IF;
  SELECT e INTO v_bad FROM jsonb_array_elements_text(v_paths) e
   WHERE split_part(e, '/', 1) <> v_stage.project_id::text LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'path_mismatch: % is not under this project', v_bad;
  END IF;
  IF jsonb_array_length(v_paths) = 0 AND (p_description IS NULL OR btrim(p_description) = '') THEN
    RAISE EXCEPTION 'empty_update: a site update needs evidence, a description, or both';
  END IF;

  -- The record. ON CONFLICT on the partial unique index is what makes two concurrent
  -- retries converge: the second INSERT waits for the first to commit, does nothing, and
  -- returns no row — so we read the winner's id and stop, appending and logging nothing.
  INSERT INTO public.site_updates
    (project_id, stage_id, substage_id, submitted_by, description, evidence_paths, location, client_ref)
  VALUES
    (v_stage.project_id, p_stage, p_substage, v_actor, NULLIF(btrim(p_description), ''), v_paths, p_location, p_client_ref)
  ON CONFLICT (client_ref) WHERE client_ref IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.site_updates WHERE client_ref = p_client_ref;
    RETURN v_id;
  END IF;

  -- The index, same transaction. Append only what is not already there — order kept,
  -- nothing removed, nothing duplicated. The client keeps reading this column exactly
  -- as before.
  -- (p_substage is guaranteed non-null here whenever v_paths is non-empty.)
  IF jsonb_array_length(v_paths) > 0 THEN
    UPDATE public.project_substages s
       SET evidence_urls = (
         SELECT COALESCE(jsonb_agg(x ORDER BY ord), '[]'::jsonb)
           FROM (
             SELECT e AS x, ord FROM jsonb_array_elements(s.evidence_urls) WITH ORDINALITY AS a(e, ord)
             UNION ALL
             SELECT n, 1000000 + ord FROM jsonb_array_elements(v_paths) WITH ORDINALITY AS b(n, ord)
              WHERE NOT s.evidence_urls @> jsonb_build_array(n)
           ) merged)
     WHERE s.id = p_substage;
  END IF;

  PERFORM public.log_activity(v_stage.project_id, 'site_update.submitted', 'site_update', v_id, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_id', p_stage, 'stage_number', v_stage.stage_number, 'substage_id', p_substage,
      'paths', jsonb_array_length(v_paths),
      'by', CASE WHEN v_admin AND NOT v_owner AND NOT v_contr THEN 'admin' WHEN v_owner THEN 'owner' ELSE 'contractor' END)));

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_site_update(uuid, uuid, text, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_site_update(uuid, uuid, text, jsonb, jsonb, uuid) TO authenticated;

COMMENT ON TABLE public.site_updates IS
  'The operational record of work reported on a stage: who, when, description, the paths '
  'this update added. NOT the evidence index — that stays on project_substages.evidence_urls, '
  'written by submit_site_update() in the same transaction. See 088.';

-- ── Verify ───────────────────────────────────────────────
-- One row: the FK from 087 now resolves to this table.
SELECT conname FROM pg_constraint WHERE conname = 'stage_verifications_site_update_id_fkey';
