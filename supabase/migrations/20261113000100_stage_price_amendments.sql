-- Contractor proposals become project prices only through primary-client approval.
BEGIN;
ALTER TABLE public.projects
 ADD COLUMN IF NOT EXISTS pricing_revision integer NOT NULL DEFAULT 0 CHECK(pricing_revision>=0),
 ADD COLUMN IF NOT EXISTS budget_original_amount numeric(24,6),
 ADD COLUMN IF NOT EXISTS budget_original_usd numeric(24,9),
 ADD COLUMN IF NOT EXISTS pricing_budget_breakdown jsonb,
 ADD COLUMN IF NOT EXISTS stage_price_adjustment_usd numeric(24,9) NOT NULL DEFAULT 0;

CREATE TABLE public.stage_price_amendments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES public.projects ON DELETE CASCADE,
 proposed_by uuid NOT NULL,proposed_at timestamptz NOT NULL DEFAULT now(),note text CHECK(length(note)<=2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','declined','withdrawn')),
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),fx_rate numeric(24,12) NOT NULL CHECK(fx_rate>0),
 old_total numeric(24,6) NOT NULL CHECK(old_total>0),new_total numeric(24,6) NOT NULL CHECK(new_total>0 AND new_total<=1e12),
 base_hash text NOT NULL,changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='array'),
 decided_by uuid,decided_at timestamptz,
 CHECK((status='pending')=(decided_at IS NULL)),CHECK((decided_at IS NULL)=(decided_by IS NULL))
);
CREATE UNIQUE INDEX stage_price_one_pending ON public.stage_price_amendments(project_id) WHERE status='pending';
ALTER TABLE public.stage_price_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY stage_price_member_read ON public.stage_price_amendments FOR SELECT TO authenticated
 USING(public.is_admin() OR public.project_member(project_id));
GRANT SELECT ON public.stage_price_amendments TO authenticated;

CREATE FUNCTION public.stage_price_editable(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id
 WHERE s.id=p_stage AND p.status='active' AND NOT coalesce(s.pre_existing,false) AND s.status<>'complete'
 AND s.budget_pct>0 AND s.payment_milestone_usd>0 AND coalesce(s.fixed_amount_usd,1)<>0
 AND NOT EXISTS(SELECT 1 FROM public.payments pay WHERE pay.stage_id=s.id AND (pay.direction='out' OR pay.state<>'expected'))
 AND NOT EXISTS(SELECT 1 FROM public.stage_payment_receipts r WHERE r.stage_id=s.id AND r.decision<>'flagged'));
