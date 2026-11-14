-- Reproduce the deployed first copy: the core tables exist, later columns do not.
RESET ROLE;
SELECT test_assert((SELECT NOT enabled AND mode='test' FROM communication_whatsapp_settings),'fresh WhatsApp installs remain disabled');
UPDATE communication_whatsapp_settings SET enabled=true,mode='test',phone_number_id='111111',business_account_id='222222',display_phone='+14699913055',test_recipients=ARRAY['+15551234567'];
INSERT INTO app_config(key,value) VALUES('meta_whatsapp_token','test-upgrade-private-token');
INSERT INTO communication_whatsapp_contacts(id,phone_number_id,phone,name,consent_at,last_inbound_at)
VALUES(test_id(9101),'111111','+15551234567','Existing contact','2026-11-01T12:00:00Z','2026-11-02T12:00:00Z');
INSERT INTO communication_whatsapp_messages(id,contact_id,direction,kind,body,payload,status,error)
VALUES(test_id(9102),test_id(9101),'outbound','staff','Existing frozen message','{"to":"+15551234567","type":"text","text":{"body":"Existing frozen message"}}','uncertain','uncertain_send');
ALTER TABLE communication_whatsapp_settings DROP COLUMN template_checked_at;
ALTER TABLE communication_whatsapp_contacts DROP COLUMN last_lifecycle_check_at;
ALTER TABLE communication_whatsapp_messages DROP COLUMN reviewed_at,DROP COLUMN reviewed_by,DROP COLUMN review_note;
DROP FUNCTION public.disconnect_whatsapp_contact(uuid);
DROP FUNCTION public.review_whatsapp_send(uuid,uuid,boolean,text,text);
