-- Run after the existing project-team fixture, against the actual link migration.
RESET ROLE;
INSERT INTO projects(id,user_id) SELECT test_id(n),test_id(CASE WHEN n IN(202,205,208) THEN 2 ELSE 1 END) FROM generate_series(201,208) n;
INSERT INTO contractor_invites(project_id,invited_by,email,status,accepted_at,contractor_user_id,is_primary)
 SELECT test_id(n),test_id(2),'2@test.example','accepted',now(),test_id(2),true FROM unnest(ARRAY[202,205,208]) n;
CREATE TABLE public.test_links(project_id uuid PRIMARY KEY,token uuid NOT NULL,kind text);
GRANT SELECT,INSERT,UPDATE ON test_links TO authenticated;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(1)::text,false);
INSERT INTO test_links SELECT test_id(201),(create_project_invitation_link(test_id(201),'observer')->>'token')::uuid,'viewer';
SELECT test_assert((create_project_invitation_link(test_id(201),'observer')->>'token')::uuid=(SELECT token FROM test_links WHERE project_id=test_id(201)),'creation retry returns the same pending link');
SELECT test_assert((SELECT email IS NULL AND expires_at>now()+interval '6 days' FROM project_viewers WHERE project_id=test_id(201)),'bearer link has no nominated email and a seven-day expiry');
SELECT test_refused($q$SELECT create_project_invitation_link(test_id(201),'admin')$q$,'invalid_role');
SELECT test_refused($q$SELECT create_project_invitation_link(test_id(201),'client')$q$,'not_permitted');
SELECT test_refused($q$SELECT expire_project_invitation_links(test_id(201))$q$,'permission denied');
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(201)))$q$,'already_member');
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT test_refused($q$SELECT create_project_invitation_link(test_id(201),'observer')$q$,'not_permitted');
RESET ROLE;
SELECT set_config('test.actor','',false);
SELECT test_assert((SELECT NOT accepted AND NOT is_client AND is_share_link FROM project_viewer_preview((SELECT token FROM test_links WHERE project_id=test_id(201)))),'public preview states the role without consuming the link');
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(201)))$q$,'not_signed_in');
SELECT test_assert((SELECT accepted_at IS NULL FROM project_viewers WHERE project_id=test_id(201)),'opening and rejected acceptance leave link available');
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(9)::text,false);
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(201)))$q$,'invitation_email_unverified');
SELECT set_config('test.actor',test_id(3)::text,false);
SELECT test_assert(accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(201)))=test_id(201),'first verified account claims observer link');
SELECT test_assert(accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(201)))=test_id(201),'same-account response retry is safe');
SELECT test_assert((SELECT count(*) FROM projects WHERE id=test_id(201))=1,'claimed project immediately readable under real RLS');
SELECT test_assert((SELECT user_id=test_id(3) AND email='3@test.example' FROM project_viewers WHERE project_id=test_id(201)),'membership stores the real claimant and verified email');
SELECT test_assert(NOT can_invite_project_people(test_id(201)) AND NOT can_edit_project_boq(test_id(201)) AND NOT is_project_client(test_id(201)),'observer cannot approve, author BQ or invite');
SELECT test_assert(project_team_access(test_id(201))->>'project_role'='observer','observer identity is explicit in permissions');
SELECT test_assert((SELECT role='observer' FROM project_participants(test_id(201)) WHERE user_id=test_id(3)),'observer appears in chat and notification roster');
UPDATE project_viewers SET is_client=true WHERE project_id=test_id(201);
-- The preceding zero-row write must not grant approvals.
SELECT test_assert(NOT is_project_client(test_id(201)),'direct membership writes remain unavailable');
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(201)))$q$,'already_accepted');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM project_viewer_preview((SELECT token FROM test_links WHERE project_id=test_id(201)))),'claimed link is hidden from a second account');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM projects WHERE id=test_id(201)),'second account gains no project access');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM project_participants(test_id(201))),'outsider cannot enumerate participant identities');

-- Account role never turns a project observer into a contractor.
SELECT set_config('test.actor',test_id(1)::text,false);
UPDATE test_links SET token=(create_project_invitation_link(test_id(201),'observer')->>'token')::uuid WHERE project_id=test_id(201);
SELECT set_config('test.actor',test_id(7)::text,false);
SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(201)));
SELECT test_assert(project_team_access(test_id(201))->>'project_role'='observer' AND NOT is_contractor_on(test_id(201),test_id(7)),'global contractor remains observer on the shared project');
SELECT test_assert((SELECT role='observer' FROM project_participants(test_id(201)) WHERE user_id=test_id(7)),'global contractor is labelled observer in this project');
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT revoke_project_viewer((SELECT id FROM project_viewers WHERE project_id=test_id(201) AND user_id=test_id(7)));
SELECT set_config('test.actor',test_id(7)::text,false);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM projects WHERE id=test_id(201)),'observer revocation removes access');
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(201)))$q$,'revoked');

