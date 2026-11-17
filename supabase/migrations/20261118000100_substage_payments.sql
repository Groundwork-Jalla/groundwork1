-- Paying a stage part by part (18 November 2026).
--
-- A stage whose price is split across its parts (20261118000000) is paid one part at a
-- time, and the two-installment plan does not apply to it:
--
--   · each receipt names the part it pays for;
--   · a part can be paid once every earlier part's work is approved;
--   · work on a part can be uploaded once that part is covered.
--
-- The client never has more than one part's money at risk, and the contractor never works
-- a part unpaid. This replaces "evidence first" on split stages of contractor-created
-- projects too: the parts are small enough that paying ahead is the safer side for both.
--
-- Money is still the stage's. Every balance, carry-over and close-out keeps reading the
-- stage totals. Confirmed money covers the parts in order, so an overpayment on one part
-- counts toward the next and a receipt filed under the wrong part strands nothing.
BEGIN;

ALTER TABLE public.stage_payment_receipts ADD COLUMN IF NOT EXISTS substage_id uuid;
CREATE INDEX IF NOT EXISTS stage_payment_receipts_by_substage ON public.stage_payment_receipts(substage_id) WHERE substage_id IS NOT NULL;

-- The part a receipt pays for is recorded once, by the receipt RPC.
CREATE OR REPLACE FUNCTION public.guard_receipt_substage() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.substage_id IS NOT NULL AND current_setting('app.substage_receipt_write',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'receipt_via_rpc: use the receipt workflow'; END IF;
 ELSIF NEW.substage_id IS DISTINCT FROM OLD.substage_id
  AND (OLD.substage_id IS NOT NULL OR current_setting('app.substage_receipt_write',true) IS DISTINCT FROM 'on') THEN
  RAISE EXCEPTION 'receipt_immutable: the part a receipt pays for stays recorded';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS receipt_substage_guard ON public.stage_payment_receipts;
CREATE TRIGGER receipt_substage_guard BEFORE INSERT OR UPDATE ON public.stage_payment_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_substage();

-- Where each part of a split stage stands. NULL for a stage that is not split.
CREATE OR REPLACE FUNCTION public.substage_payment_state(p_stage uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t jsonb;code text;rate numeric;v_pool numeric;v_cum numeric:=0;v_prior_done boolean:=true;sub record;v_out jsonb:='[]';
 v_cover numeric;v_pending numeric;v_allows boolean;
BEGIN
 IF NOT public.stage_breakdown_split(p_stage) THEN RETURN NULL; END IF;
 t:=public.stage_payment_totals(p_stage); code:=t->>'currency'; rate:=(t->>'fx_rate')::numeric;
 SELECT coalesce(sum(CASE WHEN r.project_currency=code THEN r.project_amount WHEN r.currency=code THEN r.amount ELSE round(r.amount_usd*rate,6) END),0)
  INTO v_pool FROM public.stage_payment_receipts r
  WHERE r.stage_id=p_stage AND r.replaced_by IS NULL AND r.decision='received' AND NOT coalesce(r.legacy_unknown,false);
 -- Money carried from an earlier stage counts once the contractor has accepted it.
 IF EXISTS(SELECT 1 FROM public.stage_credit_confirmations WHERE stage_id=p_stage) THEN
  v_pool:=v_pool+coalesce((t->>'carried_in')::numeric,0);
 END IF;
 FOR sub IN SELECT id,substage_number,status,price_amount FROM public.project_substages WHERE stage_id=p_stage ORDER BY substage_number,id LOOP
  v_cover:=least(greatest(v_pool-v_cum,0),sub.price_amount);
  v_cum:=v_cum+sub.price_amount;
  SELECT coalesce(sum(CASE WHEN r.project_currency=code THEN r.project_amount WHEN r.currency=code THEN r.amount ELSE round(r.amount_usd*rate,6) END) FILTER(WHERE r.decision='pending'),0),
   coalesce(bool_or(r.allows_work AND r.decision='received'),false)
   INTO v_pending,v_allows FROM public.stage_payment_receipts r WHERE r.substage_id=sub.id AND r.replaced_by IS NULL;
  v_out:=v_out||jsonb_build_array(jsonb_build_object('id',sub.id,'number',sub.substage_number,'status',sub.status,
   'price',sub.price_amount::text,'covered',v_cover::text,'remaining',(sub.price_amount-v_cover)::text,'pending',v_pending::text,
   'paid',v_cover>=sub.price_amount OR v_allows,
   'payable',v_prior_done AND sub.status<>'complete' AND v_cover<sub.price_amount,
   'work_ready',v_prior_done AND (v_cover>=sub.price_amount OR v_allows)));
  v_prior_done:=v_prior_done AND sub.status='complete';
 END LOOP;
 RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.substage_payment_state(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.substage_work_ready(p_substage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT (e->>'work_ready')::boolean FROM jsonb_array_elements(public.substage_payment_state(sub.stage_id)) e WHERE e->>'id'=sub.id::text),false)
 FROM public.project_substages sub WHERE sub.id=p_substage;
$$;
REVOKE ALL ON FUNCTION public.substage_work_ready(uuid) FROM PUBLIC,anon,authenticated;

-- A split stage is paid ahead, part by part, whoever created the project.
CREATE OR REPLACE FUNCTION public.stage_starts_with_evidence(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.workflow_origin='contractor' AND NOT coalesce(s.pre_existing,false) AND NOT public.stage_breakdown_split(s.id)
 FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id WHERE s.id=p_stage
$$;

-- A split stage may begin once its first part can be worked.
CREATE OR REPLACE FUNCTION public.stage_work_ready(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (s.payment_milestone_usd=0 AND coalesce(s.milestone_amount,0)=0)
   OR (coalesce(public.stage_funding_settled(s.id),false)
   AND NOT EXISTS(SELECT 1 FROM public.stage_payment_plans WHERE stage_id=s.id AND status<>'accepted' AND superseded_at IS NULL))
   OR (coalesce(public.stage_starts_with_evidence(s.id),false) AND NOT s.review_payment_pending AND s.status<>'complete')
   OR (s.status<>'complete' AND public.stage_breakdown_split(s.id)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.substage_payment_state(s.id)) e WHERE (e->>'work_ready')::boolean AND e->>'status'<>'complete'))
 FROM public.project_stages s WHERE s.id=p_stage;
$$;

CREATE OR REPLACE FUNCTION public.guard_substage_progression() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_stage public.project_stages%ROWTYPE; v_work boolean;
BEGIN
  -- These are the existing atomic approval/join writers. A completion from a
  -- browser, including an older app version, must use the atomic substage RPC.
  IF current_setting('app.approve_substage',true) = 'on'
     OR current_setting('app.approve_stage',true) = 'on'
     OR current_setting('app.join_in_progress',true) = 'on' THEN RETURN NEW; END IF;
  IF (NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete')
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'approve_substage_via_rpc: approve updates through approve_substage()'; END IF;
  END IF;
  IF public.is_admin() THEN RETURN NEW; END IF;
  v_work := NEW.evidence_urls IS DISTINCT FROM OLD.evidence_urls
    OR (NEW.status IN ('in_progress','pending_review') AND NEW.status IS DISTINCT FROM OLD.status);
  IF NOT v_work THEN RETURN NEW; END IF;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = NEW.stage_id;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('project-stage-progression:' || v_stage.project_id::text,0)) THEN RAISE EXCEPTION 'stage_busy: this project is changing; retry the update'; END IF;
  IF coalesce(v_stage.pre_existing,false) OR v_stage.status NOT IN ('active','pending_review') THEN RAISE EXCEPTION 'wrong_state: work can only be reported on the current stage'; END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_stage.project_id AND stage_number < v_stage.stage_number AND status <> 'complete') THEN RAISE EXCEPTION 'stage_out_of_order: finish earlier stages first'; END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_stage.project_id AND status IN ('on_hold','completed')) THEN RAISE EXCEPTION 'project_paused: this project is not open for work'; END IF;
  IF NOT coalesce(public.stage_work_ready(v_stage.id),false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
  -- A stage paid by part: each part's work waits for that part's money (18 Nov).
  IF public.stage_breakdown_split(v_stage.id) AND NOT public.substage_work_ready(NEW.id) THEN
    RAISE EXCEPTION 'part_not_paid: this part of the stage has not been paid for yet';
  END IF;
  RETURN NEW;
END
$$;

-- Two installments do not apply to a stage paid by part.
CREATE OR REPLACE FUNCTION public.guard_plan_on_split_stage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.mode='two_installments' AND public.stage_breakdown_split(NEW.stage_id) THEN
  RAISE EXCEPTION 'stage_paid_by_part: this stage is paid part by part';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_plan_on_split_stage() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS plan_on_split_stage_guard ON public.stage_payment_plans;
CREATE TRIGGER plan_on_split_stage_guard BEFORE INSERT ON public.stage_payment_plans FOR EACH ROW EXECUTE FUNCTION public.guard_plan_on_split_stage();

-- Every receipt on a split stage names its part; checked at commit, after the RPC has
-- recorded it, so a direct call to the stage-level receipt RPCs cannot skip it.
CREATE OR REPLACE FUNCTION public.check_receipt_names_part() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.stage_payment_receipts r WHERE r.id=NEW.id AND r.substage_id IS NULL AND r.replaced_by IS NULL)
  AND public.stage_breakdown_split(NEW.stage_id) THEN
  RAISE EXCEPTION 'substage_receipt_required: name the part of the stage this receipt pays for';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.check_receipt_names_part() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS receipt_names_part ON public.stage_payment_receipts;
