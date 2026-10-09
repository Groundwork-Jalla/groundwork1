-- =========================================================
-- 107  What we found in work Groundwork never watched
--
-- WHY
--
-- 103 let a partner bring a half-built project onto Groundwork: the stages already done
-- are marked `pre_existing`, which costs the client nothing, requires no verification and
-- issues no certificate. That was the honest minimum — Groundwork neither funded nor
-- checked that work, and the badge says exactly that: "Completed outside Groundwork".
--
-- But a mark is not a review. Somebody from Jalla walks that site before taking the
-- project on. They see whether the foundation looks sound, whether the blockwork is
-- plumb, whether anything will have to be undone. Until now there was nowhere to put
-- that, so it lived in WhatsApp and in somebody's memory, and the question "did we
-- actually look at stage 3 before we took this on?" had no answer in the system.
--
-- This gives it a place.
--
-- ── What this is NOT ─────────────────────────────────────────────────────────────────
-- It is NOT a verification, and it must never be mistaken for one. A verification is a
-- verifier's decision on work Groundwork supervised, and it releases money (087, 090).
-- An assessment is an opinion about work we did not watch being done, recorded when we
-- took the project on. So:
--
--   · It lives in its own table. `stage_verifications` is untouched, which means the
--     four independent consumers of "latest verification wins" cannot see this and
--     cannot be confused by it.
--   · It issues no certificate. Certificates follow verification, and nothing here
--     writes one.
--   · It can never release money. `stage_release_blocker` (103) returns 'pre_existing'
--     before it looks at anything else, so a pre-existing stage is unpayable no matter
--     what is recorded here. This migration does not touch that function, deliberately.
--   · A bad finding does not block anything either. Recording "this foundation is
--     defective" is information for the client and the contractor; what to DO about it
--     is a conversation, and possibly a new stage, not a flag the database enforces.
--
-- ── Only on pre-existing stages ──────────────────────────────────────────────────────
-- A trigger refuses an assessment on an ordinary stage. Groundwork watched those, and
-- the record of what was found there is the verification. Two ways of saying "somebody
-- looked at this" on one stage would be two sources of truth.
--
-- ── Who records it ───────────────────────────────────────────────────────────────────
-- An admin, or a verifier assigned to the project. NOT the contractor: they are the
-- interested party in a judgement about whether their own earlier work is sound, and a
-- client reading "the contractor says their own foundation is fine" learns nothing.
-- The contractor's account of it belongs in the note the joining RPC already takes.
--
-- Run in: Supabase Dashboard > SQL Editor (after 106)
-- =========================================================

BEGIN;