$$;
REVOKE ALL ON FUNCTION public.stage_price_editable(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.stage_pricing_context(p_project uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.projects%ROWTYPE; v_basis jsonb; v_code text; v_rate numeric; v_total numeric; v_rows jsonb; v_hash text;v_history jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_admin() OR public.project_member(p_project)) THEN RAISE EXCEPTION 'project_access_required'; END IF;
 SELECT * INTO p FROM public.projects WHERE id=p_project;
 IF NOT FOUND OR p.tracking_started_at IS NULL OR p.budget_usd IS NULL OR p.budget_usd<=0 THEN RAISE EXCEPTION 'pricing_not_started'; END IF;
 IF (p.budget_source='boq' OR p.pricing_revision>0) AND p.budget_currency IS NOT NULL AND p.budget_fx_rate>0 AND p.budget_amount>0 THEN
   v_code:=p.budget_currency;v_rate:=p.budget_fx_rate;v_total:=p.budget_amount;
 ELSIF p.budget_source='boq' THEN RAISE EXCEPTION 'bill_confirmation_required';
 ELSE
   v_basis:='{"CM":["XAF",600],"CI":["XOF",600],"SN":["XOF",600],"TG":["XOF",600],"BJ":["XOF",600],"NG":["NGN",1600],"GH":["GHS",16],"KE":["KES",130],"UG":["UGX",3700],"TZ":["TZS",2500],"RW":["RWF",1300],"ET":["ETB",57],"ZA":["ZAR",18],"ZM":["ZMW",28],"ZW":["USD",1],"MZ":["MZN",64],"BW":["BWP",14],"CD":["CDF",2800],"MA":["MAD",10],"EG":["EGP",48],"GB":["GBP",0.79],"US":["USD",1]}'::jsonb->upper(coalesce(p.country,''));
   v_code:=coalesce(v_basis->>0,'USD');v_rate:=coalesce((v_basis->>1)::numeric,1);v_total:=round(p.budget_usd*v_rate,6);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'stage_number',s.stage_number,'stage_key',s.stage_key,'name',s.name,
   'amount',(CASE WHEN p.budget_source='boq' OR p.pricing_revision>0 THEN s.milestone_amount ELSE round(s.payment_milestone_usd*v_rate,6) END)::text,
   'usd',s.payment_milestone_usd::text,'status',s.status,'pre_existing',s.pre_existing,'budget_pct',s.budget_pct,
   'fixed_amount_usd',s.fixed_amount_usd,'editable',public.stage_price_editable(s.id)) ORDER BY s.stage_number,s.id),'[]'::jsonb)
 INTO v_rows FROM public.project_stages s WHERE s.project_id=p_project;
 v_hash:=md5(jsonb_build_object('revision',p.pricing_revision,'source',p.budget_source,'currency',v_code,'rate',v_rate,
   'total',v_total,'usd',p.budget_usd,'state',p.status,'stages',v_rows)::text);
 SELECT coalesce(jsonb_agg(item ORDER BY proposed_at DESC,id),'[]'::jsonb) INTO v_history FROM
 (SELECT id,proposed_at,jsonb_build_object('id',id,'status',status,'proposed_at',proposed_at,'note',note,'currency',currency,
 'old_total',old_total::text,'new_total',new_total::text,'changes',changes,'decided_at',decided_at,'stale',base_hash<>v_hash,'can_withdraw',proposed_by=auth.uid() AND status='pending') AS item
 FROM public.stage_price_amendments WHERE project_id=p_project ORDER BY proposed_at DESC,id LIMIT 50) history;
 RETURN jsonb_build_object('project_id',p_project,'currency',v_code,'fx_rate',v_rate::text,'total',v_total::text,'base_hash',v_hash,'stages',v_rows,'history',v_history,
   'can_propose',public.is_primary_project_contractor(p_project) AND NOT public.is_project_client(p_project) AND p.status='active',
   'can_approve',public.is_project_client(p_project) AND p.status='active');
END $$;
REVOKE ALL ON FUNCTION public.stage_pricing_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stage_pricing_context(uuid) TO authenticated;

