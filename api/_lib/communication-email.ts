/** Product communication delivery. Recipients come from saved threads, never a form. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CommunicationSettings {
  delivery_enabled: boolean; sender_name: string; sender_email: string | null; followup_sender_email:string; application_sender_email:string; reply_domain: string | null;
  test_recipients: string[]; default_owner_id: string | null; next_contact_hours: number; updated_at: string;
}
export interface CommunicationPayload {
  from: string; to: string; subject: string; html: string; text: string;
  reply_to: string; headers: Record<string,string>; tags?: { name: string; value: string }[];
}
type Service = { from: (table: string) => any; rpc: (name: string, args: Record<string,unknown>) => any };
const escape = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const oneLine = (value: string) => value.replace(/[\r\n]/g,' ').trim();
export function communicationBase(): string {
  const raw=process.env.PUBLIC_SITE_URL?.trim();
  if (!raw) throw new Error('PUBLIC_SITE_URL not set');
  const url=new URL(raw);
  if (url.username || url.password || url.search || url.hash || (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('PUBLIC_SITE_URL invalid');
  return raw.replace(/\/+$/,'');
}
export async function communicationSettings(svc: Service): Promise<CommunicationSettings> {
  const {data,error}=await svc.from('communication_settings').select('*').eq('id',true).single();
  if(error) throw error;
  if(!data) throw new Error('Communication settings unavailable');
  return data;
}
/** Application mail is independent of the activation delivery switch. */
export async function applicationSender(svc: Service): Promise<string> {
  const settings=await communicationSettings(svc);
  if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(settings.application_sender_email)) throw new Error('Application sender not configured');
  return `${oneLine(settings.sender_name).replace(/[<>]/g,'')} <${settings.application_sender_email}>`;
}
export function composeCommunicationEmail(input: {
  to: string; subject: string; body: string; lang?: string; threadId: string; preferenceToken: string;
  senderName: string; senderEmail: string; replyDomain: string;
  cta?: { label: string; path: string } | null; projectOptOut?: boolean; inReplyTo?: string | null;
}): CommunicationPayload {
  if(!UUID.test(input.threadId) || !UUID.test(input.preferenceToken)) throw new Error('Invalid communication identity');
  if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(input.to)||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(input.senderEmail)
    || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]+$/i.test(input.replyDomain)) throw new Error('Invalid communication address');
  const base=communicationBase();const fr=input.lang==='fr';
  const preferences=`${base}/communication/preferences/${input.preferenceToken}`;
  const unsubscribe=`${base}/api/events?action=communication-unsubscribe&token=${input.preferenceToken}`;
  const cta=input.cta?.path.startsWith('/') && !input.cta.path.startsWith('//') ? {label:input.cta.label,url:base+input.cta.path} : null;
  const preferenceLabel=fr?'Gérer mes rappels':'Manage reminder preferences';
  const projectLabel=fr?'Aucun projet à ajouter pour le moment ? Suspendre ces rappels.':'No project to add right now? Pause these project reminders.';
  const footer=`${input.projectOptOut ? `${projectLabel}\n${preferences}#project\n\n` : ''}${preferenceLabel}: ${preferences}`;
  const bodyHtml=input.body.split(/\n{2,}/).map(p=>`<p>${escape(p).replace(/\n/g,'<br>')}</p>`).join('');
  const headers: Record<string,string>={'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'};
  if(input.inReplyTo && /^<[^<>\r\n]{1,450}>$/.test(input.inReplyTo)) { headers['In-Reply-To']=input.inReplyTo;headers.References=input.inReplyTo; }
  return {
    from:`${oneLine(input.senderName).replace(/[<>]/g,'')} <${input.senderEmail}>`,to:input.to,
    subject:oneLine(input.subject),reply_to:`reply+${input.threadId}@${input.replyDomain}`,
    text:`${input.body}${cta?`\n\n${cta.label}: ${cta.url}`:''}\n\n${footer}`,
    html:`<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;max-width:560px">${bodyHtml}${cta?`<p><a href="${escape(cta.url)}">${escape(cta.label)}</a></p>`:''}${input.projectOptOut?`<p><a href="${escape(preferences)}#project">${escape(projectLabel)}</a></p>`:''}<p style="font-size:12px"><a href="${escape(preferences)}">${escape(preferenceLabel)}</a></p><p>Groundwork by Jalla</p></div>`,headers,
  };
}
export async function sendCommunicationEmail(payload: CommunicationPayload, idempotencyKey: string): Promise<{ok:boolean;error?:string;providerId?:string}> {
  const key=process.env.RESEND_API_KEY?.trim();
  if(!key) return {ok:false,error:'RESEND_API_KEY not set'};
  try {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20_000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload)});
    if(!response.ok) return {ok:false,error:`resend_${response.status}`};
    const result=await response.json().catch(()=>({}));
    return typeof result.id==='string'?{ok:true,providerId:result.id}:{ok:false,error:'resend_response_invalid'};
  } catch {return {ok:false,error:'resend_connection_uncertain'};}
}
export async function sendQueuedCommunicationReplies(svc: Service, now=new Date(),limit=5) {
  const tally={sent:0,failed:0,skipped:0};
  const settings=await communicationSettings(svc);if(!settings.delivery_enabled) return tally;
  const {data,error}=await svc.from('communication_messages').select('id').eq('direction','outbound').not('client_ref','is',null).in('status',['queued','failed','sending']).lte('next_attempt_at',now.toISOString()).order('next_attempt_at').limit(limit);
  if(error) throw error;
  for(const row of data??[]) {
    const preview=await svc.rpc('prepare_communication_reply',{p_message:row.id,p_payload:null});
    if(preview.error) throw preview.error;
    const m=preview.data;if(!m) {tally.skipped++;continue;}
    const c=m.payload;
    const payload=m.started_at?c:composeCommunicationEmail({to:c.to,subject:m.subject,body:m.body,lang:c.lang,threadId:m.thread_id,preferenceToken:c.preference_token,senderName:c.sender_name,senderEmail:c.sender_email,replyDomain:c.reply_domain,inReplyTo:m.in_reply_to});
    if(!m.started_at) payload.tags=[{name:'groundwork_message',value:m.id}];
    const prepared=await svc.rpc('prepare_communication_reply',{p_message:m.id,p_payload:payload});
    if(prepared.error) throw prepared.error;
    if(!prepared.data) {tally.skipped++;continue;}
    const result=await sendCommunicationEmail(prepared.data.payload,`communication/${m.id}`);
    const finished=await svc.rpc('finish_communication_reply',{p_message:m.id,p_token:prepared.data.worker_token,p_ok:result.ok,p_provider_id:result.providerId??null,p_error:result.error??null});
    if(finished.error) throw finished.error;
    if(!finished.data) tally.skipped++;else if(result.ok) tally.sent++;else tally.failed++;
  }
  return tally;
}
const address=(value: unknown): string => typeof value==='string'?(value.match(/<([^<>]+)>\s*$/)?.[1]??value).trim().toLowerCase():'';
async function boundedJson(response: Response) {
  if(!response.body || Number(response.headers.get('content-length'))>512_000) throw new Error('Inbound email too large');
  const reader=response.body.getReader();const parts: Uint8Array[]=[];let size=0;
  try {for(;;) {const {done,value}=await reader.read();if(done) break;size+=value.byteLength;if(size>512_000) throw new Error('Inbound email too large');parts.push(value);}}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export async function receiveCommunicationEmail(svc: Service, data: any) {
  const id=data?.email_id;
  if(typeof id!=='string'||!UUID.test(id)) throw new Error('Invalid inbound email id');
  const key=process.env.RESEND_API_KEY?.trim();if(!key) throw new Error('RESEND_API_KEY not set');
  const response=await fetch(`https://api.resend.com/emails/receiving/${id}?html_format=cid`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15_000)});
  if(!response.ok) throw new Error(`inbound_provider_${response.status}`);
  const email=await boundedJson(response);
  if(email.id!==id) throw new Error('Inbound identity mismatch');
  const recipients=Array.isArray(email.to)?email.to.map(address):[];
  const tokens=recipients.flatMap((recipient: string)=>{
    const parts=recipient.split('@');const token=parts[0]?.startsWith('reply+')?parts[0].slice(6):'';
    return parts.length===2&&UUID.test(token)?[token]:[];
  });
  const threads=[...new Set(tokens)];
  if(threads.length!==1) return {ignored:true,reason:'reply_address_unavailable'};
  const thread=await svc.from('communication_threads').select('reply_domains').eq('id',threads[0]).maybeSingle();
  if(thread.error) throw thread.error;
  if(!thread.data || !recipients.some((recipient:string)=>recipient.split('@')[0]===`reply+${threads[0]}` && thread.data.reply_domains.includes(recipient.split('@')[1]))) return {ignored:true,reason:'reply_address_unavailable'};
  const sender=address(email.from);if(!sender) return {ignored:true,reason:'sender_unavailable'};
  const auth=email.authentication;
  // DMARC proves alignment with the visible sender. DKIM alone may authenticate
  // a different domain, so it must not let a spoofed sender pause reminders.
  const authenticated=auth?.dmarc==='pass';
  const text=typeof email.text==='string'?email.text:typeof email.html==='string'?email.html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' '):'';
  const result=await svc.rpc('record_communication_inbound',{p_provider_id:id,p_thread:threads[0],p_sender:sender,p_subject:oneLine(String(email.subject??'')).slice(0,300),p_body:text.slice(0,30000),p_message_id:typeof email.message_id==='string'?email.message_id:null,p_authenticated:authenticated,p_received_at:typeof email.created_at==='string'&&Number.isFinite(Date.parse(email.created_at))?email.created_at:new Date().toISOString(),p_attachments:Array.isArray(email.attachments)?email.attachments.length:0});
  if(result.error) throw result.error;
  return result.data;
}
