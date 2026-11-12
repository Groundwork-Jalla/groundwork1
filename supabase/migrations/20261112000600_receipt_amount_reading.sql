-- A user-entered amount is submitted only with a server-issued reading of that exact file.
BEGIN;
CREATE TABLE public.receipt_readings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stage_id uuid NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, submitted_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 status text NOT NULL DEFAULT 'reading' CHECK(status IN('reading','matched','amount_mismatch','currency_mismatch','unreadable','stale','error')),
 path text, object_id uuid, object_version text, file_sha256 text CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 amount numeric(24,6) CHECK(amount>0 AND amount<=1e12),
 amount_text text CHECK(amount_text ~ '^[0-9]{1,13}(\.[0-9]{1,6})?$' AND amount IS NOT NULL AND amount_text::numeric=amount),
 currency text CHECK(currency ~ '^[A-Z]{3}$'),
 model text, confidence text CHECK(confidence IN('high','medium','low')),
 CHECK(status<>'matched' OR (path IS NOT NULL AND object_id IS NOT NULL AND object_version IS NOT NULL AND file_sha256 IS NOT NULL AND amount IS NOT NULL AND amount_text IS NOT NULL AND currency IS NOT NULL AND confidence IS NOT NULL AND confidence='high'))
);
ALTER TABLE public.receipt_readings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.receipt_readings TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.receipt_readings TO service_role;
CREATE POLICY receipt_reading_owner_read ON public.receipt_readings FOR SELECT TO authenticated USING(submitted_by=auth.uid() OR public.is_admin());
CREATE POLICY receipt_reading_service ON public.receipt_readings FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE INDEX receipt_reading_rate ON public.receipt_readings(submitted_by,created_at);
CREATE UNIQUE INDEX receipt_reading_unique_file ON public.receipt_readings(project_id,file_sha256) WHERE status='matched';
ALTER TABLE public.stage_payment_receipts ADD COLUMN reading_id uuid UNIQUE REFERENCES public.receipt_readings(id);
CREATE OR REPLACE FUNCTION public.reserve_receipt_read(p_stage uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_project uuid; v_id uuid; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('receipt-read:'||p_actor::text,0));
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND OR p_actor IS NULL THEN RAISE EXCEPTION 'invalid_receipt_target'; END IF;
 IF (SELECT count(*) FROM public.receipt_readings WHERE submitted_by=p_actor AND created_at>clock_timestamp()-interval '15 minutes')>=10 THEN
   RAISE EXCEPTION 'receipt_read_rate_limit';
 END IF;
 INSERT INTO public.receipt_readings(stage_id,project_id,submitted_by) VALUES(p_stage,v_project,p_actor) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_receipt_read(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_receipt_read(uuid,uuid) TO service_role;
-- The old five-argument implementation remains private and keeps monetary/role checks.
ALTER FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric) RENAME TO record_stage_payment_receipt;
REVOKE ALL ON FUNCTION public.record_stage_payment_receipt(uuid,text,numeric,text,numeric) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.submit_stage_payment_receipt(p_stage uuid,p_path text,p_amount numeric,p_currency text,p_fx_rate numeric,p_reading uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE proof public.receipt_readings%ROWTYPE; v_object storage.objects%ROWTYPE; v_result jsonb; v_existing public.stage_payment_receipts%ROWTYPE; v_project uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND OR NOT public.is_project_client(v_project) THEN RAISE EXCEPTION 'not_client'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO proof FROM public.receipt_readings WHERE id=p_reading FOR UPDATE;
 IF NOT FOUND OR proof.submitted_by<>auth.uid() OR proof.stage_id<>p_stage OR proof.project_id<>v_project
 OR proof.status<>'matched' OR proof.path<>p_path OR proof.amount IS DISTINCT FROM p_amount OR proof.currency IS DISTINCT FROM p_currency
 THEN RAISE EXCEPTION 'receipt_reading_required: match the amount and currency on the uploaded receipt'; END IF;
 SELECT * INTO v_existing FROM public.stage_payment_receipts WHERE reading_id=p_reading;
 IF FOUND THEN
   IF v_existing.stage_id<>p_stage OR v_existing.path<>p_path OR v_existing.amount IS DISTINCT FROM p_amount OR v_existing.currency IS DISTINCT FROM p_currency THEN RAISE EXCEPTION 'receipt_already_used'; END IF;
   RETURN jsonb_build_object('stage_id',p_stage,'receipt_id',v_existing.id,'already_submitted',true);
 END IF;
 IF proof.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'receipt_reading_expired'; END IF;
 SELECT * INTO v_object FROM storage.objects WHERE bucket_id='evidence' AND name=p_path FOR SHARE;
 IF NOT FOUND OR v_object.id<>proof.object_id OR v_object.version IS DISTINCT FROM proof.object_version THEN RAISE EXCEPTION 'receipt_file_changed: read the current uploaded file'; END IF;
 v_result:=public.record_stage_payment_receipt(p_stage,p_path,p_amount,p_currency,p_fx_rate);
 PERFORM set_config('app.stage_receipt_write','on',true);
 UPDATE public.stage_payment_receipts SET reading_id=p_reading WHERE stage_id=p_stage AND path=p_path;
 PERFORM set_config('app.stage_receipt_write','off',true);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric,uuid) TO authenticated;
-- Older applications receive a refreshable refusal, rather than bypassing the file reading.
CREATE OR REPLACE FUNCTION public.submit_stage_payment_receipt(p_stage uuid,p_path text,p_amount numeric,p_currency text,p_fx_rate numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt_reading_required: use the current receipt upload flow'; END $$;
REVOKE ALL ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric) TO authenticated;
CREATE OR REPLACE FUNCTION public.guard_recorded_receipt_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF OLD.bucket_id='evidence' AND EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE path=OLD.name) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'receipt_file_recorded: retain recorded proof'; END IF;
   IF ROW(NEW.bucket_id,NEW.name,NEW.version,NEW.metadata) IS DISTINCT FROM ROW(OLD.bucket_id,OLD.name,OLD.version,OLD.metadata) THEN
     RAISE EXCEPTION 'receipt_file_recorded: retain recorded proof';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recorded_receipt_file BEFORE UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.guard_recorded_receipt_file();
COMMIT;
