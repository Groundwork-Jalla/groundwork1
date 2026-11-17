-- 20261117000200: the permission to call or text a person.
RESET ROLE;
SELECT set_config('test.actor','',false);
INSERT INTO public.profiles(id,full_name) VALUES(test_id(91),'Asked at signup'),(test_id(92),'Asked at sign-in'),(test_id(93),'Never asked') ON CONFLICT DO NOTHING;
GRANT SELECT,UPDATE ON public.profiles TO authenticated;
-- Production's own-row update policy (001_profiles). Without it every direct update here
-- would match no row and the guard below would never be reached.
CREATE POLICY contact_fixture_own_update ON public.profiles FOR UPDATE USING(id=auth.uid());
SELECT test_assert((SELECT bool_and(contact_permission IS NULL AND contact_permission_at IS NULL AND contact_permission_source IS NULL) FROM public.profiles),
 'every existing account starts unanswered, never assumed to be a yes or a no');
SET ROLE authenticated;

-- A new account: the signup answer is recorded once.
SELECT set_config('test.actor',test_id(91)::text,false);
SELECT public.set_contact_permission(true,'signup');
SELECT test_assert((SELECT contact_permission AND contact_permission_source='signup' AND contact_permission_at IS NOT NULL FROM public.profiles WHERE id=test_id(91)),'the signup answer is recorded with where it was given');
-- The person later says no in their profile; the signup answer, replayed from another browser, must not undo it.
SELECT public.set_contact_permission(false,'profile');
SELECT public.set_contact_permission(true,'signup');
SELECT test_assert((SELECT NOT contact_permission AND contact_permission_source='profile' FROM public.profiles WHERE id=test_id(91)),'a replayed signup answer never overrides a later choice');
-- Repeating the same answer changes nothing and records nothing new.
SELECT public.set_contact_permission(false,'profile');

-- An existing account answers the one-time question after signing in.
SELECT set_config('test.actor',test_id(92)::text,false);
SELECT public.set_contact_permission(false,'sign_in');
SELECT test_assert((SELECT contact_permission=false AND contact_permission_source='sign_in' FROM public.profiles WHERE id=test_id(92)),'a no is recorded as a no');
SELECT public.set_contact_permission(true,'profile');
SELECT test_assert((SELECT contact_permission AND contact_permission_source='profile' FROM public.profiles WHERE id=test_id(92)),'the person can change their mind');

-- Only the person themselves, only through the function.
SELECT test_refused($q$UPDATE public.profiles SET contact_permission=false WHERE id=test_id(92)$q$,'contact_permission_via_rpc');
SELECT test_refused($q$UPDATE public.profiles SET contact_permission_at='2020-01-01' WHERE id=test_id(92)$q$,'contact_permission_via_rpc');
UPDATE public.profiles SET full_name='Asked at sign-in, renamed' WHERE id=test_id(92);
-- An answer written for somebody else matches no row under the policy, and is never seen.
UPDATE public.profiles SET full_name='Renamed by somebody else' WHERE id=test_id(93);
SELECT test_assert((SELECT full_name='Asked at sign-in, renamed' AND contact_permission FROM public.profiles WHERE id=test_id(92)),'other profile edits are unaffected');
SELECT test_refused($q$SELECT public.set_contact_permission(NULL,'profile')$q$,'invalid_contact_permission');
SELECT test_refused($q$SELECT public.set_contact_permission(true,'admin')$q$,'invalid_contact_permission');
-- Nobody can answer for somebody else: the function only ever writes the caller's own row.
SELECT set_config('test.actor','',false);
SELECT test_refused($q$SELECT public.set_contact_permission(true,'profile')$q$,'not_signed_in');
SET ROLE anon;
SELECT test_refused($q$SELECT public.set_contact_permission(true,'profile')$q$,'permission denied');
RESET ROLE;
SELECT test_assert((SELECT contact_permission IS NULL AND full_name='Never asked' FROM public.profiles WHERE id=test_id(93)),'nobody can answer for, or edit, another person');
-- Read as the owner: the audit log is not readable to a person for a row with no project.
SELECT test_assert((SELECT count(*) FROM public.project_audit_log WHERE entity_id=test_id(91) AND action='account.contact_permission_changed')=2,'only real changes are logged');
SELECT 'CONTACT_PERMISSION_OK' AS result;
