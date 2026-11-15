import { communicationBase, communicationSettings, sendCommunicationEmail, type CommunicationPayload } from './communication-email.js';

type Service = { from:(table:string)=>any; rpc:(name:string,args:Record<string,unknown>)=>any };
type Role = 'client'|'contractor'|'verifier'|'admin';
const roles = ['client','contractor','verifier','admin'];
const escape = (text:string) => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const oneLine = (text:string) => text.replace(/[\r\n<>]/g,' ').trim();

/** Transactional account notice: no activation opt-out or reminder footer. */
export function composeAccountRoleNotification(input:{
  email:string;role:Role;lang?:string;fullName?:string;senderName:string;senderEmail:string;replyEmail:string;
  onboarding?:{complete?:boolean;client_intent?:string|null;existing_project_count?:number;existing_project_path?:string|null}|null;
}):CommunicationPayload {
  if(!roles.includes(input.role)||[input.email,input.senderEmail,input.replyEmail].some(value=>!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value))) throw new Error('account_notification_configuration_required');
  const fr=input.lang==='fr';
  const label=fr?{client:'client',contractor:'entrepreneur',verifier:'vérificateur',admin:'administrateur'}[input.role]
    :{client:'client',contractor:'contractor',verifier:'verifier',admin:'admin'}[input.role];
  const setup=input.role==='contractor'&&!(input.onboarding?.complete&&input.onboarding.client_intent);
  let path={client:'/dashboard',contractor:'/work',verifier:'/verifiers',admin:'/admin'}[input.role];
  const project=input.onboarding?.existing_project_path;
  if(input.role==='contractor'&&project&&(project==='/work/projects'||/^\/(?:work\/)?projects\/[a-zA-Z0-9_-]+$/.test(project))) path=project;
  if(setup) path='/work/onboarding'+(project&&/^\/work\/projects\/[a-zA-Z0-9_-]+$/.test(project)?`?redirect=${encodeURIComponent(project)}`:'');
  const base=new URL(communicationBase());
  if(base.hostname==='tryjalla.com')base.hostname='www.tryjalla.com';
  const url=new URL(path,base).toString();
  const subject=fr?'Votre rôle sur Groundwork a été mis à jour':'Your Groundwork account role has been updated';
  const greeting=fr?`Bonjour${input.fullName?` ${input.fullName}`:''},`:`Hello${input.fullName?` ${input.fullName}`:''},`;
  const body=fr?`${greeting}\n\nVotre compte Groundwork a été mis à jour avec le rôle ${label}.\n\n${setup?'Terminez votre inscription comme entrepreneur pour accéder à votre espace. Vos projets existants restent liés à votre compte.':'Ouvrez Groundwork pour continuer avec votre rôle actuel.'}\n\nRépondez à cet e-mail si vous souhaitez de l’aide.`
    :`${greeting}\n\nYour Groundwork account has been updated to a ${label} account.\n\n${setup?'Complete your contractor onboarding to access your workspace. Your existing projects remain linked to your account.':'Open Groundwork to continue with your current role.'}\n\nReply to this email if you would like help.`;
  const cta=setup?(fr?'Terminer mon inscription':'Complete contractor onboarding'):(fr?'Ouvrir mon compte':'Open my account');
  return {from:`${oneLine(input.senderName)} <${input.senderEmail}>`,to:input.email,subject,reply_to:input.replyEmail,
    text:`${body}\n\n${cta}: ${url}\n\nGroundwork by Jalla`,
    html:`<div style="font-family:Arial,sans-serif;line-height:1.55;max-width:560px">${body.split('\n\n').map(p=>`<p>${escape(p).replace(/\n/g,'<br>')}</p>`).join('')}<p><a href="${escape(url)}">${escape(cta)}</a></p><p>Groundwork by Jalla</p></div>`,headers:{}};
}

/** The existing five-minute worker retries a frozen payload with one provider key. */
export async function sendAccountRoleNotifications(svc:Service,now=new Date(),limit=1) {
  const tally={sent:0,failed:0,skipped:0};
  const due=await svc.from('account_role_notifications').select('id').in('status',['queued','failed','sending'])
    .lte('next_attempt_at',now.toISOString()).order('next_attempt_at').limit(limit);
  if(due.error){
    // Rolling deployment: the old worker can continue until the migration is applied.
    if(['42P01','PGRST205'].includes(due.error.code))return {...tally,migrationRequired:true};
    throw due.error;
  }
  if(!due.data?.length)return tally;
  const settings=await communicationSettings(svc);
  for(const row of due.data) {
    const claimed=await svc.rpc('claim_account_role_notification',{p_id:row.id});
    if(claimed.error)throw claimed.error;
    const notice=claimed.data;if(!notice){tally.skipped++;continue;}
    let payload:CommunicationPayload;
    try {
      payload=notice.payload??composeAccountRoleNotification({email:notice.email,role:notice.to_role,lang:notice.lang,
        fullName:notice.full_name??'',senderName:settings.sender_name,senderEmail:settings.sender_email??'',
        replyEmail:settings.followup_sender_email,onboarding:notice.onboarding});
    }catch{
      const saved=await svc.rpc('finish_account_role_notification',{p_id:notice.id,p_worker:notice.worker_token,p_provider:null,p_error:'account_notification_configuration_required'});
      if(saved.error)throw saved.error;tally.failed++;continue;
    }
    const prepared=await svc.rpc('prepare_account_role_notification',{p_id:notice.id,p_worker:notice.worker_token,p_payload:payload});
    if(prepared.error)throw prepared.error;
    if(!prepared.data){tally.skipped++;continue;}
    const result=await sendCommunicationEmail(prepared.data,`account-role/${notice.id}`);
    const finished=await svc.rpc('finish_account_role_notification',{p_id:notice.id,p_worker:notice.worker_token,
      p_provider:result.ok?result.providerId??null:null,p_error:result.ok?null:result.error??'delivery_failed'});
    if(finished.error)throw finished.error;
    result.ok?tally.sent++:tally.failed++;
  }
  return tally;
}
