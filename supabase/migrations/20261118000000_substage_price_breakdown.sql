-- Sub-stage price breakdowns (18 November 2026).
--
-- A stage is too large a unit of money: on 17 November the Structure & Walls payment was
-- the whole wall in one transfer. A stage's price can now be split across its sub-stages,
-- and a contractor can add sub-stages when the scope grows (a fence, a septic tank, a
-- third floor's slab), under the same rule as every other price on a project:
--
--   · the primary contractor PROPOSES; only the primary client APPROVES; nothing a
--     contractor writes changes a price by itself;
--   · a breakdown always adds up to the stage price exactly, so the stage stays the unit
--     of verification, certificates and every balance already computed from it;
--   · every proposal is kept, approved or not, so the original plan and each revision
--     stay on record for the final report.
--
-- A breakdown is open only before the stage's work or payments start. Changing the
-- stage price clears its breakdown (the parts no longer add up), and the contractor
-- proposes a new one. Payment per sub-stage is a separate migration.
BEGIN;

ALTER TABLE public.project_substages
 ADD COLUMN IF NOT EXISTS price_amount numeric(24,6),
 ADD COLUMN IF NOT EXISTS added_by_breakdown uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='project_substages_price_amount_range') THEN
  ALTER TABLE public.project_substages ADD CONSTRAINT project_substages_price_amount_range
   CHECK(price_amount IS NULL OR (price_amount>=0 AND price_amount<=1e12));
 END IF;
END $$;

-- Mirrors stage_breakdown_split() on the stage row, so every screen that already reads a
-- stage knows it is paid by part. The database rules read the function, never this flag.
ALTER TABLE public.project_stages ADD COLUMN IF NOT EXISTS paid_by_part boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.guard_stage_paid_by_part() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF NEW.paid_by_part IS DISTINCT FROM OLD.paid_by_part AND current_setting('app.substage_pricing_write',true) IS DISTINCT FROM 'on' THEN
  RAISE EXCEPTION 'stage_breakdown_requires_approval: a stage is paid by part only through an approved breakdown';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stage_paid_by_part_guard ON public.project_stages;
CREATE TRIGGER stage_paid_by_part_guard BEFORE UPDATE OF paid_by_part ON public.project_stages FOR EACH ROW EXECUTE FUNCTION public.guard_stage_paid_by_part();

