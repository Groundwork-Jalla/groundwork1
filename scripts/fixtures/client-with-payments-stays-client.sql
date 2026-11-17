-- 20261117000100: an administrator cannot turn a paying client into a contractor.
RESET ROLE;
SELECT set_config('test.actor',test_id(4)::text,false);
SELECT test_assert(public.is_admin(),'the fixture administrator is recognised');
-- The harness has no receipt tables; the rule must not depend on them being there.
SELECT test_assert(public.client_payment_projects(test_id(71))=0,'no payment tables means no payment history, not an error');
CREATE TABLE public.stage_payment_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,submitted_by uuid);
CREATE TABLE public.stage_payment_plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,proposed_by uuid);
INSERT INTO auth.users(id,email) VALUES(test_id(71),'paid@test.example'),(test_id(72),'fresh@test.example'),(test_id(73),'planned@test.example'),(test_id(74),'both@test.example')
 ON CONFLICT DO NOTHING;
INSERT INTO public.stage_payment_receipts(project_id,submitted_by) VALUES(test_id(801),test_id(71)),(test_id(801),test_id(71)),(test_id(802),test_id(71));
INSERT INTO public.stage_payment_plans(project_id,proposed_by) VALUES(test_id(803),test_id(73));
SELECT test_assert(public.client_payment_projects(test_id(71))=2 AND public.client_payment_projects(test_id(73))=1 AND public.client_payment_projects(test_id(72))=0,
 'payment history counts distinct projects with a receipt or a proposed plan');

-- The administrator changing somebody else's account.
SELECT test_refused($q$INSERT INTO public.user_roles(user_id,role) VALUES(test_id(71),'contractor')$q$,'client_payment_history');
SELECT test_refused($q$INSERT INTO public.user_roles(user_id,role) VALUES(test_id(73),'contractor')$q$,'client_payment_history');
SELECT test_refused($q$SELECT public.admin_set_user_role(test_id(71),'contractor','')$q$,'client_payment_history');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id IN(test_id(71),test_id(73)) AND role='contractor'),'a refused change leaves no contractor role behind');
-- Somebody who signed up as a client by mistake and has paid nothing: the tool still works.
SELECT public.admin_set_user_role(test_id(72),'contractor','');
SELECT test_assert(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=test_id(72) AND role='contractor'),'an account with no payment history is still corrected to contractor');
-- Other role changes for a paying client are not this rule's business.
INSERT INTO public.user_roles(user_id,role) VALUES(test_id(71),'verifier');
DELETE FROM public.user_roles WHERE user_id=test_id(71) AND role='verifier';

-- A person acting on their own account is not an administrator changing a role.
SELECT set_config('test.actor',test_id(71)::text,false);
INSERT INTO public.user_roles(user_id,role) VALUES(test_id(71),'contractor');
SELECT test_assert(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=test_id(71) AND role='contractor'),'registering yourself as a contractor is unaffected');
-- An account that is already a contractor is left alone, whoever touches it.
SELECT set_config('test.actor',test_id(4)::text,false);
INSERT INTO public.stage_payment_receipts(project_id,submitted_by) VALUES(test_id(804),test_id(72));
INSERT INTO public.user_roles(user_id,role) VALUES(test_id(72),'contractor') ON CONFLICT DO NOTHING;
-- With no signed-in person at all (a server job), nothing is refused.
SELECT set_config('test.actor','',false);
INSERT INTO public.stage_payment_receipts(project_id,submitted_by) VALUES(test_id(805),test_id(74));
INSERT INTO public.user_roles(user_id,role) VALUES(test_id(74),'contractor');
SELECT 'CLIENT_PAYMENT_GUARD_OK' AS result;
