-- Match the deployed legacy stage schema: these fields exist on substages only.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_stages'
   AND column_name IN('approved_by','approved_at')) THEN
   RAISE EXCEPTION 'TEST_FIXTURE_MASKS_MIGRATION: stage approval columns must come from a migration';
 END IF;
 BEGIN
   EXECUTE 'UPDATE public.project_stages SET approved_by=NULL WHERE false';
   RAISE EXCEPTION 'TEST_EXPECTED_UNDEFINED_COLUMN';
 EXCEPTION WHEN undefined_column THEN NULL;
 END;
END $$;
INSERT INTO public.projects(id,user_id,country,budget_source,budget_currency,budget_fx_rate,budget_amount,budget_usd,current_stage,status)
 VALUES(public.test_id(900),'00000000-0000-0000-0000-000000000001','US','boq','USD',1,100.125,100.125,1,'completed');
INSERT INTO public.project_stages(id,project_id,stage_number,status,payment_milestone_usd,milestone_amount,pre_existing,completed_at)
 VALUES(public.test_id(900,1),public.test_id(900),1,'complete',100.125,100.125,true,'2026-11-01T10:00:00Z');
CREATE TEMP TABLE stage_schema_legacy_snapshot AS
 SELECT id,status,payment_milestone_usd,milestone_amount,pre_existing,completed_at FROM public.project_stages WHERE id=public.test_id(900,1);
