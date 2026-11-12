-- Approval RPCs record the approver on both the work item and its stage.
-- 004 added these columns only to project_substages; restore the missing stage DDL.
BEGIN;
ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

COMMENT ON COLUMN public.project_stages.approved_by IS
 'Authenticated client/staff member who approved the stage work. NULL when no stage approval was recorded, including historical work.';
COMMENT ON COLUMN public.project_stages.approved_at IS
 'When stage work was approved. A contractor-created first stage can await payment after this approval. Existing unknown dates remain NULL.';

-- The browser may read approval attribution; the approval RPCs own its writes.
CREATE OR REPLACE FUNCTION public.guard_stage_approval_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_changed boolean; BEGIN
 IF TG_OP='INSERT' THEN
   v_changed:=NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL;
 ELSE
   v_changed:=NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at;
 END IF;
 IF NOT v_changed THEN RETURN NEW; END IF;
 IF current_setting('app.approve_stage',true)='on' THEN RETURN NEW; END IF;
 IF current_setting('app.join_in_progress',true)='on' AND coalesce(NEW.pre_existing,false)
   AND NEW.approved_by IS NULL AND NEW.approved_at IS NULL THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'stage_approval_via_rpc: record stage approval through the approval workflow';
END $$;
DROP TRIGGER IF EXISTS stage_approval_metadata_guard ON public.project_stages;
CREATE TRIGGER stage_approval_metadata_guard
 BEFORE INSERT OR UPDATE OF approved_by,approved_at ON public.project_stages
 FOR EACH ROW EXECUTE FUNCTION public.guard_stage_approval_metadata();

NOTIFY pgrst, 'reload schema';
COMMIT;
