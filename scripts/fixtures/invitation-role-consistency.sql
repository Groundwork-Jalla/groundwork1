RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) SELECT test_id(n),n||'@test.example',now() FROM generate_series(20,24) n;
INSERT INTO profiles(id,full_name) SELECT test_id(n),'Invitation test '||n FROM generate_series(20,24) n;
INSERT INTO projects(id,user_id) SELECT test_id(n),test_id(1) FROM generate_series(601,605) n;
INSERT INTO user_roles(user_id,role) VALUES(test_id(20),'homeowner'),(test_id(21),'contractor'),(test_id(22),'verifier'),(test_id(23),'admin');
CREATE TABLE public.test_role_links(project_id uuid PRIMARY KEY,token uuid);
GRANT SELECT,INSERT ON test_role_links TO authenticated;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(1)::text,false);
INSERT INTO test_role_links SELECT test_id(n),(create_project_invitation_link(test_id(n),'contractor')->>'token')::uuid FROM generate_series(601,605) n;

DO $$ DECLARE actor int;expected text;project uuid;tok uuid;BEGIN
 FOR actor IN 20..24 LOOP
  project:=test_id(581+actor);
  SELECT token INTO tok FROM test_role_links WHERE project_id=project;
  PERFORM set_config('test.actor',test_id(actor)::text,true);
  expected:=CASE actor WHEN 20 THEN 'client' WHEN 21 THEN 'contractor' WHEN 22 THEN 'verifier' WHEN 23 THEN 'admin' ELSE 'contractor' END;
  PERFORM test_assert(accept_contractor_invite(tok)=project,'first eligible account joins the intended project');
  PERFORM test_assert(my_account_access()->>'role'=expected,'claim preserves explicit account role and grants a new contractor account when needed');
  PERFORM test_assert(is_primary_project_contractor(project) AND NOT is_project_client(project),'project responsibilities stay separate from account role');
  PERFORM test_assert(EXISTS(SELECT 1 FROM projects WHERE id=project),'new membership is readable through RLS');
 END LOOP;
END $$;

-- Use the actual admin editor RPC, then retry the accepted link through every role.
DO $$ DECLARE selected text;old_roles text;tok uuid;BEGIN
 SELECT token INTO tok FROM test_role_links WHERE project_id=test_id(605);
 FOREACH selected IN ARRAY ARRAY['client','verifier','admin','contractor','client'] LOOP
  SELECT string_agg(role,',' ORDER BY role) INTO old_roles FROM user_roles WHERE user_id=test_id(24);
  PERFORM set_config('test.actor',test_id(4)::text,true);
  PERFORM admin_set_user_role(test_id(24),selected,old_roles);
  PERFORM set_config('test.actor',test_id(24)::text,true);
  PERFORM test_assert(accept_contractor_invite(tok)=test_id(605),'claimant retry is still idempotent after account correction');
  PERFORM test_assert(my_account_access()->>'role'=selected AND (SELECT count(*)=1 FROM user_roles WHERE user_id=test_id(24)),'link retry cannot undo the saved role or add an extra role');
  PERFORM test_assert(is_primary_project_contractor(test_id(605)),'admin correction retains the project assignment');
  PERFORM test_assert((SELECT raw_user_meta_data->>'role'=selected FROM auth.users WHERE id=test_id(24)),'link retries preserve the admin metadata snapshot');
 END LOOP;
END $$;
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT test_refused($q$SELECT accept_contractor_invite((SELECT token FROM test_role_links WHERE project_id=test_id(605)))$q$,'invite_invalid');
SELECT test_assert(NOT project_member(test_id(605)),'another account cannot replay the claimed link');
RESET ROLE;
SELECT test_assert((SELECT bool_and(budget_amount=141407337.524) FROM projects WHERE id IN(SELECT project_id FROM test_role_links)),'claims, corrections and retries never change project budgets');
SELECT 'INVITATION_ROLES_OK' AS result;