CREATE CONSTRAINT TRIGGER receipt_names_part AFTER INSERT ON public.stage_payment_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_receipt_names_part();

-- The client's receipt for one part. A replacement keeps the part of the receipt it replaces.
CREATE OR REPLACE FUNCTION public.submit_substage_receipt(p_substage uuid,p_path text,p_amount numeric,p_currency text,p_fx_rate numeric,p_reading uuid,p_replaces uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_stage uuid;v_project uuid;e jsonb;r public.stage_payment_receipts%ROWTYPE;result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT sub.stage_id,s.project_id INTO v_stage,v_project FROM public.project_substages sub JOIN public.project_stages s ON s.id=sub.stage_id WHERE sub.id=p_substage;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such part'; END IF;
 IF NOT public.is_project_client(v_project) THEN RAISE EXCEPTION 'not_client: only the project client uploads a receipt'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 IF NOT public.stage_breakdown_split(v_stage) THEN RAISE EXCEPTION 'stage_not_split: this stage is paid as one amount'; END IF;
 SELECT value INTO e FROM jsonb_array_elements(public.substage_payment_state(v_stage)) WHERE value->>'id'=p_substage::text;
 IF p_replaces IS NULL THEN
  IF NOT coalesce((e->>'payable')::boolean,false) THEN RAISE EXCEPTION 'part_not_payable: approve the earlier parts of this stage first'; END IF;
  result:=public.submit_stage_payment_receipt(v_stage,p_path,p_amount,p_currency,p_fx_rate,p_reading);
 ELSE
  SELECT * INTO r FROM public.stage_payment_receipts WHERE id=p_replaces AND stage_id=v_stage;
  IF NOT FOUND OR r.substage_id IS DISTINCT FROM p_substage THEN RAISE EXCEPTION 'stale_receipt'; END IF;
  result:=public.replace_stage_payment_receipt(p_replaces,v_stage,p_path,p_amount,p_currency,p_fx_rate,p_reading);
 END IF;
 SELECT * INTO r FROM public.stage_payment_receipts WHERE reading_id=p_reading FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'receipt_reading_required'; END IF;
 IF r.substage_id IS NOT NULL THEN
  IF r.substage_id<>p_substage THEN RAISE EXCEPTION 'receipt_immutable: the part a receipt pays for stays recorded'; END IF;
 ELSE
  PERFORM set_config('app.substage_receipt_write','on',true);
  PERFORM set_config('app.stage_receipt_write','on',true);
  UPDATE public.stage_payment_receipts SET substage_id=p_substage WHERE id=r.id;
  PERFORM set_config('app.stage_receipt_write','off',true);
  PERFORM set_config('app.substage_receipt_write','off',true);
 END IF;
 RETURN result||jsonb_build_object('substage_id',p_substage);
END $$;
REVOKE ALL ON FUNCTION public.submit_substage_receipt(uuid,text,numeric,text,numeric,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_substage_receipt(uuid,text,numeric,text,numeric,uuid,uuid) TO authenticated;

-- What the payment screen shows for a split stage.
CREATE OR REPLACE FUNCTION public.substage_payment_context(p_stage uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;v_state jsonb;v_parts jsonb;
BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_admin() OR public.project_member(s.project_id)) THEN RAISE EXCEPTION 'project_access_required'; END IF;
 v_state:=public.substage_payment_state(p_stage);
 IF v_state IS NULL THEN RETURN jsonb_build_object('stage_id',p_stage,'split',false); END IF;
 SELECT jsonb_agg(e||jsonb_build_object('name',sub.name,'key',sub.substage_key) ORDER BY ord) INTO v_parts
  FROM jsonb_array_elements(v_state) WITH ORDINALITY x(e,ord) JOIN public.project_substages sub ON sub.id=(e->>'id')::uuid;
 RETURN jsonb_build_object('stage_id',p_stage,'split',true,'currency',public.stage_payment_totals(p_stage)->>'currency','parts',v_parts,
  'next_payable',(SELECT e->>'id' FROM jsonb_array_elements(v_parts) e WHERE (e->>'payable')::boolean LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION public.substage_payment_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.substage_payment_context(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
