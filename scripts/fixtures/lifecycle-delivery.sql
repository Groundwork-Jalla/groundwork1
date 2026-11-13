SELECT test_assert(NOT EXISTS(SELECT 1 FROM lifecycle_sequences WHERE enabled),'migrations do not start contacting people');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM lifecycle_sequence_steps WHERE code<>'' AND (btrim(subject_fr)='' OR btrim(body_fr)='' OR btrim(cta_label_fr)='')),'all activation drafts have French subject, body and action');
SELECT test_assert((SELECT subject_en='Staff English' AND subject_fr='Français personnalisé' FROM lifecycle_sequence_steps WHERE code='CS01'),'copy replay preserves staff edits');
SELECT test_assert((SELECT payload->>'text'='Existing snapshot' FROM lifecycle_deliveries WHERE enrollment_id=test_id(900)),'incremental recovery preserves existing delivery snapshots');
INSERT INTO lifecycle_sequences(key,name,trigger_event,enabled,followup_after_days,awaiting_action) VALUES('test_delivery','Test','test',true,7,'Complete the test action');
INSERT INTO lifecycle_sequence_steps(sequence_key,position,delay_hours,channel,code) VALUES
 ('test_delivery',1,0,'email','T1'),('test_delivery',2,24,'email','T2'),('test_delivery',3,48,'email','T3'),('test_delivery',4,96,'email','T7');
CREATE FUNCTION public.test_enrollment(n int,seq text,email_n int,ctx jsonb DEFAULT '{}',days int DEFAULT 0,pos int DEFAULT 1)
RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO lifecycle_enrollments(id,sequence_key,email,context,ref,enrolled_at,next_position,next_send_at)
 VALUES(test_id(n),seq,email_n||'@test.example',ctx,coalesce(ctx->>'project_id',n::text),now()-days*interval '1 day',pos,now()-interval '1 minute');
 RETURN test_id(n); END $$;
GRANT EXECUTE ON FUNCTION test_enrollment(int,text,int,jsonb,int,int) TO service_role;
SET ROLE authenticated;
SELECT test_refused($q$SELECT claim_lifecycle_enrollment(test_id(200))$q$,'permission denied');
SELECT test_refused($q$SELECT lifecycle_enrollment_state(test_id(200))$q$,'permission denied');
RESET ROLE;

-- Database authority stops reminders after progress, even without a browser event.
SELECT test_enrollment(201,'cs_signup',2);
SELECT test_assert(lifecycle_enrollment_state(test_id(201))->>'kind'='ready','unfinished onboarding remains eligible');
INSERT INTO contractor_onboarding VALUES(test_id(2),'no_client');
SELECT test_assert(lifecycle_enrollment_state(test_id(201))->>'reason'='onboarding_completed','recorded onboarding completion stops old reminders');
SELECT test_enrollment(202,'cs_onboarded',2);
SELECT test_assert(lifecycle_enrollment_state(test_id(202))->>'reason'='no_active_project_selected','no-project intent stays in nurture');
SELECT test_enrollment(203,'cl_signup',1);
SELECT test_assert(lifecycle_enrollment_state(test_id(203))->>'kind'='complete','a saved project stops create-project reminders');
INSERT INTO contractor_invites(id,token,project_id,invited_by,email,status,contractor_user_id,is_primary)
 VALUES(test_id(300),test_id(400),test_id(101),test_id(2),'2@test.example','accepted',test_id(2),true);
SELECT test_enrollment(204,'cs_project',2,jsonb_build_object('project_id',test_id(101)));
SELECT test_assert(lifecycle_enrollment_state(test_id(204))->>'kind'='ready','contractor with no client remains eligible');
INSERT INTO project_viewers(id,token,project_id,invited_by,email,is_client,is_share_link,expires_at)
 VALUES(test_id(301),test_id(401),test_id(101),test_id(2),NULL,true,true,now()+interval '7 days');
SELECT test_assert(lifecycle_enrollment_state(test_id(204))->>'reason'='client_invited','a pending client link stops invite-client reminders');

