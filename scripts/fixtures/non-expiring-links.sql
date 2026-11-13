RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM project_viewers WHERE is_share_link AND revoked_at IS NULL AND expires_at IS NOT NULL),'active viewer links have no expiry');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM contractor_invites WHERE is_share_link AND status='pending' AND expires_at IS NOT NULL),'active contractor links have no expiry');
INSERT INTO projects(id,user_id) VALUES(test_id(301),test_id(1)),(test_id(302),test_id(1)),(test_id(303),test_id(2));
INSERT INTO contractor_invites(project_id,invited_by,email,status,accepted_at,contractor_user_id,is_primary)
 VALUES(test_id(303),test_id(2),'2@test.example','accepted',now(),test_id(2),true);
SELECT set_config('test.actor',test_id(1)::text,false);
INSERT INTO test_links SELECT test_id(301),(create_project_invitation_link(test_id(301),'observer')->>'token')::uuid,'viewer';
INSERT INTO test_links SELECT test_id(302),(create_project_invitation_link(test_id(302),'contractor')->>'token')::uuid,'contractor';
SELECT set_config('test.actor',test_id(2)::text,false);
INSERT INTO test_links SELECT test_id(303),(create_project_invitation_link(test_id(303),'client')->>'token')::uuid,'viewer';
-- Old date values do not invalidate a link after the policy change.
UPDATE project_viewers SET expires_at=now()-interval '1 year' WHERE project_id IN(test_id(301),test_id(303));
UPDATE contractor_invites SET expires_at=now()-interval '1 year' WHERE project_id=test_id(302);
SELECT test_assert(EXISTS(SELECT 1 FROM project_viewer_preview((SELECT token FROM test_links WHERE project_id=test_id(301)))),'old date does not hide observer preview');
SELECT test_assert(EXISTS(SELECT 1 FROM get_invite_by_token((SELECT token FROM test_links WHERE project_id=test_id(302)))),'old date does not hide contractor preview');
INSERT INTO lifecycle_enrollments(id,sequence_key,email,ref,context) VALUES
 (test_id(911),'ci_invited','8@test.example','no-expiry-contractor',jsonb_build_object('project_id',test_id(302),'invite_path','/invite/'||(SELECT token FROM test_links WHERE project_id=test_id(302)))),
 (test_id(912),'iv_invited','8@test.example','no-expiry-client',jsonb_build_object('project_id',test_id(303),'invite_path','/share/'||(SELECT token FROM test_links WHERE project_id=test_id(303))));
SELECT test_assert(lifecycle_enrollment_state(test_id(911))->>'kind'='ready','old date does not suppress contractor invitation reminders');
SELECT test_assert(lifecycle_enrollment_state(test_id(912))->>'kind'='ready','old date does not suppress client invitation reminders');
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(301)));
SELECT accept_contractor_invite((SELECT token FROM test_links WHERE project_id=test_id(302)));
SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(303)));
SELECT test_assert(is_project_client(test_id(303)),'primary client claim remains available without an expiry');
SELECT test_assert(lifecycle_enrollment_state(test_id(911))->>'reason'='invitation_accepted','accepted contractor link stops invitation reminders');
SELECT test_assert(lifecycle_enrollment_state(test_id(912))->>'reason'='invitation_accepted','accepted client link stops invitation reminders');
SELECT set_config('test.actor',test_id(6)::text,false);
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(301)))$q$,'already_accepted');
SELECT test_refused($q$SELECT accept_contractor_invite((SELECT token FROM test_links WHERE project_id=test_id(302)))$q$,'invite_invalid');
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT revoke_project_viewer((SELECT id FROM project_viewers WHERE project_id=test_id(301)));
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT test_refused($q$SELECT accept_project_viewer((SELECT token FROM test_links WHERE project_id=test_id(301)))$q$,'revoked');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM project_viewer_preview((SELECT token FROM test_links WHERE project_id=test_id(205)))),'formerly withdrawn links are not restored');
SELECT 'NON_EXPIRING_LINKS_OK';