-- ── 1. The assessment ────────────────────────────────────
--
-- One per stage, amendable. Not a log of visits: the question it answers is "what is the
-- state of this stage today, in our opinion", and that has one current answer. The
-- history of changes lives in the audit log, which is where history belongs.
CREATE TABLE IF NOT EXISTS public.stage_joining_assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id)       ON DELETE CASCADE,
  stage_id       uuid NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,

  -- Deliberately coarse. A five-point scale invites false precision about work nobody
  -- from Jalla saw being built; these four are the decisions that actually follow.
  --   sound            — nothing to do
  --   needs_attention  — usable, but something should be put right
  --   defective        — has to be redone before the build goes on
  --   not_inspected    — recorded so the gap is visible rather than silent
  condition      text NOT NULL CHECK (condition IN ('sound', 'needs_attention', 'defective', 'not_inspected')),

  -- Required. A condition with no reasoning is an assertion, and this record exists to
  -- answer "why did we say that" a year later.
  notes          text NOT NULL CHECK (btrim(notes) <> ''),

  -- Same shape and same bucket as 088's site evidence, so the two can be read together.
  evidence_paths jsonb NOT NULL DEFAULT '[]'::jsonb,

  assessed_by    uuid NOT NULL,
  assessed_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT joining_assessment_paths_is_array
    CHECK (jsonb_typeof(evidence_paths) = 'array'),
  CONSTRAINT joining_assessment_paths_are_strings
    CHECK (public.jsonb_is_string_array(evidence_paths)),
  -- "Not inspected" with photos attached is a contradiction somebody would have to
  -- explain; it means the gap is not actually a gap.
  CONSTRAINT joining_assessment_uninspected_has_no_evidence
    CHECK (condition <> 'not_inspected' OR jsonb_array_length(evidence_paths) = 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS stage_joining_assessments_one_per_stage
  ON public.stage_joining_assessments (stage_id);

CREATE INDEX IF NOT EXISTS stage_joining_assessments_project
  ON public.stage_joining_assessments (project_id);

COMMENT ON TABLE public.stage_joining_assessments IS
  'What Jalla found when reviewing work completed before a project joined Groundwork '
  '(107). An opinion about unsupervised work — NOT a verification: it issues no '
  'certificate and can never release money, because stage_release_blocker refuses every '
  'pre_existing stage (103). One per stage, amendable; changes are in the audit log.';

-- ── 2. Only on a stage nobody here watched ───────────────
CREATE OR REPLACE FUNCTION public.joining_assessment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage public.project_stages%ROWTYPE;
BEGIN
  SELECT * INTO v_stage FROM public.project_stages WHERE id = NEW.stage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_stage: no such stage';
  END IF;
  IF NOT COALESCE(v_stage.pre_existing, false) THEN
    RAISE EXCEPTION 'not_pre_existing: stage % was built on Groundwork; its record is the verification', NEW.stage_id;
  END IF;
  -- The project is derived, never taken from the caller: a mismatched project_id would
  -- put the assessment on one project's ledger while describing another's stage.
  IF NEW.project_id IS DISTINCT FROM v_stage.project_id THEN
    NEW.project_id := v_stage.project_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS joining_assessment_guard ON public.stage_joining_assessments;
CREATE TRIGGER joining_assessment_guard
  BEFORE INSERT OR UPDATE ON public.stage_joining_assessments
  FOR EACH ROW EXECUTE FUNCTION public.joining_assessment_guard();

-- ── 3. Who may read it ───────────────────────────────────
--
-- Everyone on the project. The client especially: a frank account of what they are
-- taking on is the point, and hiding a 'defective' finding from the person paying for
-- the build would make this record worse than useless.
ALTER TABLE public.stage_joining_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_read_joining_assessments" ON public.stage_joining_assessments;
CREATE POLICY "members_read_joining_assessments"
  ON public.stage_joining_assessments FOR SELECT TO authenticated
  USING (public.project_member(project_id) OR public.is_admin());

-- No INSERT, UPDATE or DELETE policy: the RPC below is the only writer, so every
-- assessment carries an author the server chose and an audit row it wrote.

-- ── 4. Record one ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_joining_assessment(
  p_stage     uuid,
  p_condition text,
  p_notes     text,
  p_evidence  jsonb DEFAULT '[]'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_stage    public.project_stages%ROWTYPE;
  v_id       uuid;
  v_existing public.stage_joining_assessments%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_stage: no such stage'; END IF;

  -- An admin, or a verifier standing on this project. A contractor is excluded even
  -- though they are a project member: see the header.
  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.project_verifiers pv
                WHERE pv.project_id = v_stage.project_id
                  AND pv.user_id = v_actor
                  AND pv.status = 'active')
  ) THEN
    RAISE EXCEPTION 'not_permitted: an assessment is recorded by Jalla or an assigned verifier';
  END IF;

  SELECT * INTO v_existing FROM public.stage_joining_assessments WHERE stage_id = p_stage;

  INSERT INTO public.stage_joining_assessments
    (project_id, stage_id, condition, notes, evidence_paths, assessed_by)
  VALUES
    (v_stage.project_id, p_stage, p_condition, p_notes, COALESCE(p_evidence, '[]'::jsonb), v_actor)
  ON CONFLICT (stage_id) DO UPDATE
     SET condition      = EXCLUDED.condition,
         notes          = EXCLUDED.notes,
         evidence_paths = EXCLUDED.evidence_paths,
         assessed_by    = EXCLUDED.assessed_by,
         assessed_at    = now()
  RETURNING id INTO v_id;

  -- Amending is its own event: "it was sound in March and defective in June" is a fact
  -- somebody will need, and a single mutable row cannot carry it.
  PERFORM public.log_activity(
    v_stage.project_id,
    CASE WHEN v_existing.id IS NULL THEN 'stage.joining_assessed' ELSE 'stage.joining_assessment_amended' END,
    'project_stage', p_stage, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'condition',      p_condition,
      'stage_number',   v_stage.stage_number,
      'evidence_count', jsonb_array_length(COALESCE(p_evidence, '[]'::jsonb)),
      'was',            v_existing.condition)));

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_joining_assessment(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_joining_assessment(uuid, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.record_joining_assessment(uuid, text, text, jsonb) IS
  'Record or amend what Jalla found in a pre-existing stage (107). Admin or assigned '
  'verifier only. Cannot touch money or verification: a pre_existing stage is unpayable '
  'by 103 and this writes nothing to stage_verifications.';

COMMIT;
