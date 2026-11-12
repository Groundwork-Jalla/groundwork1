-- Install the existing approval functions first, as on the reported deployment.
-- The final approval fails with 42703 until the stage metadata DDL is applied.
DO $$ DECLARE old_actor text:=current_setting('test.actor',true); BEGIN
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000004',true);
 BEGIN
   PERFORM public.approve_stage(public.test_id(900,2));
   RAISE EXCEPTION 'TEST_FAILED: expected the deployed undefined-column approval failure';
 EXCEPTION WHEN undefined_column THEN NULL;
 END;
 IF (SELECT status FROM public.project_stages WHERE id=public.test_id(900,2))<>'active' THEN
   RAISE EXCEPTION 'TEST_FAILED: failed approval partially changed stage progress';
 END IF;
 PERFORM set_config('test.actor',coalesce(old_actor,''),true);
END $$;
