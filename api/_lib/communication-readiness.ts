import { communicationBase, UUID } from './communication-email.js';

export const COMMUNICATION_WEBHOOK_EVENTS = [
  'email.received', 'email.sent', 'email.delivered', 'email.bounced',
  'email.complained', 'email.failed', 'email.opened', 'email.clicked',
];
type Failure = 'api_key_missing' | 'api_key_restricted' | 'api_key_rejected' | 'provider_unavailable';
type Result = {ok:true;data:any} | {ok:false;reason:Failure};
type State = 'pass' | 'attention' | 'unknown';
export type SetupCheck = {
  key:'schema'|'sending'|'receiving'|'receivingAccess'|'webhook'|'signingSecret';
  state:State;
  reason:string;
  domains?:string[];
};
type Settings = {sender_email:string|null;followup_sender_email:string;application_sender_email:string;reply_domain:string|null};

/** Fixed provider origin, GET only, bounded retries, and no provider payloads in the report. */
async function providerRead(path:string,key:string):Promise<Result> {
  if(!key)return {ok:false,reason:'api_key_missing'};
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const response=await fetch(`https://api.resend.com${path}`,{
        method:'GET',headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(10_000),
      });
      if(response.status===429&&attempt===0) {
        await new Promise(resolve=>setTimeout(resolve,1100));continue;
      }
      const data=await response.json().catch(()=>null);
      if(response.status===401||response.status===403)return {ok:false,reason:data?.name==='restricted_api_key'?'api_key_restricted':'api_key_rejected'};
      // This reserved nonexistent ID tests permission without reading anyone's mail.
      if(response.status===404&&path.startsWith('/emails/receiving/'))return {ok:true,data:null};
      if(!response.ok||data===null)return {ok:false,reason:'provider_unavailable'};
      return {ok:true,data};
    }catch{return {ok:false,reason:'provider_unavailable'};}
  }
  return {ok:false,reason:'provider_unavailable'};
}

async function providerList(path:'/domains'|'/webhooks',key:string):Promise<Result> {
  const rows:any[]=[];let after='';
  for(let page=0;page<5;page++) {
    const result=await providerRead(`${path}?limit=100${after?`&after=${encodeURIComponent(after)}`:''}`,key);
    if(!result.ok)return result;
    if(!Array.isArray(result.data?.data))return {ok:false,reason:'provider_unavailable'};
    rows.push(...result.data.data);
    if(result.data.has_more===false)return {ok:true,data:rows};
    const next=result.data.data.at(-1)?.id;
    if(typeof next!=='string'||!next||next===after)break;
    after=next;
  }
  // An incomplete page set must not declare an existing domain or webhook missing.
  return {ok:false,reason:'provider_unavailable'};
}

/** Configuration checks only. A passing check does not establish actual email delivery. */
export async function checkCommunicationProvider(settings:Settings|null):Promise<SetupCheck[]> {
  const key=process.env.RESEND_API_KEY?.trim()??'';
  const [domains,hooks,access]=await Promise.all([
    providerList('/domains',key),providerList('/webhooks',key),
    providerRead('/emails/receiving/00000000-0000-0000-0000-000000000000?html_format=cid',key),
  ]);
  const checks:SetupCheck[]=[];
  const check=(key:SetupCheck['key'],state:State,reason:string,domains?:string[])=>checks.push({key,state,reason,...(domains?{domains}:{})});
  const addresses=[settings?.sender_email,settings?.followup_sender_email,settings?.application_sender_email];
  const senders=addresses.filter((value):value is string=>typeof value==='string'&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value));
  if(senders.length!==3)check('sending','attention','senders_required');
  else if(!domains.ok)check('sending','unknown',domains.reason);
  else {
    const names=[...new Set(senders.map(value=>value.split('@')[1].toLowerCase()))];
    const unverified=names.filter(name=>!domains.data.some((domain:any)=>domain.name===name&&domain.status==='verified'&&domain.capabilities?.sending==='enabled'));
    check('sending',unverified.length?'attention':'pass',unverified.length?'sending_unverified':'sending_verified',unverified.length?unverified:names);
  }
  if(!settings?.reply_domain)check('receiving','attention','reply_domain_required');
  else if(!domains.ok)check('receiving','unknown',domains.reason);
  else {
    const domain=domains.data.find((row:any)=>row.name===settings.reply_domain);
    if(!domain||domain.capabilities?.receiving!=='enabled'||!UUID.test(String(domain.id)))check('receiving','attention','receiving_unverified');
    else {
      const detail=await providerRead(`/domains/${encodeURIComponent(domain.id)}`,key);
      if(!detail.ok)check('receiving','unknown',detail.reason);
      else {
        const records=Array.isArray(detail.data?.records)?detail.data.records.filter((row:any)=>row.record==='Receiving'&&row.type==='MX'):[];
        const verified=detail.data?.capabilities?.receiving==='enabled'&&records.length>0&&records.every((row:any)=>row.status==='verified');
        check('receiving',verified?'pass':'attention',verified?'receiving_verified':'receiving_unverified');
      }
    }
  }
  check('receivingAccess',access.ok?'pass':'unknown',access.ok?'receiving_access_verified':access.reason);
  let endpoint:string|null=null;
  try{endpoint=`${communicationBase()}/api/events?action=email-receipt`;}catch{/* Report the missing canonical address without exposing configuration. */}
  if(!endpoint)check('webhook','attention','site_url_required');
  else if(!hooks.ok)check('webhook','unknown',hooks.reason);
  else {
    const matched=hooks.data.filter((row:any)=>row.endpoint===endpoint);
    const enabled=matched.filter((row:any)=>row.status==='enabled');
    const complete=enabled.some((row:any)=>COMMUNICATION_WEBHOOK_EVENTS.every(event=>Array.isArray(row.events)&&row.events.includes(event)));
    check('webhook',complete?'pass':'attention',complete?'webhook_configured':!matched.length?'webhook_required':!enabled.length?'webhook_disabled':'webhook_events_required');
  }
  return checks;
}