CREATE FUNCTION public.propose_stage_prices(p_project uuid,p_rows jsonb,p_base_hash text,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; r jsonb; s jsonb; v_changes jsonb:='[]'; v_amount numeric; v_delta numeric:=0; v_id uuid; v_seen uuid[]:='{}'; v_stage uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_primary_project_contractor(p_project) OR public.is_project_client(p_project) THEN RAISE EXCEPTION 'not_primary_contractor'; END IF;
 PERFORM public.lock_project_stage_progression(p_project);
 PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
 PERFORM 1 FROM public.project_stages WHERE project_id=p_project ORDER BY id FOR UPDATE;
 c:=public.stage_pricing_context(p_project);
 IF c->>'can_propose'<>'true' THEN RAISE EXCEPTION 'pricing_paused'; END IF;
 IF p_base_hash IS DISTINCT FROM c->>'base_hash' THEN RAISE EXCEPTION 'stale_stage_prices'; END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100 OR length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid_stage_prices'; END IF;
 IF EXISTS(SELECT 1 FROM public.stage_price_amendments WHERE project_id=p_project AND status='pending') THEN RAISE EXCEPTION 'price_proposal_pending'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
   IF coalesce(r->>'amount','') !~ '^\d+(\.\d{1,6})?$' OR coalesce(r->>'stage_id','') !~ '^[a-fA-F0-9-]{36}$' THEN RAISE EXCEPTION 'invalid_stage_prices'; END IF;
   v_stage:=(r->>'stage_id')::uuid;v_amount:=(r->>'amount')::numeric;
   IF v_stage=ANY(v_seen) OR v_amount<=0 OR v_amount>1e12 OR round(v_amount/(c->>'fx_rate')::numeric,9)<=0 THEN RAISE EXCEPTION 'invalid_stage_prices'; END IF;
   v_seen:=array_append(v_seen,v_stage);
   SELECT value INTO s FROM jsonb_array_elements(c->'stages') WHERE value->>'id'=v_stage::text;
   IF s IS NULL OR s->>'editable'<>'true' THEN RAISE EXCEPTION 'stage_price_locked'; END IF;
   IF v_amount=(s->>'amount')::numeric THEN CONTINUE; END IF;
   v_delta:=v_delta+v_amount-(s->>'amount')::numeric;
   v_changes:=v_changes||jsonb_build_array(jsonb_build_object('stage_id',v_stage,'stage_number',s->'stage_number','stage_key',s->'stage_key','name',s->'name','before',s->>'amount','after',v_amount::text));
 END LOOP;
 IF jsonb_array_length(v_changes)=0 THEN RAISE EXCEPTION 'no_price_changes'; END IF;
 IF (c->>'total')::numeric+v_delta<=0 OR (c->>'total')::numeric+v_delta>1e12 THEN RAISE EXCEPTION 'invalid_project_total'; END IF;
 INSERT INTO public.stage_price_amendments(project_id,proposed_by,note,currency,fx_rate,old_total,new_total,base_hash,changes)
 VALUES(p_project,auth.uid(),nullif(btrim(p_note),''),c->>'currency',(c->>'fx_rate')::numeric,(c->>'total')::numeric,(c->>'total')::numeric+v_delta,c->>'base_hash',v_changes) RETURNING id INTO v_id;
 PERFORM public.log_activity(p_project,'stage_prices.proposed','stage_price_amendment',v_id,auth.uid(),jsonb_build_object('currency',c->>'currency','old_total',c->>'total','new_total',(c->>'total')::numeric+v_delta,'changes',v_changes));
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.propose_stage_prices(uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propose_stage_prices(uuid,jsonb,text,text) TO authenticated;

CREATE FUNCTION public.decide_stage_prices(p_proposal uuid,p_decision text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.stage_price_amendments%ROWTYPE;p public.projects%ROWTYPE;c jsonb;r jsonb;v_project uuid;v_total_usd numeric;v_delta_usd numeric:=0;v_rounding numeric;v_last uuid;v_scale int;v_sum numeric;v_fees jsonb;v_design numeric;v_build numeric;v_breakdown jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.stage_price_amendments WHERE id=p_proposal;
 IF NOT FOUND THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO a FROM public.stage_price_amendments WHERE id=p_proposal FOR UPDATE;
 IF p_decision IS NULL OR p_decision NOT IN('approved','declined','withdrawn') THEN RAISE EXCEPTION 'invalid_price_decision'; END IF;
 IF p_decision='withdrawn' THEN
   IF a.proposed_by<>auth.uid() THEN RAISE EXCEPTION 'not_proposer'; END IF;
 ELSE
   IF NOT public.is_project_client(v_project) THEN RAISE EXCEPTION 'not_project_client'; END IF;
 END IF;
 IF a.status=p_decision THEN RETURN; END IF;
 IF a.status<>'pending' THEN RAISE EXCEPTION 'price_proposal_decided'; END IF;
 IF p_decision='approved' THEN
   SELECT * INTO p FROM public.projects WHERE id=v_project FOR UPDATE;
   PERFORM 1 FROM public.project_stages WHERE project_id=v_project ORDER BY id FOR UPDATE;
   c:=public.stage_pricing_context(v_project);
   IF c->>'can_approve'<>'true' THEN RAISE EXCEPTION 'pricing_paused'; END IF;
   IF a.base_hash IS DISTINCT FROM c->>'base_hash' THEN RAISE EXCEPTION 'stale_stage_prices'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=a.proposed_by AND status='accepted' AND is_primary) THEN RAISE EXCEPTION 'proposer_assignment_changed'; END IF;
   v_scale:=coalesce(p.budget_precision,0);
   FOR r IN SELECT * FROM jsonb_array_elements(a.changes) LOOP
     IF NOT public.stage_price_editable((r->>'stage_id')::uuid) THEN RAISE EXCEPTION 'stage_price_locked'; END IF;
     SELECT v_delta_usd+round((r->>'after')::numeric/a.fx_rate,9)-payment_milestone_usd INTO v_delta_usd FROM public.project_stages WHERE id=(r->>'stage_id')::uuid;
     v_scale:=greatest(v_scale,scale((r->>'after')::numeric));
   END LOOP;
   v_total_usd:=round(a.new_total/a.fx_rate,9);
   IF p.budget_source IS DISTINCT FROM 'boq' THEN
     SELECT coalesce(jsonb_object_agg(kind,amount_usd),'{}'::jsonb) INTO v_fees FROM public.project_fees WHERE project_id=v_project;
     SELECT coalesce(sum(payment_milestone_usd),0) INTO v_design FROM public.project_stages WHERE project_id=v_project AND budget_pct=0;
     v_build:=v_total_usd-v_design-coalesce((v_fees->>'permit')::numeric,0)-coalesce((v_fees->>'professional')::numeric,0)-coalesce((v_fees->>'verification')::numeric,0)-coalesce((v_fees->>'contingency')::numeric,0);
     IF v_build<=0 THEN RAISE EXCEPTION 'invalid_project_total'; END IF;
     v_breakdown:=jsonb_build_object('total',v_total_usd,'construction',v_build,'design',v_design,
       'permit',coalesce((v_fees->>'permit')::numeric,0),'professional',coalesce((v_fees->>'professional')::numeric,0),
       'verification',coalesce((v_fees->>'verification')::numeric,0),'contingency',coalesce((v_fees->>'contingency')::numeric,0),
       'material',round(v_build*0.6,2),'labor',v_build-round(v_build*0.6,2));
   END IF;
   v_rounding:=v_total_usd-p.budget_usd-v_delta_usd;
   SELECT (value->>'stage_id')::uuid INTO v_last FROM jsonb_array_elements(a.changes) ORDER BY (value->>'after')::numeric DESC,value->>'stage_id' LIMIT 1;
   PERFORM set_config('app.stage_pricing_write','on',true);
   UPDATE public.project_stages s SET milestone_amount=(entry.value->>'after')::numeric,
     payment_milestone_usd=round((entry.value->>'after')::numeric/a.fx_rate,9)+CASE WHEN s.id=v_last THEN v_rounding ELSE 0 END
     FROM jsonb_array_elements(a.changes) entry WHERE s.id=(entry.value->>'stage_id')::uuid;
   -- Freeze native values for earlier estimate stages without changing their USD history.
   UPDATE public.project_stages SET milestone_amount=round(payment_milestone_usd*a.fx_rate,6) WHERE project_id=v_project AND milestone_amount IS NULL;
   IF p.budget_source='boq' THEN
     UPDATE public.project_stages SET budget_pct=CASE WHEN milestone_amount=0 THEN 0 ELSE greatest(0.000001,round(milestone_amount/a.new_total*100,6)) END WHERE project_id=v_project;
     SELECT sum(budget_pct) INTO v_sum FROM public.project_stages WHERE project_id=v_project;
     UPDATE public.project_stages SET budget_pct=budget_pct+100-v_sum WHERE id=(SELECT id FROM public.project_stages WHERE project_id=v_project ORDER BY milestone_amount DESC,id LIMIT 1);
   END IF;
   UPDATE public.projects SET budget_original_amount=coalesce(budget_original_amount,a.old_total),budget_original_usd=coalesce(budget_original_usd,p.budget_usd),
     budget_amount=a.new_total,budget_currency=a.currency,budget_fx_rate=a.fx_rate,budget_precision=least(6,v_scale),budget_usd=v_total_usd,
     stage_price_adjustment_usd=stage_price_adjustment_usd+v_total_usd-p.budget_usd,pricing_budget_breakdown=v_breakdown,pricing_revision=pricing_revision+1 WHERE id=v_project;
   PERFORM set_config('app.stage_pricing_write','off',true);
 END IF;
 PERFORM set_config('app.stage_price_decision','on',true);
 UPDATE public.stage_price_amendments SET status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp() WHERE id=p_proposal;
 PERFORM set_config('app.stage_price_decision','off',true);
 PERFORM public.log_activity(v_project,'stage_prices.'||p_decision,'stage_price_amendment',a.id,auth.uid(),jsonb_build_object('currency',a.currency,'old_total',a.old_total,'new_total',a.new_total));
END $$;
REVOKE ALL ON FUNCTION public.decide_stage_prices(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_stage_prices(uuid,text) TO authenticated;

CREATE FUNCTION public.guard_stage_price_decision() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF current_setting('app.stage_price_decision',true) IS DISTINCT FROM 'on'
 OR ROW(NEW.id,NEW.project_id,NEW.proposed_by,NEW.proposed_at,NEW.note,NEW.currency,NEW.fx_rate,NEW.old_total,NEW.new_total,NEW.base_hash,NEW.changes)
 IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.proposed_by,OLD.proposed_at,OLD.note,OLD.currency,OLD.fx_rate,OLD.old_total,OLD.new_total,OLD.base_hash,OLD.changes)
 THEN RAISE EXCEPTION 'price_proposal_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stage_price_decision_guard BEFORE UPDATE ON public.stage_price_amendments FOR EACH ROW EXECUTE FUNCTION public.guard_stage_price_decision();

CREATE FUNCTION public.guard_approved_project_prices() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_revision int; BEGIN
 IF TG_TABLE_NAME='projects' THEN
   IF (OLD.pricing_revision>0 OR NEW.pricing_revision>0 OR NEW.budget_original_amount IS DISTINCT FROM OLD.budget_original_amount OR NEW.budget_original_usd IS DISTINCT FROM OLD.budget_original_usd OR NEW.stage_price_adjustment_usd IS DISTINCT FROM OLD.stage_price_adjustment_usd OR NEW.pricing_budget_breakdown IS DISTINCT FROM OLD.pricing_budget_breakdown)
   AND ROW(NEW.pricing_revision,NEW.budget_amount,NEW.budget_currency,NEW.budget_fx_rate,NEW.budget_precision,NEW.budget_usd,NEW.budget_original_amount,NEW.budget_original_usd,NEW.stage_price_adjustment_usd,NEW.budget_source,NEW.pricing_budget_breakdown)
   IS DISTINCT FROM ROW(OLD.pricing_revision,OLD.budget_amount,OLD.budget_currency,OLD.budget_fx_rate,OLD.budget_precision,OLD.budget_usd,OLD.budget_original_amount,OLD.budget_original_usd,OLD.stage_price_adjustment_usd,OLD.budget_source,OLD.pricing_budget_breakdown)
   AND current_setting('app.stage_pricing_write',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'prices_require_client_approval'; END IF;
 ELSE
   SELECT pricing_revision INTO v_revision FROM public.projects WHERE id=OLD.project_id;
   IF v_revision>0 AND ROW(NEW.milestone_amount,NEW.payment_milestone_usd,NEW.budget_pct,NEW.fixed_amount_usd) IS DISTINCT FROM ROW(OLD.milestone_amount,OLD.payment_milestone_usd,OLD.budget_pct,OLD.fixed_amount_usd)
   AND current_setting('app.stage_pricing_write',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'prices_require_client_approval'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER approved_project_prices BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.guard_approved_project_prices();
CREATE TRIGGER approved_stage_prices BEFORE UPDATE OF milestone_amount,payment_milestone_usd,budget_pct,fixed_amount_usd ON public.project_stages FOR EACH ROW EXECUTE FUNCTION public.guard_approved_project_prices();

-- Exact native prices now govern approved variations; percentages describe their shares.
CREATE OR REPLACE FUNCTION public.check_boq_budget_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;p public.projects%ROWTYPE;v_pct numeric;v_epsilon numeric;
BEGIN
 v_id:=CASE WHEN TG_TABLE_NAME='projects' THEN CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END ELSE CASE WHEN TG_OP='DELETE' THEN OLD.project_id ELSE NEW.project_id END END;
 SELECT * INTO p FROM public.projects WHERE id=v_id;
 IF NOT FOUND OR p.budget_source IS DISTINCT FROM 'boq' OR p.tracking_started_at IS NULL THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.project_fees WHERE project_id=v_id AND amount_usd<>0) THEN RAISE EXCEPTION 'boq_has_no_platform_fees'; END IF;
 IF p.budget_amount IS NULL THEN RETURN NULL; END IF;
 SELECT sum(budget_pct),greatest(1,count(*))*0.000000001 INTO v_pct,v_epsilon FROM public.project_stages WHERE project_id=v_id;
 IF p.budget_usd<>round(p.budget_amount/p.budget_fx_rate,9) OR v_pct IS NULL OR abs(v_pct-100)>0.0001
 OR coalesce((SELECT sum(milestone_amount) FROM public.project_stages WHERE project_id=v_id),0)<>p.budget_amount
 OR coalesce((SELECT sum(payment_milestone_usd) FROM public.project_stages WHERE project_id=v_id),0)<>p.budget_usd
 OR EXISTS(SELECT 1 FROM public.project_stages WHERE project_id=v_id AND (milestone_amount IS NULL OR payment_milestone_usd IS NULL OR milestone_amount<0 OR payment_milestone_usd<0 OR budget_pct<0
 OR abs(payment_milestone_usd-round(milestone_amount/p.budget_fx_rate,9))>CASE WHEN p.pricing_revision>0 THEN v_epsilon ELSE 0.000000001 END
 OR (p.pricing_revision=0 AND abs(milestone_amount-p.budget_amount*budget_pct/nullif(v_pct,0))>power(10::numeric,-p.budget_precision))
 OR (budget_pct=0 AND (milestone_amount<>0 OR payment_milestone_usd<>0)))) THEN RAISE EXCEPTION 'boq_stage_total_mismatch'; END IF;
 RETURN NULL;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.stage_price_amendments; END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