INSERT INTO contractor_invites(id,token,project_id,invited_by,email) VALUES(test_id(302),test_id(402),test_id(100),test_id(1),'3@test.example');
SELECT test_enrollment(205,'ci_invited',3,jsonb_build_object('project_id',test_id(100),'invite_path','/invite/'||test_id(402)));
SELECT test_assert(lifecycle_enrollment_state(test_id(205))->>'kind'='ready','valid email invitation can be reminded');
UPDATE contractor_invites SET status='accepted',contractor_user_id=test_id(3),is_primary=true WHERE id=test_id(302);
SELECT test_assert(lifecycle_enrollment_state(test_id(205))->>'reason'='invitation_accepted','a joined contractor receives no stale invitation reminder');
SELECT test_enrollment(206,'iv_invited',5,jsonb_build_object('project_id',test_id(101),'invite_path','/share/'||test_id(401)));
UPDATE project_viewers SET revoked_at=now() WHERE id=test_id(301);
SELECT test_assert(lifecycle_enrollment_state(test_id(206))->>'reason'='invitation_unavailable','revoked links stop reminders');
SELECT test_enrollment(207,'cl_connected',1,jsonb_build_object('project_id',test_id(100),'invite_path','/invite/'||test_id(402)));
SELECT test_assert(lifecycle_enrollment_state(test_id(207))->>'kind'='ready','inviter receives the correct connection confirmation');

-- Claim, prepare, history and progress are durable and service-only.
UPDATE profiles SET preferred_lang='fr' WHERE id=test_id(7);
SELECT test_enrollment(220,'test_delivery',7,'{}',1);
SET ROLE service_role;
DO $$ DECLARE e jsonb; same jsonb; d jsonb; BEGIN
 e:=claim_lifecycle_enrollment(test_id(220));
 PERFORM test_assert(e->>'processing_token' IS NOT NULL,'first runner claims work');
 PERFORM test_assert(e->>'lang'='fr','reminder uses the current saved recipient language');
 PERFORM test_assert(claim_lifecycle_enrollment(test_id(220)) IS NULL,'second runner cannot claim leased work');
 d:=prepare_lifecycle_delivery(test_id(220),(e->>'processing_token')::uuid,1,'{"subject":"original","to":"7@test.example","text":"hello"}');
 same:=prepare_lifecycle_delivery(test_id(220),(e->>'processing_token')::uuid,1,'{"subject":"edited","to":"8@test.example"}');
 PERFORM test_assert(d->'payload'=same->'payload','retry body and recipient are immutable');
 PERFORM test_assert(NOT finish_lifecycle_delivery(test_id(220),test_id(999),1,'sent'),'wrong worker cannot finalize');
 PERFORM test_assert(finish_lifecycle_delivery(test_id(220),(e->>'processing_token')::uuid,1,'sent',NULL,'provider-1'),'delivery finalizes');
 PERFORM test_assert((SELECT count(*) FROM lifecycle_sends WHERE enrollment_id=test_id(220) AND status='sent')=1,'one successful history row');
 PERFORM test_assert((SELECT next_send_at=enrolled_at+interval '24 hours' AND next_position=2 AND emails_sent=1 FROM lifecycle_enrollments WHERE id=test_id(220)),'deadline is measured from entry, not delayed delivery');
 PERFORM test_assert(NOT finish_lifecycle_delivery(test_id(220),(e->>'processing_token')::uuid,1,'sent'),'stale finalizer cannot advance twice');
END $$;
RESET ROLE;
SELECT test_enrollment(221,'test_delivery',7);
SET ROLE service_role;
SELECT claim_lifecycle_enrollment(test_id(221));
RESET ROLE;
UPDATE lifecycle_enrollments SET processing_until=now()-interval '1 second' WHERE id=test_id(221);
SET ROLE service_role;
SELECT test_assert(claim_lifecycle_enrollment(test_id(221)) IS NOT NULL,'interrupted worker can be recovered after lease expiry');
RESET ROLE;
SELECT test_enrollment(222,'test_delivery',7);
INSERT INTO lifecycle_deliveries(enrollment_id,position,payload,started_at) VALUES(test_id(222),1,'{"subject":"uncertain"}',now()-interval '25 hours');
SET ROLE service_role;
DO $$ DECLARE e jsonb; BEGIN
 e:=claim_lifecycle_enrollment(test_id(222));
 PERFORM test_assert(prepare_lifecycle_delivery(test_id(222),(e->>'processing_token')::uuid,1,'{}')->>'status'='blocked','ambiguous delivery is held before provider protection expires');
 PERFORM test_assert((SELECT status='suppressed' FROM lifecycle_enrollments WHERE id=test_id(222)),'uncertain old outcome never resends');
 PERFORM test_assert(EXISTS(SELECT 1 FROM followup_queue WHERE enrollment_id=test_id(222) AND reason LIKE 'Delivery review:%'),'operator can review the ambiguous outcome');
