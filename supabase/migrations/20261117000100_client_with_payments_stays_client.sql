-- An account that has recorded payments as a client cannot be turned into a contractor
-- account by an administrator.
--
-- Agreed in the 16 November product session. The role-change tool exists for somebody
-- who signed up as a client by mistake and has done nothing yet. Used on an account that
-- has uploaded receipts or agreed a payment plan, it moved the person to the contractor
-- dashboard while their projects still held them as the paying client: the receipts and
-- plans stayed, the person who could act on them did not.
--
-- ── Where the rule lives ─────────────────────────────────────────────────────────────
-- Every path that makes an account a contractor inserts a `contractor` row into
-- `user_roles`: both admin editors, self-registration and accepting an invitation. The
-- rule is held on that insert and applies only when an ADMINISTRATOR is changing SOMEBODY
-- ELSE'S account, which is exactly the role-change tool and nothing else. A person who
-- registers as a contractor themselves, or accepts a contractor invitation, is acting on
-- their own account and is not affected; neither is an account that is already a
-- contractor.
--
-- Changes no existing role, project, receipt or plan.
BEGIN;

-- How many projects this person has recorded a payment action on as the client: a
-- receipt uploaded, a payment plan proposed, or an older single-receipt upload. Creating
-- or approving a project is not counted: somebody who signed up as a client by mistake
-- may well have done both, and that is who the role change is for.
CREATE OR REPLACE FUNCTION public.client_payment_projects(p_user uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ids uuid[]:='{}';v_more uuid[];BEGIN
 IF p_user IS NULL THEN RETURN 0; END IF;
 IF to_regclass('public.stage_payment_receipts') IS NOT NULL THEN
  EXECUTE 'SELECT coalesce(array_agg(DISTINCT project_id),''{}'') FROM public.stage_payment_receipts WHERE submitted_by=$1' INTO v_more USING p_user;
  v_ids:=v_ids||v_more;
 END IF;
 IF to_regclass('public.stage_payment_plans') IS NOT NULL THEN
  EXECUTE 'SELECT coalesce(array_agg(DISTINCT project_id),''{}'') FROM public.stage_payment_plans WHERE proposed_by=$1' INTO v_more USING p_user;
  v_ids:=v_ids||v_more;
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='receipt_uploaded_by') THEN
  EXECUTE 'SELECT coalesce(array_agg(DISTINCT project_id),''{}'') FROM public.payments WHERE receipt_uploaded_by=$1' INTO v_more USING p_user;
  v_ids:=v_ids||v_more;
 END IF;
 RETURN (SELECT count(DISTINCT id) FROM unnest(v_ids) AS id WHERE id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.client_payment_projects(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.guard_client_becoming_contractor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_projects integer;BEGIN
 IF NEW.role='contractor' AND auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM NEW.user_id AND public.is_admin()
   AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=NEW.user_id AND role='contractor') THEN
  v_projects:=public.client_payment_projects(NEW.user_id);
  IF v_projects>0 THEN
   RAISE EXCEPTION 'client_payment_history: this account has recorded payments as a client on % project(s) and cannot be changed to a contractor account',v_projects;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_client_becoming_contractor() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS user_roles_client_payment_guard ON public.user_roles;
CREATE TRIGGER user_roles_client_payment_guard BEFORE INSERT ON public.user_roles
 FOR EACH ROW EXECUTE FUNCTION public.guard_client_becoming_contractor();

NOTIFY pgrst,'reload schema';
COMMIT;
