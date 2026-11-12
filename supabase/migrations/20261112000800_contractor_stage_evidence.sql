-- Construction evidence is authored by assigned contractors; clients review it.
BEGIN;
CREATE OR REPLACE FUNCTION public.project_evidence_writer(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(public.is_contractor_on(p_project,auth.uid()),false)
   AND NOT coalesce(public.is_project_client(p_project),false);
$$;
REVOKE ALL ON FUNCTION public.project_evidence_writer(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_evidence_writer(uuid) TO authenticated;

-- Protect the evidence index even on deployments retaining owner UPDATE policies
-- or older applications using the direct-write fallback.
CREATE OR REPLACE FUNCTION public.guard_contractor_evidence_index()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_stage uuid; v_project uuid; v_paths jsonb; v_old jsonb:='[]'::jsonb; v_status text; BEGIN
 IF TG_OP='DELETE' THEN
   IF coalesce(jsonb_array_length(OLD.evidence_urls),0)=0 THEN RETURN OLD; END IF;
   v_stage:=OLD.stage_id; v_status:=OLD.status;
 ELSE
   IF TG_OP='UPDATE' THEN
     IF NEW.evidence_urls IS NOT DISTINCT FROM OLD.evidence_urls THEN RETURN NEW; END IF;
     v_old:=coalesce(OLD.evidence_urls,'[]'::jsonb); v_status:=OLD.status;
   END IF;
   IF TG_OP='INSERT' AND coalesce(jsonb_array_length(NEW.evidence_urls),0)=0 THEN RETURN NEW; END IF;
   v_stage:=NEW.stage_id; v_paths:=NEW.evidence_urls;
 END IF;
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=v_stage;
 -- Authorized whole-project/stage cascades retain their existing deletion path.
 IF TG_OP='DELETE' AND (NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.projects WHERE id=v_project)) THEN RETURN OLD; END IF;
 IF NOT public.project_evidence_writer(v_project) THEN RAISE EXCEPTION 'contractor_evidence_only: clients review construction evidence'; END IF;
 IF v_status='complete' THEN RAISE EXCEPTION 'evidence_reviewed: retain approved evidence'; END IF;
 IF EXISTS(SELECT 1 FROM public.project_stages WHERE id=v_stage AND (pre_existing OR status NOT IN('active','pending_review') OR review_payment_pending))
   OR EXISTS(SELECT 1 FROM public.projects WHERE id=v_project AND status<>'active')
   OR NOT coalesce(public.stage_work_ready(v_stage),false) THEN RAISE EXCEPTION 'evidence_stage_locked: upload on the current stage when it is open for work'; END IF;
 IF EXISTS(SELECT 1 FROM public.project_stages first JOIN public.project_stages target ON first.project_id=target.project_id
   WHERE target.id=v_stage AND first.stage_number<target.stage_number AND first.status<>'complete') THEN RAISE EXCEPTION 'stage_out_of_order: finish earlier stages first'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NOT coalesce(public.jsonb_is_string_array(v_paths),false) THEN RAISE EXCEPTION 'bad_paths: evidence paths must be an array of strings'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_paths) e WHERE NOT v_old @> jsonb_build_array(e)
   AND (split_part(e,'/',1)<>v_project::text OR split_part(e,'/',2)='receipts'
     OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='evidence' AND o.name=e))) THEN
   RAISE EXCEPTION 'path_mismatch: upload construction evidence to this project';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contractor_evidence_index BEFORE INSERT OR UPDATE OF evidence_urls OR DELETE ON public.project_substages
 FOR EACH ROW EXECUTE FUNCTION public.guard_contractor_evidence_index();

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
  v_project  uuid;
  v_retry    public.site_updates%ROWTYPE;
  v_paths    jsonb;
  v_existing uuid;
  v_id       uuid;
  v_bad      text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project FROM public.project_stages WHERE id=p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  PERFORM public.lock_project_stage_progression(v_project);
  SELECT * INTO v_stage FROM public.project_stages WHERE id=p_stage FOR UPDATE;
  IF NOT public.project_evidence_writer(v_project) THEN
    RAISE EXCEPTION 'not_submitter: construction evidence is submitted by the assigned contractor';
  END IF;
  -- A retry belongs to this actor and this project/work item, even after approval.
  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_retry FROM public.site_updates WHERE client_ref=p_client_ref;
    IF FOUND THEN
      IF v_retry.project_id<>v_project OR v_retry.stage_id<>p_stage OR v_retry.substage_id IS DISTINCT FROM p_substage OR v_retry.submitted_by<>v_actor THEN
        RAISE EXCEPTION 'client_ref_conflict: use the reference for its original submission';
      END IF;
      RETURN v_retry.id;
    END IF;
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
   WHERE split_part(e, '/', 1) <> v_stage.project_id::text OR split_part(e,'/',2)='receipts'
      OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='evidence' AND o.name=e) LIMIT 1;
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
      'by', 'contractor')));

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_site_update(uuid,uuid,text,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_site_update(uuid,uuid,text,jsonb,jsonb,uuid) TO authenticated;
-- Also guard direct/staff INSERTs: the site update reporter must be the assigned contractor.
CREATE OR REPLACE FUNCTION public.guard_contractor_site_reporter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_project uuid; BEGIN
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=NEW.stage_id;
 IF NOT public.project_evidence_writer(v_project) OR NEW.submitted_by IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'not_submitter: construction evidence is submitted by the assigned contractor';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contractor_site_reporter BEFORE INSERT ON public.site_updates
 FOR EACH ROW EXECUTE FUNCTION public.guard_contractor_site_reporter();

-- The evidence bucket also contains client payment receipts. Keep those uploads
-- available while restricting construction files independently of old broad policies.
CREATE OR REPLACE FUNCTION public.evidence_file_writable(p_path text,p_deleting boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_project uuid:=public.try_uuid(split_part(p_path,'/',1)); BEGIN
 IF auth.uid() IS NULL OR v_project IS NULL THEN RETURN false; END IF;
 IF p_deleting AND public.is_admin() AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=v_project) THEN RETURN true; END IF;
 IF split_part(p_path,'/',2)='receipts' THEN RETURN coalesce(public.is_project_client(v_project),false); END IF;
 IF NOT public.project_evidence_writer(v_project) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.project_substages sub JOIN public.project_stages s ON s.id=sub.stage_id
   WHERE s.project_id=v_project AND sub.evidence_urls @> jsonb_build_array(p_path)
     AND (sub.status='complete' OR s.pre_existing OR s.status='complete' OR s.review_payment_pending)) THEN RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.evidence_file_writable(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evidence_file_writable(text,boolean) TO authenticated;
CREATE POLICY contractor_stage_files_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'evidence' OR public.evidence_file_writable(name,false));
CREATE POLICY contractor_stage_files_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'evidence' OR public.evidence_file_writable(name,false))
 WITH CHECK(bucket_id<>'evidence' OR public.evidence_file_writable(name,false));
CREATE POLICY contractor_stage_files_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'evidence' OR public.evidence_file_writable(name,true));
COMMIT;
