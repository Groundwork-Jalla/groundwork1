import { approvedTemplateMatches, latestDueWhatsAppStep, sameWhatsAppDefinition, whatsappCommand, whatsappTemplate, whatsappTemplatePayload, type WhatsAppTemplate } from '../../shared/whatsapp.js';
import { createHash } from 'node:crypto';
import { metaWhatsAppConfig, metaRequest, postMetaMessage, type MetaWhatsAppConfig, type WhatsAppService } from './meta-whatsapp.js';
import type { Context, Person, Step } from '../../shared/lifecycle-copy.js';

export const hashConsent = (code: string) => createHash('sha256').update(code).digest('hex');
const site = () => new URL(process.env.PUBLIC_SITE_URL || 'https://tryjalla.com').origin;
function checked<T extends {error:any;data:any}>(r:T): T['data'] { if(r.error) throw new Error('whatsapp_database_unavailable'); return r.data; }

export async function whatsappTemplatePack(svc: WhatsAppService) {
  const steps:Step[] = checked(await svc.from('lifecycle_sequence_steps').select('*').order('position')) ?? [];
  const templates:WhatsAppTemplate[]=[];const issues:Array<{step:string;language:string;error:string}>=[];
  for(const step of steps) for(const language of ['en','fr'] as const) {
    try { const template = whatsappTemplate(step,language,site());
      if(!templates.some(t => t.name===template.name && t.language===language)) templates.push(template);
    } catch(e) {issues.push({step:step.code??String(step.position),language,error:e instanceof Error?e.message:'invalid_template'});}
  }
  return {templates,issues};
}
/** Checks only read provider state. Never sends or creates templates. */
export async function checkWhatsAppConnection(svc: WhatsAppService,cfg: MetaWhatsAppConfig,deadline=Date.now()+60_000) {
  if(!cfg.token || !cfg.phone_number_id || !cfg.business_account_id) throw new Error('not_configured');
  const [numberResult,pack] = await Promise.all([metaRequest(cfg,cfg.phone_number_id),whatsappTemplatePack(svc)]);
  if(!numberResult.ok) throw new Error(`meta_${Number(numberResult.json?.error?.code)||numberResult.status}`);
  // Fixed host, account and endpoint for every page. Never follow provider-supplied URLs with our token.
  let after='';const catalog:any[]=[];
  for(let page=0;page<20;page++) {
    if(Date.now()>deadline-12_000) throw new Error('template_check_time_limit');
    const endpoint=new URL(`https://graph.facebook.com/${cfg.api_version}/${cfg.business_account_id}/message_templates`);
    endpoint.searchParams.set('limit','100');endpoint.searchParams.set('fields','name,language,status,components');
    if(after) endpoint.searchParams.set('after',after);
    const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${cfg.token}`},signal:AbortSignal.timeout(12_000)});
    const json=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(`meta_${Number(json?.error?.code)||response.status}`);
    catalog.push(...(Array.isArray(json?.data)?json.data:[]));
    if(!json?.paging?.next) break;
    if(page===19 || typeof json.paging?.cursors?.after!=='string') throw new Error('template_catalog_incomplete');
    after=json.paging.cursors.after;
  }
  const rows=pack.templates.map(template=>{
    const approved=catalog.find(t=>approvedTemplateMatches(template,t));
    return {name:template.name,language:template.language,definition:template,status:approved?'APPROVED':'MISSING_OR_CHANGED',checked_at:new Date().toISOString()};
  });
  if(rows.length) checked(await svc.from('communication_whatsapp_templates').upsert(rows,{onConflict:'name,language'}));
  checked(await svc.from('communication_whatsapp_settings').update({template_checked_at:new Date().toISOString()}).eq('id',true));
  return {phone:numberResult.json?.display_phone_number??null,approved:rows.filter(r=>r.status==='APPROVED').length,total:rows.length,issues:pack.issues};
}
async function queueReminders(svc: WhatsAppService,cfg:MetaWhatsAppConfig,now:Date,deadline:number) {
  if(cfg.mode==='test' && !cfg.test_recipients.length) return 0;
  let contactQuery=svc.from('communication_whatsapp_contacts').select('id,user_id,phone,bsuid').eq('phone_number_id',cfg.phone_number_id).not('user_id','is',null).not('consent_at','is',null).is('opted_out_at',null).eq('automation_paused',false).order('last_lifecycle_check_at',{ascending:true,nullsFirst:true}).limit(50);
  if(cfg.mode==='test')contactQuery=contactQuery.in('phone',cfg.test_recipients);
  const contacts:any[]=checked(await contactQuery)??[];
  const allSteps:Step[] = checked(await svc.from('lifecycle_sequence_steps').select('*'))??[];
  let queued=0;
  for(const contact of contacts) {
    if(Date.now()>=deadline) break;
    if(!contact.user_id || (cfg.mode==='test' && !cfg.test_recipients.includes(contact.phone))) continue;
    checked(await svc.from('communication_whatsapp_contacts').update({last_lifecycle_check_at:now.toISOString()}).eq('id',contact.id));
    const account=await (svc as any).auth.admin.getUserById(contact.user_id);
    if(account.error) continue;
    const email=account.data?.user?.email?.toLowerCase();if(!email) continue;
    const enrollments:any[]=checked(await svc.from('lifecycle_enrollments').select('*').eq('email',email).in('status',['active','completed']).order('enrolled_at',{ascending:false}).limit(50))??[];
    for(const enrollment of enrollments) {
      if(Date.now()>=deadline) break;
      const state=checked(await svc.rpc('whatsapp_lifecycle_state',{p_enrollment:enrollment.id,p_contact:contact.id}));
      if(state?.kind!=='ready') continue;
      checked(await svc.rpc('review_whatsapp_followup',{p_enrollment:enrollment.id,p_contact:contact.id}));
      const step=latestDueWhatsAppStep(allSteps.filter((s:any)=>s.sequence_key===enrollment.sequence_key),enrollment.enrolled_at,now.getTime());
      if(!step) continue;
      const existing=checked(await svc.from('communication_whatsapp_messages').select('id').eq('enrollment_id',enrollment.id).eq('position',step.position).maybeSingle());
      if(existing) continue;
      const person:Person={email,fullName:enrollment.full_name,lang:enrollment.lang};
      let compiled:ReturnType<typeof whatsappTemplatePayload>;
      try {compiled=whatsappTemplatePayload(step,person,enrollment.context as Context??{},site());} catch {continue;}
      const approval=checked(await svc.from('communication_whatsapp_templates').select('definition,status,checked_at').eq('name',compiled.definition.name).eq('language',compiled.definition.language).maybeSingle());
      if(approval?.status!=='APPROVED' || !sameWhatsAppDefinition(approval.definition,compiled.definition) || Date.parse(approval.checked_at)<Date.now()-24*3600_000) continue;
      // Existing older queued steps are stale when a newer reminder is due.
      checked(await svc.from('communication_whatsapp_messages').update({status:'blocked',error:'newer_reminder_due'}).eq('enrollment_id',enrollment.id).eq('status','queued').lt('position',step.position));
      const queuedMessage=await svc.rpc('queue_whatsapp_message',{p_contact:contact.id,p_kind:'lifecycle',p_body:compiled.body,
        p_payload:{...compiled.payload,...(contact.phone?{to:contact.phone}:{recipient:contact.bsuid}),groundwork_template:compiled.definition},
        p_enrollment:enrollment.id,p_position:step.position,p_step:step.code??null});
      if(queuedMessage.error) {
        if(queuedMessage.error.message?.includes('whatsapp_action_unavailable')) continue;
        throw new Error('whatsapp_queue_unavailable');
      }
      if(queuedMessage.data) queued++;
    }
  }
  return queued;
}
export async function runWhatsApp(svc: WhatsAppService,limit=10,budgetMs=60_000,onlyMessage?:string) {
  const tally={queued:0,sent:0,failed:0,uncertain:0,blocked:0};
  const deadline=Date.now()+budgetMs;
  const cfg=await metaWhatsAppConfig(svc);
  if(!cfg?.enabled || !cfg.token || !cfg.appSecret || !cfg.webhook_verified_at || !cfg.signed_event_at) return tally;
  if(!onlyMessage && (!cfg.template_checked_at || Date.parse(cfg.template_checked_at)<Date.now()-23*3600_000)) {
    try {await checkWhatsAppConnection(svc,cfg,deadline-15_000);} catch {/* Fresh approvals remain valid; expired approvals never bypass validation. */}
  }
  if(!onlyMessage) tally.queued=await queueReminders(svc,cfg,new Date(),deadline);
  let query=svc.from('communication_whatsapp_messages').select('id,payload,kind,enrollment_id,position').eq('direction','outbound').in('status',['queued','sending']).order('created_at').limit(limit);
  if(onlyMessage) query=query.eq('id',onlyMessage);
  const pending:any[]=checked(await query)??[];
  for(const row of pending) {
    if(Date.now()>=deadline-12_000) break;
    if(row.kind==='lifecycle') {
      const expected=row.payload?.groundwork_template;
      const approval=expected ? checked(await svc.from('communication_whatsapp_templates').select('*').eq('name',expected.name).eq('language',expected.language).maybeSingle()) : null;
      if(approval?.status!=='APPROVED' || !sameWhatsAppDefinition(approval.definition,expected) || Date.parse(approval.checked_at)<Date.now()-24*3600_000) {tally.blocked++;continue;}
      const enrollment=checked(await svc.from('lifecycle_enrollments').select('sequence_key,enrolled_at').eq('id',row.enrollment_id).maybeSingle());
      const steps:Step[]=enrollment?checked(await svc.from('lifecycle_sequence_steps').select('*').eq('sequence_key',enrollment.sequence_key))??[]:[];
      const current=steps.find(s=>s.position===row.position);
      let currentDefinition:WhatsAppTemplate|null=null;
      try{if(current)currentDefinition=whatsappTemplate(current,expected.language,site());}catch{/* Changed copy is held until approved. */}
      const latest=enrollment?latestDueWhatsAppStep(steps,enrollment.enrolled_at,Date.now()):null;
      if(!currentDefinition || !sameWhatsAppDefinition(currentDefinition,expected) || latest?.position!==row.position) {
        checked(await svc.from('communication_whatsapp_messages').update({status:'blocked',error:'reminder_changed'}).eq('id',row.id).eq('status','queued'));tally.blocked++;continue;
      }
    }
    const message=checked(await svc.rpc('claim_whatsapp_message',{p_message:row.id}));
    if(!message) {tally.blocked++;continue;}
    const {groundwork_template:_,...payload}=message.payload;
    const result=await postMetaMessage(cfg,message.id,payload);
    checked(await svc.rpc('finish_whatsapp_message',{p_message:message.id,p_token:message.worker_token,p_status:result.status,p_provider:result.providerId??null,p_error:result.error??null}));
    tally[result.status]++;
  }
  return tally;
}
export async function receiveMetaEvents(svc:WhatsAppService,cfg:MetaWhatsAppConfig,payload:any) {
  if(payload?.object!=='whatsapp_business_account' || !Array.isArray(payload.entry) || payload.entry.length>100) throw new Error('invalid_webhook');
  let handled=0;
  for(const entry of payload.entry) {
    if(String(entry.id)!==cfg.business_account_id) continue;
    for(const change of entry.changes??[]) {
      const value=change.value;
      if(change.field!=='messages' || String(value?.metadata?.phone_number_id)!==cfg.phone_number_id) continue;
      for(const message of value.messages??[]) {
        const phoneRaw=String(message.from??'');
        const phone=/^[1-9]\d{7,14}$/.test(phoneRaw)?`+${phoneRaw}`:null;
        const bsuid=typeof message.from_user_id==='string' && /^[\w.:-]{1,200}$/.test(message.from_user_id)?message.from_user_id:null;
        const stamp=Number(message.timestamp)*1000;
        if((!phone && !bsuid)||!Number.isFinite(stamp)||typeof message.id!=='string') continue;
        const caption=message[message.type]?.caption;
        const body=String(message.text?.body??message.button?.text??message.interactive?.button_reply?.title??message.interactive?.list_reply?.title??`[${String(message.type??'unsupported')} attachment — file viewing is not available in this inbox]${caption?` ${caption}`:''}`).slice(0,30000);
        const command=whatsappCommand(body);
        checked(await svc.rpc('record_whatsapp_inbound',{p_phone_number:cfg.phone_number_id,p_provider:message.id,p_phone:phone,p_bsuid:bsuid,
          p_name:String(value.contacts?.[0]?.profile?.name??'').slice(0,200),p_body:body,p_at:new Date(stamp).toISOString(),
          p_code_hash:command && command!=='stop'?hashConsent(command):null,p_stop:command==='stop'}));handled++;
      }
      for(const status of value.statuses??[]) {
        const stamp=Number(status.timestamp)*1000;if(!Number.isFinite(stamp)) continue;
        const callback=String(status.biz_opaque_callback_data??'').match(/^groundwork:([0-9a-f-]{36})$/i)?.[1]??null;
        checked(await svc.rpc('record_whatsapp_status',{p_phone_number:cfg.phone_number_id,p_provider:status.id,p_status:status.status,p_at:new Date(stamp).toISOString(),p_message:callback,
          p_error:status.errors?.[0]?.code?`meta_${Number(status.errors[0].code)}`:null}));handled++;
      }
    }
  }
  return handled;
}
