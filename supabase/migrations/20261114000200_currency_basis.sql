-- Identify when a budget conversion was saved, without inventing dates for old rates.
BEGIN;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS budget_fx_recorded_at timestamptz;
ALTER TABLE public.receipt_readings ADD COLUMN IF NOT EXISTS project_fx_recorded_at timestamptz;
ALTER TABLE public.stage_payment_receipts ADD COLUMN IF NOT EXISTS project_fx_recorded_at timestamptz;

CREATE OR REPLACE FUNCTION public.capture_budget_currency_basis()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.budget_fx_recorded_at:=CASE WHEN NEW.budget_currency IS NOT NULL AND NEW.budget_fx_rate>0 THEN clock_timestamp() ELSE NULL END;
 ELSIF ROW(NEW.budget_currency,NEW.budget_fx_rate) IS DISTINCT FROM ROW(OLD.budget_currency,OLD.budget_fx_rate) THEN
  NEW.budget_fx_recorded_at:=CASE WHEN NEW.budget_currency IS NOT NULL AND NEW.budget_fx_rate>0 THEN clock_timestamp() ELSE NULL END;
 ELSE
  NEW.budget_fx_recorded_at:=OLD.budget_fx_recorded_at;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_budget_currency_basis() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS capture_budget_currency_basis ON public.projects;
CREATE TRIGGER capture_budget_currency_basis BEFORE INSERT OR UPDATE ON public.projects
 FOR EACH ROW EXECUTE FUNCTION public.capture_budget_currency_basis();

CREATE OR REPLACE FUNCTION public.attach_receipt_conversion(p_reading uuid,p_rate numeric,p_project_currency text,p_project_rate numeric,p_source text,p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.receipt_readings%ROWTYPE; p public.projects%ROWTYPE; v_rate numeric; v_project_rate numeric; v_code text; v_source text; v_recorded_at timestamptz; BEGIN
 SELECT * INTO r FROM public.receipt_readings WHERE id=p_reading FOR UPDATE;
 IF NOT FOUND OR r.status<>'matched' THEN RAISE EXCEPTION 'receipt_reading_required'; END IF;
 IF r.fx_rate IS NULL THEN
  SELECT * INTO STRICT p FROM public.projects WHERE id=r.project_id;
  IF (p.budget_source='boq' OR p.pricing_revision>0) AND p.budget_currency IS NOT NULL AND p.budget_fx_rate>0 THEN
    v_code:=p.budget_currency; v_project_rate:=p.budget_fx_rate; v_recorded_at:=p.budget_fx_recorded_at;
  ELSE v_code:=p_project_currency; v_project_rate:=p_project_rate; END IF;
  v_rate:=CASE WHEN r.currency=v_code THEN v_project_rate WHEN r.currency='USD' THEN 1 ELSE p_rate END;
  v_source:=CASE WHEN r.currency=v_code THEN 'project' WHEN r.currency='USD' THEN 'USD' ELSE p_source END;
  IF v_rate IS NULL OR v_rate::text IN('NaN','Infinity','-Infinity') OR v_rate<=0 OR v_rate>1e12 OR round(v_rate,12)<=0
    OR v_project_rate IS NULL OR v_project_rate::text IN('NaN','Infinity','-Infinity') OR v_project_rate<=0 OR v_project_rate>1e12
    OR v_code IS NULL OR v_code !~ '^[A-Z]{3}$' OR (v_code='USD' AND v_project_rate<>1)
    OR v_source NOT IN('project','USD','ExchangeRate-API') OR v_source IS NULL OR p_as_of IS NULL OR p_as_of>clock_timestamp()+interval '5 minutes'
    THEN RAISE EXCEPTION 'receipt_rate_unavailable'; END IF;
  IF v_source='ExchangeRate-API' AND p_as_of<clock_timestamp()-interval '48 hours' THEN RAISE EXCEPTION 'receipt_rate_unavailable'; END IF;
  UPDATE public.receipt_readings SET fx_rate=round(v_rate,12),project_currency=v_code,project_fx_rate=round(v_project_rate,12),
   project_fx_recorded_at=v_recorded_at,fx_source=v_source,fx_as_of=p_as_of WHERE id=p_reading RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('fx_rate',r.fx_rate::text,'project_currency',r.project_currency,'project_fx_rate',r.project_fx_rate::text,
  'project_fx_recorded_at',r.project_fx_recorded_at,'fx_source',r.fx_source,'fx_as_of',r.fx_as_of);
END $$;
REVOKE ALL ON FUNCTION public.attach_receipt_conversion(uuid,numeric,text,numeric,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_receipt_conversion(uuid,numeric,text,numeric,text,timestamptz) TO service_role;

-- submit_stage_payment_receipt attaches a reading after inserting its receipt.
-- Copy the date from that proof once, then protect it alongside the existing snapshot.
CREATE OR REPLACE FUNCTION public.capture_receipt_currency_basis_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.reading_id IS NOT NULL THEN
   IF NEW.project_fx_recorded_at IS DISTINCT FROM OLD.project_fx_recorded_at THEN RAISE EXCEPTION 'immutable: receipt conversion date stays recorded'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 NEW.project_fx_recorded_at:=NULL;
 IF NEW.reading_id IS NOT NULL THEN
  SELECT project_fx_recorded_at INTO NEW.project_fx_recorded_at FROM public.receipt_readings WHERE id=NEW.reading_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_receipt_currency_basis_date() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS capture_receipt_currency_basis_date ON public.stage_payment_receipts;
CREATE TRIGGER capture_receipt_currency_basis_date BEFORE INSERT OR UPDATE ON public.stage_payment_receipts
 FOR EACH ROW EXECUTE FUNCTION public.capture_receipt_currency_basis_date();
NOTIFY pgrst,'reload schema';
COMMIT;