CREATE TABLE IF NOT EXISTS public.stage_breakdown_proposals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.projects ON DELETE CASCADE,
 stage_id uuid NOT NULL REFERENCES public.project_stages ON DELETE CASCADE,
 proposed_by uuid NOT NULL, proposed_at timestamptz NOT NULL DEFAULT now(),
 note text CHECK(length(note)<=2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','declined','withdrawn')),
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 stage_amount numeric(24,6) NOT NULL CHECK(stage_amount>0),
 base_hash text NOT NULL,
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'),
 decided_by uuid, decided_at timestamptz,
 CHECK((status='pending')=(decided_at IS NULL)), CHECK((decided_at IS NULL)=(decided_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS stage_breakdown_one_pending ON public.stage_breakdown_proposals(stage_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS stage_breakdown_by_stage ON public.stage_breakdown_proposals(stage_id,proposed_at DESC);
ALTER TABLE public.stage_breakdown_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stage_breakdown_member_read ON public.stage_breakdown_proposals;
CREATE POLICY stage_breakdown_member_read ON public.stage_breakdown_proposals FOR SELECT TO authenticated
 USING(public.is_admin() OR public.project_member(project_id));
GRANT SELECT ON public.stage_breakdown_proposals TO authenticated;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='project_substages_added_by_breakdown_fkey') THEN
  ALTER TABLE public.project_substages ADD CONSTRAINT project_substages_added_by_breakdown_fkey
   FOREIGN KEY(added_by_breakdown) REFERENCES public.stage_breakdown_proposals(id) ON DELETE SET NULL;
 END IF;
END $$;

-- Every sub-stage priced, and the prices add up to the stage price exactly.
CREATE OR REPLACE FUNCTION public.stage_breakdown_split(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(count(*)>0 AND bool_and(sub.price_amount IS NOT NULL)
  AND sum(sub.price_amount)=(public.stage_payment_own_totals(p_stage)->>'stage_amount')::numeric,false)
 FROM public.project_substages sub WHERE sub.stage_id=p_stage;
$$;
REVOKE ALL ON FUNCTION public.stage_breakdown_split(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stage_breakdown_split(uuid) TO authenticated;

-- Open before the stage's work or money starts: nothing paid, carried or planned in two
-- installments against it, and no work uploaded or approved on any of its parts. Splitting
-- changes how the stage is paid, so it is settled before anyone acts on the old terms.
CREATE OR REPLACE FUNCTION public.stage_breakdown_editable(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id
  WHERE s.id=p_stage AND p.status='active' AND NOT coalesce(s.pre_existing,false) AND s.status<>'complete'
   AND NOT coalesce(s.review_payment_pending,false)
   AND NOT EXISTS(SELECT 1 FROM public.project_substages sub WHERE sub.stage_id=s.id
    AND (sub.status='complete' OR coalesce(jsonb_array_length(sub.evidence_urls),0)>0))
   AND NOT EXISTS(SELECT 1 FROM public.stage_payment_plans pl WHERE pl.stage_id=s.id AND pl.superseded_at IS NULL AND pl.mode='two_installments')
   AND NOT EXISTS(SELECT 1 FROM public.stage_payment_receipts r WHERE r.stage_id=s.id AND r.decision<>'flagged')
   AND NOT EXISTS(SELECT 1 FROM public.stage_credit_confirmations c WHERE c.stage_id=s.id)
   AND NOT EXISTS(SELECT 1 FROM public.payments pay WHERE pay.stage_id=s.id AND (pay.direction='out' OR pay.state<>'expected')))
  AND coalesce((public.stage_payment_own_totals(p_stage)->>'stage_amount')::numeric,0)>0;
$$;
REVOKE ALL ON FUNCTION public.stage_breakdown_editable(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.stage_breakdown_context(p_stage uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;t jsonb;v_subs jsonb;v_hash text;v_history jsonb;v_editable boolean;v_pending boolean;
BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_admin() OR public.project_member(s.project_id)) THEN RAISE EXCEPTION 'project_access_required'; END IF;
 t:=public.stage_payment_own_totals(p_stage);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',sub.id,'number',sub.substage_number,'name',sub.name,'key',sub.substage_key,
   'status',sub.status,'amount',sub.price_amount::text,'added',sub.added_by_breakdown IS NOT NULL) ORDER BY sub.substage_number,sub.id),'[]'::jsonb)
  INTO v_subs FROM public.project_substages sub WHERE sub.stage_id=p_stage;
 v_editable:=public.stage_breakdown_editable(p_stage);
 v_hash:=md5(jsonb_build_object('stage',p_stage,'amount',t->>'stage_amount','currency',t->>'currency','status',s.status,
   'editable',v_editable,'substages',v_subs)::text);
 v_pending:=EXISTS(SELECT 1 FROM public.stage_breakdown_proposals WHERE stage_id=p_stage AND status='pending');
 SELECT coalesce(jsonb_agg(item ORDER BY proposed_at DESC,id),'[]'::jsonb) INTO v_history FROM (
  SELECT id,proposed_at,jsonb_build_object('id',id,'status',status,'proposed_at',proposed_at,'note',note,'currency',currency,
   'stage_amount',stage_amount::text,'lines',lines,'decided_at',decided_at,'stale',status='pending' AND base_hash<>v_hash,
   'can_withdraw',status='pending' AND proposed_by=auth.uid()) AS item
  FROM public.stage_breakdown_proposals WHERE stage_id=p_stage ORDER BY proposed_at DESC,id LIMIT 20) h;
 RETURN jsonb_build_object('stage_id',p_stage,'project_id',s.project_id,'stage_number',s.stage_number,
  'currency',t->>'currency','stage_amount',t->>'stage_amount','split',public.stage_breakdown_split(p_stage),
  'substages',v_subs,'base_hash',v_hash,'editable',v_editable,'history',v_history,
  'can_propose',v_editable AND NOT v_pending AND public.is_primary_project_contractor(s.project_id) AND NOT public.is_project_client(s.project_id),
  'can_decide',v_editable AND public.is_project_client(s.project_id));
END $$;
REVOKE ALL ON FUNCTION public.stage_breakdown_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stage_breakdown_context(uuid) TO authenticated;

-- p_lines: every existing sub-stage once as {substage_id, amount}, and any new one as
-- {name, amount}. The amounts must add up to the stage price exactly.
CREATE OR REPLACE FUNCTION public.propose_stage_breakdown(p_stage uuid,p_lines jsonb,p_base_hash text,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;c jsonb;l jsonb;sub jsonb;v_lines jsonb:='[]';v_seen uuid[]:='{}';v_id uuid;v_sub uuid;
 v_amount numeric;v_total numeric:=0;v_new int:=0;v_changed boolean:=false;v_name text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
 IF NOT public.is_primary_project_contractor(s.project_id) OR public.is_project_client(s.project_id) THEN RAISE EXCEPTION 'not_primary_contractor'; END IF;
 PERFORM public.lock_project_stage_progression(s.project_id);
 PERFORM 1 FROM public.project_substages WHERE stage_id=p_stage ORDER BY id FOR UPDATE;
 c:=public.stage_breakdown_context(p_stage);
 IF c->>'editable'<>'true' THEN RAISE EXCEPTION 'stage_breakdown_locked: a stage with payments recorded keeps its breakdown'; END IF;
 IF p_base_hash IS DISTINCT FROM c->>'base_hash' THEN RAISE EXCEPTION 'stale_stage_breakdown'; END IF;
 IF EXISTS(SELECT 1 FROM public.stage_breakdown_proposals WHERE stage_id=p_stage AND status='pending') THEN RAISE EXCEPTION 'breakdown_proposal_pending'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 60 OR length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid_stage_breakdown'; END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(l)<>'object' OR coalesce(l->>'amount','') !~ '^\d{1,13}(\.\d{1,6})?$' THEN RAISE EXCEPTION 'invalid_stage_breakdown'; END IF;
  v_amount:=(l->>'amount')::numeric;
  IF v_amount>1e12 THEN RAISE EXCEPTION 'invalid_stage_breakdown'; END IF;
  v_total:=v_total+v_amount;
  IF l ? 'substage_id' THEN
   IF coalesce(l->>'substage_id','') !~ '^[a-fA-F0-9-]{36}$' THEN RAISE EXCEPTION 'invalid_stage_breakdown'; END IF;
   v_sub:=(l->>'substage_id')::uuid;
   IF v_sub=ANY(v_seen) THEN RAISE EXCEPTION 'invalid_stage_breakdown: a sub-stage appears twice'; END IF;
   v_seen:=array_append(v_seen,v_sub);
   SELECT value INTO sub FROM jsonb_array_elements(c->'substages') WHERE value->>'id'=v_sub::text;
   IF sub IS NULL THEN RAISE EXCEPTION 'invalid_stage_breakdown: not a sub-stage of this stage'; END IF;
   IF (sub->>'amount') IS NULL OR (sub->>'amount')::numeric<>v_amount THEN v_changed:=true; END IF;
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object('substage_id',v_sub,'name',sub->>'name','key',sub->>'key','before',sub->>'amount','amount',v_amount::text));
  ELSE
   v_name:=btrim(coalesce(l->>'name',''));
   IF length(v_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid_stage_breakdown: a new sub-stage needs a name'; END IF;
   v_new:=v_new+1; v_changed:=true;
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object('name',v_name,'before',NULL,'amount',v_amount::text));
  END IF;
 END LOOP;
 IF v_new>20 THEN RAISE EXCEPTION 'invalid_stage_breakdown: too many new sub-stages'; END IF;
 IF cardinality(v_seen)<>jsonb_array_length(c->'substages') THEN RAISE EXCEPTION 'breakdown_incomplete: every sub-stage needs an amount'; END IF;
 IF v_total<>(c->>'stage_amount')::numeric THEN RAISE EXCEPTION 'breakdown_total_mismatch: the sub-stage amounts must add up to the stage price'; END IF;
 IF NOT v_changed AND (c->>'split')::boolean THEN RAISE EXCEPTION 'no_breakdown_changes'; END IF;
 INSERT INTO public.stage_breakdown_proposals(project_id,stage_id,proposed_by,note,currency,stage_amount,base_hash,lines)
 VALUES(s.project_id,p_stage,auth.uid(),nullif(btrim(p_note),''),c->>'currency',(c->>'stage_amount')::numeric,c->>'base_hash',v_lines) RETURNING id INTO v_id;
 PERFORM public.log_activity(s.project_id,'stage_breakdown.proposed','stage_breakdown',v_id,auth.uid(),
  jsonb_build_object('stage_id',p_stage,'stage_number',s.stage_number,'currency',c->>'currency','stage_amount',c->>'stage_amount','lines',v_lines,'new_substages',v_new));
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.propose_stage_breakdown(uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propose_stage_breakdown(uuid,jsonb,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_stage_breakdown(p_proposal uuid,p_decision text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.stage_breakdown_proposals%ROWTYPE;c jsonb;v_project uuid;v_next int;v_status text;v_number int;v_details jsonb;v_prior text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.stage_breakdown_proposals WHERE id=p_proposal;
 IF NOT FOUND THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO a FROM public.stage_breakdown_proposals WHERE id=p_proposal FOR UPDATE;
 IF p_decision IS NULL OR p_decision NOT IN('approved','declined','withdrawn') THEN RAISE EXCEPTION 'invalid_breakdown_decision'; END IF;
 IF p_decision='withdrawn' THEN
  IF a.proposed_by<>auth.uid() THEN RAISE EXCEPTION 'not_proposer'; END IF;
 ELSIF NOT public.is_project_client(v_project) THEN RAISE EXCEPTION 'not_project_client';
 END IF;
 IF a.status=p_decision THEN RETURN; END IF;
 IF a.status<>'pending' THEN RAISE EXCEPTION 'breakdown_proposal_decided'; END IF;
 SELECT status,stage_number INTO v_status,v_number FROM public.project_stages WHERE id=a.stage_id FOR UPDATE;
 IF p_decision='approved' THEN
  PERFORM 1 FROM public.project_substages WHERE stage_id=a.stage_id ORDER BY id FOR UPDATE;
  c:=public.stage_breakdown_context(a.stage_id);
  IF c->>'editable'<>'true' THEN RAISE EXCEPTION 'stage_breakdown_locked: a stage with payments recorded keeps its breakdown'; END IF;
  IF a.base_hash IS DISTINCT FROM c->>'base_hash' THEN RAISE EXCEPTION 'stale_stage_breakdown'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=a.proposed_by AND status='accepted' AND is_primary) THEN
   RAISE EXCEPTION 'proposer_assignment_changed';
  END IF;
  v_prior:=current_setting('app.substage_pricing_write',true);
  PERFORM set_config('app.substage_pricing_write','on',true);
  UPDATE public.project_substages sub SET price_amount=(l.value->>'amount')::numeric
   FROM jsonb_array_elements(a.lines) l WHERE l.value ? 'substage_id' AND sub.id=(l.value->>'substage_id')::uuid AND sub.stage_id=a.stage_id;
  SELECT coalesce(max(substage_number),0) INTO v_next FROM public.project_substages WHERE stage_id=a.stage_id;
  INSERT INTO public.project_substages(id,stage_id,project_id,substage_number,name,status,price_amount,added_by_breakdown)
   SELECT gen_random_uuid(),a.stage_id,a.project_id,v_next+row_number() OVER(ORDER BY x.ord),x.l->>'name',
    CASE WHEN v_status IN('active','pending_review') THEN 'pending' ELSE 'locked' END,(x.l->>'amount')::numeric,a.id
   FROM jsonb_array_elements(a.lines) WITH ORDINALITY x(l,ord) WHERE NOT (x.l ? 'substage_id');
  IF NOT public.stage_breakdown_split(a.stage_id) THEN RAISE EXCEPTION 'breakdown_total_mismatch: the sub-stage amounts must add up to the stage price'; END IF;
  UPDATE public.project_stages SET paid_by_part=true WHERE id=a.stage_id AND NOT paid_by_part;
  PERFORM set_config('app.substage_pricing_write',coalesce(v_prior,'off'),true);
 END IF;
 PERFORM set_config('app.stage_breakdown_decision','on',true);
 UPDATE public.stage_breakdown_proposals SET status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp() WHERE id=p_proposal;
 PERFORM set_config('app.stage_breakdown_decision','off',true);
 v_details:=jsonb_build_object('stage_id',a.stage_id,'stage_number',v_number,'currency',a.currency,'stage_amount',a.stage_amount,'lines',a.lines);
 IF p_decision='approved' THEN
  PERFORM public.log_activity(v_project,'stage_breakdown.approved','stage_breakdown',a.id,auth.uid(),v_details);
 ELSIF p_decision='declined' THEN
  PERFORM public.log_activity(v_project,'stage_breakdown.declined','stage_breakdown',a.id,auth.uid(),v_details);
 ELSE
  PERFORM public.log_activity(v_project,'stage_breakdown.withdrawn','stage_breakdown',a.id,auth.uid(),v_details);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.decide_stage_breakdown(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_stage_breakdown(uuid,text) TO authenticated;

-- A proposal is a record: only its decision changes, and only through the RPC.
CREATE OR REPLACE FUNCTION public.guard_stage_breakdown_proposal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF current_setting('app.stage_breakdown_decision',true) IS DISTINCT FROM 'on'
 OR ROW(NEW.id,NEW.project_id,NEW.stage_id,NEW.proposed_by,NEW.proposed_at,NEW.note,NEW.currency,NEW.stage_amount,NEW.base_hash,NEW.lines)
 IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.stage_id,OLD.proposed_by,OLD.proposed_at,OLD.note,OLD.currency,OLD.stage_amount,OLD.base_hash,OLD.lines)
 THEN RAISE EXCEPTION 'breakdown_proposal_immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stage_breakdown_proposal_guard ON public.stage_breakdown_proposals;
CREATE TRIGGER stage_breakdown_proposal_guard BEFORE UPDATE ON public.stage_breakdown_proposals FOR EACH ROW EXECUTE FUNCTION public.guard_stage_breakdown_proposal();

-- Sub-stage prices change only through an approved breakdown. The owner's own policies
-- still let the app create a project's sub-stages; they never carry a price.
CREATE OR REPLACE FUNCTION public.guard_substage_price() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF current_setting('app.substage_pricing_write',true)='on' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' AND NOT EXISTS(SELECT 1 FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id WHERE s.id=OLD.stage_id) THEN
  -- A cascade from a deleted stage or project: nothing is left to keep consistent.
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.price_amount IS NOT NULL THEN
   RAISE EXCEPTION 'stage_breakdown_requires_approval: a priced sub-stage changes only through an approved breakdown';
  END IF;
  RETURN OLD;
 ELSIF TG_OP='INSERT' THEN
  IF NEW.price_amount IS NOT NULL OR NEW.added_by_breakdown IS NOT NULL
   OR EXISTS(SELECT 1 FROM public.project_substages WHERE stage_id=NEW.stage_id AND price_amount IS NOT NULL) THEN
   RAISE EXCEPTION 'stage_breakdown_requires_approval: a priced sub-stage changes only through an approved breakdown';
  END IF;
 ELSIF NEW.price_amount IS DISTINCT FROM OLD.price_amount OR (NEW.stage_id IS DISTINCT FROM OLD.stage_id AND OLD.price_amount IS NOT NULL)
  -- The link to the proposal that added it is only ever cleared by that proposal's deletion.
  OR (NEW.added_by_breakdown IS DISTINCT FROM OLD.added_by_breakdown AND NOT (NEW.added_by_breakdown IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.stage_breakdown_proposals WHERE id=OLD.added_by_breakdown))) THEN
  RAISE EXCEPTION 'stage_breakdown_requires_approval: a priced sub-stage changes only through an approved breakdown';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_substage_price() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS substage_price_guard ON public.project_substages;
CREATE TRIGGER substage_price_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_substages FOR EACH ROW EXECUTE FUNCTION public.guard_substage_price();

-- A new stage price clears a breakdown that no longer adds up. Checked at commit, once the
-- repricing has also updated the project, so an intermediate state never clears it.
CREATE OR REPLACE FUNCTION public.clear_breakdown_after_price_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_prior text;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.project_stages WHERE id=NEW.id) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.project_substages WHERE stage_id=NEW.id AND price_amount IS NOT NULL) AND NOT public.stage_breakdown_split(NEW.id) THEN
  v_prior:=current_setting('app.substage_pricing_write',true);
  PERFORM set_config('app.substage_pricing_write','on',true);
  UPDATE public.project_substages SET price_amount=NULL WHERE stage_id=NEW.id AND price_amount IS NOT NULL;
  UPDATE public.project_stages SET paid_by_part=false WHERE id=NEW.id AND paid_by_part;
  PERFORM set_config('app.substage_pricing_write',coalesce(v_prior,'off'),true);
  PERFORM public.log_activity(NEW.project_id,'stage_breakdown.cleared','project_stage',NEW.id,auth.uid(),
   jsonb_build_object('stage_id',NEW.id,'stage_number',NEW.stage_number,'reason','stage_price_changed'));
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.clear_breakdown_after_price_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stage_breakdown_follows_price ON public.project_stages;
CREATE CONSTRAINT TRIGGER stage_breakdown_follows_price AFTER UPDATE OF milestone_amount,payment_milestone_usd ON public.project_stages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (ROW(NEW.milestone_amount,NEW.payment_milestone_usd) IS DISTINCT FROM ROW(OLD.milestone_amount,OLD.payment_milestone_usd))
 EXECUTE FUNCTION public.clear_breakdown_after_price_change();

-- The client hears about a proposal; the contractor hears the answer.
CREATE OR REPLACE FUNCTION public.emit_project_event(p_project uuid, p_actor uuid, p_event text, p_key text, p_data jsonb DEFAULT '{}'::jsonb, p_include_actor boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person record;project_name text;stage_no integer;stage_id uuid;tab text;title text;body text;payload jsonb:=coalesce(p_data,'{}');BEGIN
 SELECT name INTO project_name FROM public.projects WHERE id=p_project;
 IF NOT FOUND THEN RETURN; END IF;
 title:=CASE p_event
  WHEN 'project_created' THEN 'Project created'
  WHEN 'project_updated' THEN 'Project updated'
  WHEN 'evidence_uploaded' THEN 'Work update ready for review'
  WHEN 'substage_approved' THEN 'Work update approved'
  WHEN 'stage_review_requested' THEN 'Stage ready for review'
  WHEN 'stage_rework_requested' THEN 'Stage changes requested'
  WHEN 'stage_work_approved' THEN 'Stage work approved'
  WHEN 'stage_approved' THEN 'Stage completed'
  WHEN 'stage_opened' THEN 'Stage ready to begin'
  WHEN 'stage_awaiting_payment' THEN 'Stage payment available'
  WHEN 'stage_payment_settled' THEN 'Stage payment settled'
  WHEN 'receipt_submitted' THEN 'Payment receipt ready for confirmation'
  WHEN 'receipt_replaced' THEN 'Payment receipt replaced'
  WHEN 'receipt_received' THEN 'Payment received'
  WHEN 'receipt_accepted' THEN 'Payment received and work authorized'
  WHEN 'receipt_top_up_requested' THEN 'Additional stage payment requested'
  WHEN 'receipt_flagged' THEN 'Payment receipt needs attention'
  WHEN 'prices_proposed' THEN 'Project prices ready for approval'
  WHEN 'prices_approved' THEN 'Project price changes approved'
  WHEN 'prices_declined' THEN 'Project prices retained'
  WHEN 'prices_withdrawn' THEN 'Price proposal withdrawn'
  WHEN 'payment_plan_proposed' THEN 'Stage payment plan ready for review'
  WHEN 'payment_plan_accepted' THEN 'Stage payment plan accepted'
  WHEN 'payment_plan_declined' THEN 'Stage payment plan needs revision'
  WHEN 'payment_plan_superseded' THEN 'Stage payment plan replaced'
  WHEN 'breakdown_proposed' THEN 'Stage price breakdown ready for approval'
  WHEN 'breakdown_approved' THEN 'Stage price breakdown approved'
  WHEN 'breakdown_declined' THEN 'Stage price breakdown not approved'
  WHEN 'breakdown_withdrawn' THEN 'Stage price breakdown withdrawn'
  WHEN 'progression_authorized' THEN 'Project progression authorized; balance remains recorded'
  WHEN 'member_invited' THEN 'Project invitation created'
  WHEN 'project_link_created' THEN 'Project invitation link created'
  WHEN 'member_joined' THEN 'Project member joined'
  WHEN 'member_removed' THEN 'Project membership updated'
  WHEN 'member_role_changed' THEN 'Project role updated'
  WHEN 'document_added' THEN 'Project document added'
  WHEN 'document_updated' THEN 'Project document updated'
  WHEN 'document_removed' THEN 'Project document removed'
  WHEN 'verification_requested' THEN 'Stage verification requested'
  WHEN 'verification_decided' THEN 'Stage verification reviewed'
  WHEN 'verifier_assigned' THEN 'Project verifier assigned'
  WHEN 'verifier_removed' THEN 'Project verifier assignment updated'
  WHEN 'project_budget_updated' THEN 'Project budget updated'
  WHEN 'project_tracking_started' THEN 'Project tracking started'
  ELSE NULL END;
 IF title IS NULL THEN RETURN; END IF;
 IF payload->>'stage_id' IS NOT NULL THEN
  SELECT s.id,s.stage_number INTO stage_id,stage_no FROM public.project_stages s WHERE s.project_id=p_project AND s.id=(payload->>'stage_id')::uuid;
 ELSIF payload->>'stage_number' ~ '^\d{1,3}$' THEN
  SELECT s.id,s.stage_number INTO stage_id,stage_no FROM public.project_stages s WHERE s.project_id=p_project AND s.stage_number=(payload->>'stage_number')::integer;
 END IF;
 body:=CASE WHEN stage_no IS NULL THEN 'Open “'||coalesce(project_name,'Project')||'” to view this update.'
  ELSE 'Open Stage '||stage_no||' in “'||coalesce(project_name,'Project')||'” to view this update.' END;
 FOR person IN SELECT * FROM public.project_notification_members(p_project) LOOP
  CONTINUE WHEN NOT p_include_actor AND person.user_id IS NOT DISTINCT FROM p_actor;
  tab:=CASE WHEN p_event LIKE 'prices_%' OR p_event='project_budget_updated' THEN CASE WHEN person.role='contractor' THEN 'money' ELSE 'costing' END
   WHEN p_event LIKE 'document_%' THEN 'documents'
   WHEN p_event LIKE 'member_%' OR p_event LIKE 'verifier_%' OR p_event='project_link_created' THEN CASE WHEN person.role='contractor' THEN 'people' ELSE 'team' END
   WHEN stage_no IS NOT NULL THEN CASE WHEN person.role='contractor' THEN 'work' ELSE 'stages' END
   ELSE CASE WHEN person.role='contractor' THEN 'work' ELSE 'overview' END END;
  INSERT INTO public.notifications(user_id,type,title,body,data,title_key,body_key,params,event_key)
  VALUES(person.user_id,'project.'||p_event,title,body,
   jsonb_strip_nulls(payload||jsonb_build_object('project_id',p_project,'role',person.role,'project_tab',tab,'stage_id',stage_id,'stage_number',stage_no,'project_event',p_event)),
   'notifications.events.'||p_event,CASE WHEN stage_no IS NULL THEN 'notifications.projectEventBody' ELSE 'notifications.stageEventBody' END,
   jsonb_build_object('project',coalesce(project_name,'Project'),'stage',stage_no),'project:'||p_key)
  ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.emit_project_event(uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notify_stage_breakdown() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event text;BEGIN
 IF TG_OP='INSERT' THEN event:='breakdown_proposed';
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN event:='breakdown_'||NEW.status;
 ELSE RETURN NEW; END IF;
 PERFORM public.emit_project_event(NEW.project_id,auth.uid(),event,'stage_breakdown_proposals:'||NEW.id||':'||event,
  jsonb_build_object('stage_id',NEW.stage_id,'proposal_id',NEW.id));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_stage_breakdown() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stage_breakdown_notification ON public.stage_breakdown_proposals;
CREATE TRIGGER stage_breakdown_notification AFTER INSERT OR UPDATE ON public.stage_breakdown_proposals FOR EACH ROW EXECUTE FUNCTION public.notify_stage_breakdown();

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='stage_breakdown_proposals') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.stage_breakdown_proposals;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
