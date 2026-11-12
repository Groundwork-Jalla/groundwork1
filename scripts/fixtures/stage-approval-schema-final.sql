DO $$ DECLARE stage_id uuid; BEGIN
 SELECT id INTO stage_id FROM public.project_stages WHERE approved_by IS NOT NULL LIMIT 1;
 IF stage_id IS NULL THEN RAISE EXCEPTION 'TEST_FAILED: actual approval RPC never persisted its author'; END IF;
 BEGIN
   UPDATE public.project_stages SET approved_by='00000000-0000-0000-0000-000000000002' WHERE id=stage_id;
   RAISE EXCEPTION 'TEST_FAILED: direct approval attribution write succeeded';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'stage_approval_via_rpc:%' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.project_stages s FULL JOIN stage_approval_rerun_snapshot old ON s.id=old.id
   WHERE to_jsonb(s) IS DISTINCT FROM old.saved) THEN
   RAISE EXCEPTION 'TEST_FAILED: rerunning the schema migration changed stage records';
 END IF;
END $$;
