-- Reproduce the exact missing columns/table observed in the deployed early copy.
RESET ROLE;
SELECT test_enrollment(1700,'test_delivery',13);
SELECT ensure_lifecycle_communication(test_id(1700));
INSERT INTO communication_messages(id,thread_id,direction,provider_id,subject,body,actor_id,client_ref,status,payload,started_at)
 SELECT test_id(1701),id,'outbound','legacy-staff-provider','Earlier staff reply','Preserve the earlier reply',test_id(4),test_id(1702),'delivered','{"text":"Frozen earlier message"}',now()-interval '1 hour'
 FROM communication_threads WHERE enrollment_id=test_id(1700);
INSERT INTO followup_queue(enrollment_id,sequence_key,email,kind,reason,attempt_count,status,contact_status,due_at)
 VALUES(test_id(1700),'test_delivery','13@test.example','reply','Existing support task',3,'open','awaiting_reply',now()+interval '1 day');
CREATE TEMP TABLE communication_upgrade_snapshot AS SELECT
 (SELECT to_jsonb(s) - 'sender_email' - 'updated_at' - 'followup_sender_email' - 'application_sender_email' FROM communication_settings s WHERE id) AS settings,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY key) FROM lifecycle_sequences s) AS sequences,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY email) FROM communication_preferences p) AS preferences,
 (SELECT to_jsonb(m) - 'sent_at' FROM communication_messages m WHERE id=test_id(1701)) AS message,
 (SELECT to_jsonb(f) - 'last_reviewed_at' FROM followup_queue f WHERE enrollment_id=test_id(1700)) AS followup;
ALTER TABLE communication_settings DROP COLUMN followup_sender_email,DROP COLUMN application_sender_email;
ALTER TABLE communication_settings ALTER COLUMN sender_email DROP DEFAULT;
UPDATE communication_settings SET sender_email=NULL WHERE id;
ALTER TABLE communication_messages DROP COLUMN sent_at;
ALTER TABLE followup_queue DROP COLUMN last_reviewed_at;
DROP TABLE communication_issues;
