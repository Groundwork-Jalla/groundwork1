RESET ROLE;
CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}');
INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'{"full_name":"Fixture","phone":"+1234","signup_intent":"contractor"}' FROM generate_series(1,10) n;
CREATE UNIQUE INDEX test_roles_unique ON public.user_roles(user_id,role);
INSERT INTO public.user_roles VALUES('00000000-0000-0000-0000-000000000004','admin'),('00000000-0000-0000-0000-000000000005','verifier');
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_roles ON public.user_roles FOR SELECT TO authenticated USING(user_id=auth.uid());
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS tracking_started_at timestamptz,ADD COLUMN IF NOT EXISTS joined_at_stage int,
 ADD COLUMN IF NOT EXISTS budget_precision smallint,ADD COLUMN IF NOT EXISTS name text DEFAULT 'Fixture home';
UPDATE projects SET budget_precision=6 WHERE budget_source='boq' AND budget_amount IS NOT NULL;
ALTER TABLE public.project_stages ADD COLUMN IF NOT EXISTS stage_key text,ADD COLUMN IF NOT EXISTS name text DEFAULT 'Stage',
 ADD COLUMN IF NOT EXISTS budget_pct numeric(9,6) DEFAULT 0,ADD COLUMN IF NOT EXISTS fixed_amount_usd numeric;
ALTER TABLE public.contractor_invites ADD COLUMN IF NOT EXISTS is_primary boolean DEFAULT false;
CREATE TABLE public.project_viewers(project_id uuid,user_id uuid,is_client boolean,accepted_at timestamptz,revoked_at timestamptz);
CREATE TABLE public.project_documents(project_id uuid,category text,file_name text);
CREATE TABLE public.project_fees(project_id uuid,kind text,amount_usd numeric);
CREATE TABLE public.project_audit_log(id uuid DEFAULT gen_random_uuid(),project_id uuid,stage_id uuid,action text,actor_id uuid,details jsonb,entity_type text,entity_id uuid,person_id uuid);
CREATE OR REPLACE FUNCTION public.project_member(p_project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT public.is_admin() OR EXISTS(SELECT 1 FROM public.projects WHERE id=p_project AND user_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND contractor_user_id=auth.uid() AND status='accepted')
 OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=p_project AND user_id=auth.uid() AND accepted_at IS NOT NULL AND revoked_at IS NULL);
$$;
ALTER TABLE public.project_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY test_fee_member ON public.project_fees FOR SELECT TO authenticated USING(public.project_member(project_id));
GRANT SELECT ON public.projects,public.project_stages,public.user_roles,public.project_audit_log,public.project_fees TO authenticated;
