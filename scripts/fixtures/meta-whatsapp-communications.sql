RESET ROLE;
GRANT SELECT ON public.notifications TO service_role;
SELECT test_assert((SELECT NOT enabled AND mode='test' FROM communication_whatsapp_settings),'WhatsApp starts off and restricted to test recipients');
INSERT INTO auth.users(id,email) VALUES(test_id(9200),'whatsapp@test.example');
INSERT INTO profiles(id,full_name,preferred_lang) VALUES(test_id(9200),'WhatsApp tester','en');
INSERT INTO user_roles VALUES(test_id(9200),'contractor');
INSERT INTO lifecycle_sequences(key,name,trigger_event,enabled,followup_after_days,awaiting_action) VALUES('wa_test','WhatsApp test','wa_test',true,7,'Finish the test action');
INSERT INTO lifecycle_enrollments(id,sequence_key,email,full_name,context,enrolled_at) VALUES(test_id(9201),'wa_test','whatsapp@test.example','WhatsApp tester','{"entry_source":"direct_outreach"}',now()-interval '8 days');
UPDATE communication_settings SET delivery_enabled=false;
UPDATE communication_whatsapp_settings SET phone_number_id='123456789',business_account_id='987654321',display_phone='+15550001111',test_recipients=ARRAY['+237699123456'];
SET ROLE service_role;
SELECT begin_whatsapp_consent(test_id(9200),'+237699123456',repeat('a',64));
SELECT test_refused($q$SELECT begin_whatsapp_consent(test_id(9200),'+237699123456',repeat('b',64))$q$,'consent_request_wait');
SELECT record_whatsapp_inbound('123456789','wrong-phone','+237699123457',NULL,'Wrong phone','START code',now(),repeat('a',64));
SELECT test_assert((SELECT user_id IS NULL AND consent_at IS NULL FROM communication_whatsapp_contacts WHERE phone='+237699123457'),'another phone cannot use a consent code');
SELECT record_whatsapp_inbound('123456789','verified-start','+237699123456',NULL,'Tester','START code',now(),repeat('a',64));
SELECT test_assert((SELECT user_id=test_id(9200) AND consent_at IS NOT NULL AND NOT automation_paused FROM communication_whatsapp_contacts WHERE phone='+237699123456'),'signed START proves consent and links the requested account');
SELECT test_assert((record_whatsapp_inbound('123456789','verified-start','+237699123456',NULL,'Tester','START code',now(),repeat('a',64))->>'duplicate')::boolean,'provider redelivery is idempotent');
RESET ROLE;
CREATE FUNCTION public.test_whatsapp_contact() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM public.communication_whatsapp_contacts WHERE phone='+237699123456' $$;
SET ROLE service_role;
SELECT test_assert(whatsapp_lifecycle_state(test_id(9201),test_whatsapp_contact())->>'reason'='connection_disabled','channel enable switch is enforced');
UPDATE communication_whatsapp_settings SET enabled=true;
INSERT INTO communication_preferences(email,blocked_reason) VALUES('whatsapp@test.example','bounced');
SELECT test_assert(whatsapp_lifecycle_state(test_id(9201),test_whatsapp_contact())->>'kind'='ready','WhatsApp eligibility does not depend on email delivery or email bounce state');
UPDATE lifecycle_enrollments SET status='suppressed',exit_reason='bounced' WHERE id=test_id(9201);
SELECT test_assert(whatsapp_lifecycle_state(test_id(9201),test_whatsapp_contact())->>'kind'='ready','email reconciliation cannot suppress the independent WhatsApp channel');
UPDATE lifecycle_enrollments SET exit_reason=NULL WHERE id=test_id(9201);
SELECT test_assert(whatsapp_lifecycle_state(test_id(9201),test_whatsapp_contact())->>'reason'='enrollment_inactive','NULL suppression reasons cannot pass the channel eligibility check');
UPDATE lifecycle_enrollments SET status='active',exit_reason=NULL WHERE id=test_id(9201);
SELECT review_whatsapp_followup(test_id(9201),test_whatsapp_contact());
SELECT review_whatsapp_followup(test_id(9201),test_whatsapp_contact());
SELECT test_assert((SELECT count(*)=1 FROM followup_queue WHERE enrollment_id=test_id(9201)),'Day 7 queues one shared human task even with email off');
SELECT review_communication_followups();
SELECT test_assert((SELECT status='open' FROM followup_queue WHERE enrollment_id=test_id(9201)),'an email bounce cannot close the WhatsApp human follow-up task');
SELECT queue_whatsapp_message(test_whatsapp_contact(),'lifecycle','Frozen copy','{"to":"+237699123456","type":"template"}',test_id(9201),1,'WA1') AS wa_message \gset
SELECT test_assert(queue_whatsapp_message(test_whatsapp_contact(),'lifecycle','Changed copy','{"changed":true}',test_id(9201),1,'WA1')=:'wa_message'::uuid,'duplicate schedule returns the original delivery');
SELECT test_assert((SELECT body='Frozen copy' AND payload->>'to'='+237699123456' FROM communication_whatsapp_messages WHERE id=:'wa_message'),'retry cannot replace the recipient or message');
SELECT claim_whatsapp_message(:'wa_message')->>'worker_token' AS wa_token \gset
SELECT test_assert(claim_whatsapp_message(:'wa_message') IS NULL,'an already claimed message cannot be sent twice');
SELECT test_assert(NOT finish_whatsapp_message(:'wa_message',gen_random_uuid(),'sent','wrong-token'),'another worker cannot finish a send');
SELECT record_whatsapp_status('wrong-number','early-wamid','read',now(),:'wa_message');
SELECT test_assert((SELECT status='sending' FROM communication_whatsapp_messages WHERE id=:'wa_message'),'another business number cannot update delivery status');
SELECT record_whatsapp_status('123456789','early-wamid','read',now(),:'wa_message');
SELECT finish_whatsapp_message(:'wa_message',:'wa_token','uncertain',NULL,'uncertain_send');
SELECT record_whatsapp_status('123456789','early-wamid','failed',now(),:'wa_message','meta_131047');
SELECT record_whatsapp_status('123456789','early-wamid','sent',now()-interval '1 minute',:'wa_message');
SELECT test_assert((SELECT status='read' AND provider_id='early-wamid' AND error IS NULL FROM communication_whatsapp_messages WHERE id=:'wa_message'),'early and reordered callbacks retain the strongest delivery evidence');
SELECT queue_whatsapp_message(test_whatsapp_contact(),'lifecycle','French pending','{"template":{"language":{"code":"fr"}}}',test_id(9201),4,'WA4') AS language_message \gset
SELECT test_assert(claim_whatsapp_message(:'language_message') IS NULL,'a queued template cannot send in the wrong current account language');
SELECT test_assert((SELECT status='blocked' AND error='language_changed' FROM communication_whatsapp_messages WHERE id=:'language_message'),'language changes hold old frozen copy');
SELECT queue_whatsapp_message(test_whatsapp_contact(),'lifecycle','Uncertain copy','{}',test_id(9201),2,'WA2') AS uncertain_message \gset
SELECT claim_whatsapp_message(:'uncertain_message');
UPDATE communication_whatsapp_messages SET processing_until=now()-interval '1 minute' WHERE id=:'uncertain_message';
SELECT test_assert(claim_whatsapp_message(:'uncertain_message') IS NULL,'expired lease is not resent');
SELECT test_assert((SELECT status='uncertain' FROM communication_whatsapp_messages WHERE id=:'uncertain_message'),'expired lease requires delivery review');
SELECT queue_whatsapp_message(test_whatsapp_contact(),'lifecycle','Held after uncertainty','{}',test_id(9201),3,'WA3') AS held_message \gset
SELECT test_assert(claim_whatsapp_message(:'held_message') IS NULL,'uncertain earlier send holds later reminders');
SELECT record_whatsapp_status('123456789','resolved-wamid','delivered',now(),:'uncertain_message');
SELECT test_assert((SELECT status='delivered' FROM communication_whatsapp_messages WHERE id=:'uncertain_message'),'a signed callback reconciles an uncertain send');
SELECT record_whatsapp_inbound('123456789','real-reply','+237699123456',NULL,'Tester','Please help me finish',now());
SELECT test_assert((SELECT automation_paused AND needs_attention FROM communication_whatsapp_contacts WHERE id=test_whatsapp_contact()),'a reply pauses reminders for human support');
SELECT test_assert((SELECT count(*)=1 FROM communication_messages WHERE channel='whatsapp' AND direction='inbound' AND body='Please help me finish'),'reply appears in shared human follow-up history');
SELECT test_assert((SELECT status='open' AND contact_status='needs_attention' FROM followup_queue WHERE enrollment_id=test_id(9201)) AND (SELECT status='active' FROM lifecycle_enrollments WHERE id=test_id(9201)),'human contact does not mark the unfinished action complete');
SELECT test_assert((SELECT count(*)=1 FROM notifications WHERE type='communication_whatsapp' AND data->>'whatsapp_contact_id'=test_whatsapp_contact()::text),'Admin is notified once of the reply');
SELECT test_refused($q$SELECT resume_whatsapp_contact(test_whatsapp_contact(),test_id(9200))$q$,'not_admin');
SELECT resume_whatsapp_contact(test_whatsapp_contact(),test_id(4));
SELECT test_assert((SELECT NOT automation_paused AND NOT needs_attention FROM communication_whatsapp_contacts WHERE id=test_whatsapp_contact()) AND NOT EXISTS(SELECT 1 FROM communication_threads WHERE email='whatsapp@test.example' AND automation_paused),'review clears WhatsApp-created holds across channels');
SELECT record_communication_inbound('newer-email',(SELECT id FROM communication_threads WHERE enrollment_id=test_id(9201)),'whatsapp@test.example','Email','New email needs help','email-id',true,now(),0);
SELECT resume_whatsapp_contact(test_whatsapp_contact(),test_id(4));
SELECT test_assert((SELECT automation_paused FROM communication_threads WHERE enrollment_id=test_id(9201)),'WhatsApp review cannot clear a later unreviewed email reply');
SELECT queue_whatsapp_message(test_whatsapp_contact(),'staff','We can help','{"type":"text"}',NULL,NULL,NULL,test_id(9230),test_id(4)) AS staff_message \gset
SELECT claim_whatsapp_message(:'staff_message')->>'worker_token' AS staff_token \gset
SELECT finish_whatsapp_message(:'staff_message',:'staff_token','sent','staff-wamid');
SELECT test_assert((SELECT count(*)=1 FROM communication_messages WHERE channel='whatsapp' AND direction='outbound' AND client_ref=test_id(9230)),'staff WhatsApp contact is saved once in shared history');
SELECT queue_whatsapp_message(test_whatsapp_contact(),'staff','Manual review','{}',NULL,NULL,NULL,test_id(9233),test_id(4)) AS manual_message \gset
SELECT claim_whatsapp_message(:'manual_message')->>'worker_token' AS manual_token \gset
SELECT finish_whatsapp_message(:'manual_message',:'manual_token','uncertain',NULL,'uncertain_send');
SELECT test_refused(format('SELECT review_whatsapp_send(%L,test_id(9200),true,''wamid.manual'',''Checked with recipient'')',:'manual_message'),'not_admin');
SELECT test_assert(review_whatsapp_send(:'manual_message',test_id(4),true,'wamid.manual','Confirmed Meta ID with recipient'),'Admin may reconcile the uncertain result without resending');
SELECT test_assert((SELECT status='sent' AND reviewed_by=test_id(4) AND review_note='Confirmed Meta ID with recipient' FROM communication_whatsapp_messages WHERE id=:'manual_message'),'delivery review preserves its staff audit');
SELECT test_assert(NOT review_whatsapp_send(:'manual_message',test_id(4),false,NULL,'Duplicate manual review'),'an already resolved message is not changed by a second review');
SELECT test_assert((SELECT count(*)=1 FROM communication_messages WHERE channel='whatsapp' AND direction='outbound' AND client_ref=test_id(9233)),'manual confirmation records the original staff contact once');
UPDATE communication_whatsapp_contacts SET last_inbound_at=now()-interval '25 hours' WHERE id=test_whatsapp_contact();
SELECT test_refused($q$SELECT queue_whatsapp_message(test_whatsapp_contact(),'staff','Too late','{}',NULL,NULL,NULL,test_id(9231),test_id(4))$q$,'outside_24h_window');
SELECT record_whatsapp_inbound('123456789','stop-message','+237699123456',NULL,'Tester','STOP',now(),NULL,true);
SELECT test_assert((SELECT opted_out_at IS NOT NULL FROM communication_whatsapp_contacts WHERE id=test_whatsapp_contact()),'STOP opts the recipient out');
SELECT test_refused($q$SELECT queue_whatsapp_message(test_whatsapp_contact(),'staff','Blocked','{}',NULL,NULL,NULL,test_id(9232),test_id(4))$q$,'recipient_opted_out');
SELECT record_whatsapp_inbound('123456789','old-start','+237699123456',NULL,'Tester','START code',now()-interval '1 day',repeat('a',64));
SELECT test_assert((SELECT opted_out_at IS NOT NULL FROM communication_whatsapp_contacts WHERE id=test_whatsapp_contact()),'an old START or ordinary message cannot undo STOP');
SELECT record_whatsapp_inbound('123456789','bsuid-only',NULL,'US.1234567890123456','Private user','Need help',now());
SELECT test_assert((SELECT phone IS NULL AND needs_attention FROM communication_whatsapp_contacts WHERE bsuid='US.1234567890123456'),'username-only senders appear in the Admin inbox without guessing a phone or account');
SELECT begin_whatsapp_consent(test_id(9200),'+237699123456',repeat('b',64));
SELECT disconnect_whatsapp_contact(test_id(9200));
SELECT test_assert(NOT EXISTS(SELECT 1 FROM communication_whatsapp_challenges WHERE user_id=test_id(9200)),'disconnect atomically revokes a pending START link');
SELECT record_whatsapp_inbound('123456789','revoked-start','+237699123456',NULL,'Tester','START code',now(),repeat('b',64));
SELECT test_assert((SELECT opted_out_at IS NOT NULL FROM communication_whatsapp_contacts WHERE id=test_whatsapp_contact()),'the revoked START link cannot reconnect a stopped account');
SELECT test_assert((SELECT next_position=1 FROM lifecycle_enrollments WHERE id=test_id(9201)),'WhatsApp sends and replies never advance the email cursor');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(9200)::text,false);
SELECT test_assert((SELECT count(*)=0 FROM communication_whatsapp_messages),'ordinary users cannot read the Admin WhatsApp inbox');
SELECT test_refused($q$SELECT claim_whatsapp_message(test_id(1))$q$,'permission denied');
SELECT test_refused($q$UPDATE communication_whatsapp_settings SET enabled=true$q$,'permission denied');
SELECT test_refused($q$SELECT * FROM communication_whatsapp_challenges$q$,'permission denied');
SELECT set_config('test.actor',test_id(4)::text,false);
SELECT test_assert((SELECT count(*)>0 FROM communication_whatsapp_messages),'Admin can read the WhatsApp inbox');
SELECT test_refused($q$UPDATE communication_whatsapp_messages SET status='sent'$q$,'permission denied');
RESET ROLE;
-- A queued staff message for the harness's two concurrent workers.
UPDATE communication_whatsapp_contacts SET opted_out_at=NULL,last_inbound_at=now() WHERE id=test_whatsapp_contact();
INSERT INTO communication_whatsapp_messages(id,contact_id,direction,kind,body,payload,status,actor_id,client_ref)
VALUES(test_id(9290),test_whatsapp_contact(),'outbound','staff','Concurrent send','{}','queued',test_id(4),test_id(9291));
UPDATE communication_settings SET delivery_enabled=true;
SELECT 'META_WHATSAPP_OK';
