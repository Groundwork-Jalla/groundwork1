DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='project_stages'
   AND ((column_name='approved_by' AND data_type='uuid') OR (column_name='approved_at' AND data_type='timestamp with time zone')) AND is_nullable='YES')<>2 THEN
   RAISE EXCEPTION 'TEST_FAILED: approval metadata types or nullability';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.project_stages s JOIN stage_schema_legacy_snapshot old USING(id)
   WHERE ROW(s.status,s.payment_milestone_usd,s.milestone_amount,s.pre_existing,s.completed_at)
     IS NOT DISTINCT FROM ROW(old.status,old.payment_milestone_usd,old.milestone_amount,old.pre_existing,old.completed_at)
     AND s.approved_by IS NULL AND s.approved_at IS NULL) THEN
   RAISE EXCEPTION 'TEST_FAILED: schema repair changed history or invented approval';
 END IF;
END $$;
-- The same real approval RPC now succeeds; a stage that predates the repair is retained.
DO $$ DECLARE old_actor text:=current_setting('test.actor',true); r jsonb; BEGIN
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000004',true);
 r:=public.approve_stage(public.test_id(900,2));
 IF NOT EXISTS(SELECT 1 FROM public.project_stages WHERE id=public.test_id(900,2)
   AND status='complete' AND approved_by='00000000-0000-0000-0000-000000000004' AND approved_at IS NOT NULL)
   OR r->>'is_final'<>'true' THEN RAISE EXCEPTION 'TEST_FAILED: approval RPC did not recover after the schema repair'; END IF;
 PERFORM set_config('test.actor',coalesce(old_actor,''),true);
END $$;

-- Keep this setup regression out of the later workflow audit-count assertions.
DELETE FROM public.test_activity WHERE project_id=public.test_id(900);