-- A contractor-created project's client link grants only that intended primary role.
SELECT set_config('test.actor',test_id(2)::text,false);
INSERT INTO test_links SELECT test_id(202),(create_project_invitation_link(test_id(202),'client')->>'token')::uuid,'viewer';
SELECT test_assert(NOT (project_team_access(test_id(202))->>'can_invite_client')::boolean,'pending client link reserves the primary role');
SELECT test_refused($q$SELECT invite_project_viewer(test_id(202),'8@test.example',NULL,true)$q$,'not_permitted');
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(202)))$q$,'already_member');
SELECT set_config('test.actor',test_id(6)::text,false);
SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(202)));
SELECT test_assert(is_project_client(test_id(202)) AND can_invite_project_people(test_id(202)),'client claimant gets client workflow rights');
RESET ROLE;
INSERT INTO contractor_invites(project_id,invited_by,email,status,accepted_at,contractor_user_id,is_primary) VALUES(test_id(202),test_id(1),'6@test.example','accepted',now(),test_id(6),false);
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(6)::text,false);
SELECT test_assert((SELECT role='owner' FROM project_participants(test_id(202)) WHERE user_id=test_id(6)),'invited primary client is labelled client');
SELECT test_assert((SELECT count(*)=1 AND min(role)='contractor' FROM project_participants(test_id(202)) WHERE user_id=test_id(2)),'contractor creator has one correct role');
SELECT set_config('test.actor',test_id(2)::text,false);
SELECT test_refused($q$SELECT create_project_invitation_link(test_id(202),'client')$q$,'role_change_requires_admin');

-- A client-created project's contractor link assigns one primary contractor.
SELECT set_config('test.actor',test_id(1)::text,false);
INSERT INTO test_links SELECT test_id(203),(create_project_invitation_link(test_id(203),'contractor')->>'token')::uuid,'contractor';
SELECT test_refused($q$SELECT invite_project_contractor(test_id(203),'8@test.example')$q$,'contractor_invitation_pending');
SELECT set_config('test.actor',test_id(5)::text,false);
SELECT test_assert(accept_contractor_invite((SELECT token FROM test_links WHERE project_id=test_id(203)))=test_id(203),'contractor claimant joins correct project');
SELECT test_assert(accept_contractor_invite((SELECT token FROM test_links WHERE project_id=test_id(203)))=test_id(203),'contractor acceptance retry remains safe');
SELECT test_assert(is_primary_project_contractor(test_id(203)) AND NOT is_project_client(test_id(203)),'contractor claimant has construction role, not client approvals');
SELECT test_assert((SELECT count(*) FROM projects WHERE id=test_id(203))=1,'contractor claimant immediately sees project');
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT test_refused($q$SELECT accept_contractor_invite((SELECT token FROM test_links WHERE project_id=test_id(203)))$q$,'invite_invalid');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM get_invite_by_token((SELECT token FROM test_links WHERE project_id=test_id(203)))),'consumed contractor link is hidden from other accounts');

-- Expiry releases reserved roles, without renewing old tokens or losing history.
SELECT set_config('test.actor',test_id(1)::text,false);
INSERT INTO test_links SELECT test_id(204),(create_project_invitation_link(test_id(204),'contractor')->>'token')::uuid,'contractor';
SELECT set_config('test.actor',test_id(2)::text,false);
INSERT INTO test_links SELECT test_id(205),(create_project_invitation_link(test_id(205),'client')->>'token')::uuid,'viewer';
RESET ROLE;
UPDATE contractor_invites SET expires_at=now()-interval '1 minute' WHERE project_id=test_id(204) AND is_share_link;
UPDATE project_viewers SET expires_at=now()-interval '1 minute' WHERE project_id=test_id(205) AND is_share_link;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT test_refused($q$SELECT accept_contractor_invite((SELECT token FROM test_links WHERE project_id=test_id(204)))$q$,'invitation_expired');
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(205)))$q$,'invitation_expired');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM get_invite_by_token((SELECT token FROM test_links WHERE project_id=test_id(204)))) AND NOT EXISTS(SELECT 1 FROM project_viewer_preview((SELECT token FROM test_links WHERE project_id=test_id(205)))),'expired links have no preview');
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT test_assert((project_team_access(test_id(204))->>'can_invite_contractor')::boolean,'expired contractor link releases invitation form');
SELECT test_assert((create_project_invitation_link(test_id(204),'contractor')->>'token')::uuid<>(SELECT token FROM test_links WHERE project_id=test_id(204)),'fresh link uses a new token');
SELECT cancel_project_contractor_invite((SELECT id FROM contractor_invites WHERE project_id=test_id(204) AND status='pending'));
SELECT test_assert((invite_project_contractor(test_id(204),'8@test.example')).email='8@test.example','email invitation works after link expiry and cancellation');
SELECT set_config('test.actor',test_id(2)::text,false);
SELECT test_assert((project_team_access(test_id(205))->>'can_invite_client')::boolean,'expired client link releases invitation form');
SELECT invite_project_viewer(test_id(205),'8@test.example',NULL,true);
SELECT test_assert((SELECT revoked_at IS NOT NULL FROM project_viewers WHERE token=(SELECT token FROM test_links WHERE project_id=test_id(205))),'email invite retires expired client link');

-- Ready for independent-session claim races in the node harness.
SELECT set_config('test.actor',test_id(1)::text,false);
INSERT INTO test_links SELECT test_id(206),(create_project_invitation_link(test_id(206),'observer')->>'token')::uuid,'viewer';
INSERT INTO test_links SELECT test_id(207),(create_project_invitation_link(test_id(207),'contractor')->>'token')::uuid,'contractor';
SELECT set_config('test.actor',test_id(2)::text,false);
INSERT INTO test_links SELECT test_id(208),(create_project_invitation_link(test_id(208),'client')->>'token')::uuid,'viewer';
RESET ROLE;
SELECT 'PROJECT_LINKS_READY' AS result;