END $$;
RESET ROLE;

-- Completion during a worker's lease is checked again before external delivery.
UPDATE lifecycle_sequences SET enabled=true WHERE key='cs_signup';
SELECT test_enrollment(223,'cs_signup',6);
SET ROLE service_role;
SELECT claim_lifecycle_enrollment(test_id(223));
RESET ROLE;
INSERT INTO contractor_onboarding VALUES(test_id(6),'onboard_client');
SET ROLE service_role;
SELECT test_assert(prepare_lifecycle_delivery(test_id(223),(SELECT processing_token FROM lifecycle_enrollments WHERE id=test_id(223)),1,'{}') IS NULL,'completed action between claim and send cancels delivery');
SELECT test_assert((SELECT status='exited' FROM lifecycle_enrollments WHERE id=test_id(223)),'late completion durably exits enrollment');
RESET ROLE;

-- Preserve the provider's actual outcome even if completion cancels an in-flight enrollment.
SELECT test_enrollment(224,'test_delivery',7);
SET ROLE service_role;
DO $$ DECLARE e jsonb; BEGIN
 e:=claim_lifecycle_enrollment(test_id(224));
 PERFORM prepare_lifecycle_delivery(test_id(224),(e->>'processing_token')::uuid,1,'{"subject":"in flight"}');
 UPDATE lifecycle_enrollments SET status='exited',next_send_at=NULL,processing_token=NULL,processing_until=NULL WHERE id=test_id(224);
 PERFORM test_assert(finish_lifecycle_delivery(test_id(224),(e->>'processing_token')::uuid,1,'sent',NULL,'actual-send'),'actual in-flight send is retained');
 PERFORM test_assert((SELECT status='exited' AND next_send_at IS NULL AND emails_sent=1 FROM lifecycle_enrollments WHERE id=test_id(224)),'late provider success never reopens canceled reminders');
 PERFORM test_assert((SELECT count(*) FROM lifecycle_sends WHERE enrollment_id=test_id(224) AND status='sent')=1,'actual send has one history row');
 PERFORM test_assert(NOT finish_lifecycle_delivery(test_id(224),(e->>'processing_token')::uuid,1,'sent',NULL,'actual-send'),'late success replay is idempotent');
END $$;
RESET ROLE;

-- Day 7 queues qualified people, keeps projects separate and avoids premature calls.
SELECT test_enrollment(230,'test_delivery',8,jsonb_build_object('project_id',test_id(100)),8,5);
SELECT test_enrollment(231,'test_delivery',8,jsonb_build_object('project_id',test_id(101)),8,5);
SELECT test_enrollment(232,'test_delivery',8,'{}',8,5);
SELECT test_enrollment(233,'test_delivery',7,jsonb_build_object('project_id',test_id(100),'entry_source','referral'),2,5);
UPDATE lifecycle_enrollments SET ref='early' WHERE id=test_id(233);
SET ROLE service_role;
DO $$ DECLARE n int; e jsonb; BEGIN
 FOR n IN 230..233 LOOP
  e:=claim_lifecycle_enrollment(test_id(n));
  PERFORM finish_lifecycle_delivery(test_id(n),(e->>'processing_token')::uuid,5,'complete');
 END LOOP;
 PERFORM test_assert((SELECT count(*) FROM followup_queue WHERE email='8@test.example')=2,'two projects have independent follow-up tasks');
 PERFORM test_assert((SELECT status='completed' AND NOT followup_queued FROM lifecycle_enrollments WHERE id=test_id(232)),'unqualified inactive signup is not automatically queued for contact');
 PERFORM test_assert((SELECT status='active' AND next_send_at=enrolled_at+interval '7 days' FROM lifecycle_enrollments WHERE id=test_id(233)),'handoff waits until Day 7');
 PERFORM test_assert(claim_lifecycle_enrollment(test_id(230)) IS NULL,'completed follow-up is not requeued');
END $$;
RESET ROLE;
SELECT set_config('test.actor',test_id(7)::text,false);
SET ROLE authenticated;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM lifecycle_deliveries),'ordinary account cannot read reminder payloads');
RESET ROLE;
SELECT set_config('test.actor',test_id(4)::text,false);
SET ROLE authenticated;
SELECT test_assert(EXISTS(SELECT 1 FROM lifecycle_deliveries),'staff can inspect delivery history');
RESET ROLE;
SELECT test_enrollment(290,'test_delivery',1);
SELECT 'LIFECYCLE_DELIVERY_OK' AS result;
