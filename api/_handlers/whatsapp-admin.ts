import { randomBytes } from 'node:crypto';
import { getSupabaseAdmin,requireUser } from '../_lib/stripe.js';
import { metaWhatsAppConfig,whatsappSite } from '../_lib/meta-whatsapp.js';
import { checkWhatsAppConnection,runWhatsApp,whatsappTemplatePack } from '../_lib/whatsapp-communications.js';
import { serviceWindowOpen,whatsappPhone } from '../../shared/whatsapp.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function handler(req:any,res:any) {
  res.setHeader('Cache-Control','private, no-store');
  if(!['GET','POST'].includes(req.method)){res.status(405).end();return;}
  try {
    const user=await requireUser(req);if(!user){res.status(401).json({error:'not_signed_in'});return;}
    const svc=getSupabaseAdmin();
    const role=await svc.from('user_roles').select('role').eq('user_id',user.id).eq('role','admin').limit(1);
    if(role.error) throw new Error('role_check_unavailable');
    if(!role.data?.length){res.status(403).json({error:'not_admin'});return;}
    const cfg=await metaWhatsAppConfig(svc);
    if(!cfg){res.status(503).json({error:'whatsapp_migration_required'});return;}
    if(req.method==='GET') {
      const {token,appSecret,verifyToken,...settings}=cfg;
      res.status(200).json({settings,credentials:{token:!!token,appSecret:!!appSecret,verifyToken:!!verifyToken},
        callbackUrl:`${whatsappSite()}/api/whatsapp-webhook`});return;
    }
    const body=req.body??{};
    if(body.operation==='save') {
      const numbers=['phone_number_id','business_account_id','messaging_account_id'] as const;
      const patch:Record<string,any>={updated_by:user.id,updated_at:new Date().toISOString()};
      for(const key of numbers) if(body[key]!==undefined) {
        if(typeof body[key]!=='string' || (body[key]!=='' && !/^\d{5,30}$/.test(body[key]))) throw new Error('invalid_connection_ids');patch[key]=body[key];
      }
      if(body.display_phone!==undefined) {const phone=whatsappPhone(body.display_phone);if(!phone) throw new Error('phone_with_country_code_required');patch.display_phone=phone;}
      if(body.mode!==undefined) {if(!['test','live'].includes(body.mode)) throw new Error('invalid_mode');patch.mode=body.mode;}
      if(body.test_recipients!==undefined) {
        if(!Array.isArray(body.test_recipients)||body.test_recipients.length>20) throw new Error('invalid_test_recipients');
        const phones=body.test_recipients.filter((p:any)=>typeof p!=='string'||p.trim()).map(whatsappPhone);if(phones.some((p:any)=>!p)) throw new Error('phone_with_country_code_required');patch.test_recipients=[...new Set(phones)];
      }
      if(body.enabled!==undefined) {
        if(typeof body.enabled!=='boolean') throw new Error('invalid_setting');
        if(body.enabled && (!cfg.token || !cfg.appSecret || !cfg.verifyToken || !cfg.webhook_verified_at || !cfg.signed_event_at)) throw new Error('verify_webhook_before_enabling');
        patch.enabled=body.enabled;
      }
      const secrets:Array<{key:string;value:string}>=[];
      for(const [field,key] of [['token','meta_whatsapp_token'],['appSecret','meta_whatsapp_app_secret'],['verifyToken','meta_whatsapp_verify_token']] as const) {
        if(body[field]) {if(typeof body[field]!=='string'||body[field].length>4096 || /[\r\n]/.test(body[field])) throw new Error('invalid_credentials');secrets.push({key,value:body[field].trim()});}
      }
      const identityChanged=(patch.phone_number_id!==undefined && patch.phone_number_id!==cfg.phone_number_id)
        ||(patch.business_account_id!==undefined && patch.business_account_id!==cfg.business_account_id)||!!body.appSecret||!!body.verifyToken;
      if(identityChanged) {patch.enabled=false;patch.webhook_verified_at=null;patch.signed_event_at=null;}
      // Disable before changing signing credentials, so a partial save cannot send with an unverified connection.
      if(identityChanged) {const off=await svc.from('communication_whatsapp_settings').update({enabled:false,webhook_verified_at:null,signed_event_at:null}).eq('id',true);if(off.error) throw new Error('settings_save_failed');}
      if(identityChanged||body.token) {
        patch.template_checked_at=null;
        const stale=await svc.from('communication_whatsapp_templates').update({status:'NEEDS_CHECK'}).neq('name','');
        if(stale.error) throw new Error('settings_save_failed');
      }
      if(secrets.length) {const saved=await svc.from('app_config').upsert(secrets,{onConflict:'key'});if(saved.error) throw new Error('credentials_save_failed');}
      const saved=await svc.from('communication_whatsapp_settings').update(patch).eq('id',true);if(saved.error) throw new Error('settings_save_failed');
      res.status(200).json({ok:true});return;
    }
    if(body.operation==='generate_verify_token') {
      // Returned once to the requesting Admin, never by the readiness endpoint.
      const token=randomBytes(32).toString('hex');
      const off=await svc.from('communication_whatsapp_settings').update({enabled:false,webhook_verified_at:null,signed_event_at:null}).eq('id',true);if(off.error) throw new Error('settings_save_failed');
      const saved=await svc.from('app_config').upsert({key:'meta_whatsapp_verify_token',value:token},{onConflict:'key'});if(saved.error) throw new Error('credentials_save_failed');
      res.status(200).json({verifyToken:token});return;
    }
    if(body.operation==='check') {res.status(200).json(await checkWhatsAppConnection(svc,cfg));return;}
    if(body.operation==='templates') {res.status(200).json(await whatsappTemplatePack(svc));return;}
    if(body.operation==='resume') {
      if(!UUID.test(body.contactId)) throw new Error('invalid_contact');
      const saved=await svc.rpc('resume_whatsapp_contact',{p_contact:body.contactId,p_actor:user.id});
      if(saved.error) throw new Error('resume_failed');
      res.status(200).json({ok:true});return;
    }
    if(body.operation==='review_send') {
      if(!UUID.test(body.messageId)||typeof body.sent!=='boolean'||body.confirmReview!==true||typeof body.note!=='string'||body.note.trim().length<10||body.note.length>1000) throw new Error('review_details_required');
      if(body.sent&&(typeof body.providerId!=='string'||!/^wamid\.\S{1,490}$/.test(body.providerId))) throw new Error('meta_message_id_required');
      const saved=await svc.rpc('review_whatsapp_send',{p_message:body.messageId,p_actor:user.id,p_sent:body.sent,p_provider:body.sent?body.providerId:null,p_note:body.note});
      if(saved.error) throw new Error('send_review_failed');
      res.status(200).json({ok:true,resolved:saved.data===true});return;
    }
    if(body.operation==='reply' || body.operation==='test') {
      if(!UUID.test(body.contactId)||!UUID.test(body.clientRef)) throw new Error('invalid_contact');
      if(!cfg.enabled) throw new Error('connection_disabled');
      const contact=await svc.from('communication_whatsapp_contacts').select('*').eq('id',body.contactId).eq('phone_number_id',cfg.phone_number_id).single();
      if(contact.error) throw new Error('contact_unavailable');const c=contact.data;
      if(c.opted_out_at) throw new Error('recipient_opted_out');
      if(cfg.mode==='test' && !cfg.test_recipients.includes(c.phone)) throw new Error('test_recipient_required');
      const test=body.operation==='test';
      if(test && (body.confirmTest!==true || cfg.mode!=='test'||!c.consent_at)) throw new Error('consent_required');
      if(!test && !serviceWindowOpen(c.last_inbound_at)) throw new Error('outside_24h_window');
      if(!test && (typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)) throw new Error('message_required');
      const text=test?'Meta connection test: hello_world':body.text.trim();
      const payload={...(c.phone?{to:c.phone}:{recipient:c.bsuid}),...(test?{type:'template',template:{name:'hello_world',language:{code:'en_US'}}}:{type:'text',text:{preview_url:false,body:text}})};
      const queued=await svc.rpc('queue_whatsapp_message',{p_contact:c.id,p_kind:test?'test':'staff',p_body:text,p_payload:payload,p_client_ref:body.clientRef,p_actor:user.id});
      if(queued.error||!queued.data) throw new Error('message_queue_failed');
      const result=await runWhatsApp(svc,1,20_000,queued.data);
      const current=await svc.from('communication_whatsapp_messages').select('status,error').eq('id',queued.data).single();
      res.status(200).json({ok:true,messageId:queued.data,status:current.data?.status??'queued',error:current.data?.error??null,result});return;
    }
    res.status(400).json({error:'unknown_operation'});
  } catch(e) {
    const message=e instanceof Error?e.message:'whatsapp_unavailable';
    // Only deliberately constructed codes; never leak a provider response, credential or database detail.
    res.status(400).json({error:/^[a-z][a-z0-9_]{0,100}$/.test(message)?message:'whatsapp_unavailable'});
  }
}
