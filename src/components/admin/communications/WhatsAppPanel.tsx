import { useCallback,useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'react-router';
import { useT } from '@/lib/i18n';
import { whatsappEn } from '@/lib/i18n/whatsapp';
import { supabase } from '@/lib/supabase/client';
import { whatsappApi } from '@/lib/supabase/whatsapp-communications';
import { serviceWindowOpen } from '../../../../shared/whatsapp';

type Contact={id:string;phone:string|null;bsuid:string|null;name:string;user_id:string|null;consent_at:string|null;opted_out_at:string|null;automation_paused:boolean;needs_attention:boolean;last_inbound_at:string|null};
type Message={id:string;direction:string;body:string;status:string;kind:string;error:string|null;created_at:string;reviewed_at?:string|null;review_note?:string|null};
const input='mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm';
const button='rounded-lg border px-3 py-2 text-sm disabled:opacity-40';
function useWhatsAppError() {
  const t=useT();
  return (code:string)=>{const key=Object.hasOwn(whatsappEn.errors,code)?code as keyof typeof whatsappEn.errors:'unknown';return t(`whatsapp.errors.${key}`,{code});};
}
function SendReview({messageId,busy,onReview}:{messageId:string;busy:boolean;onReview:(data:Record<string,unknown>)=>void}) {
  const t=useT();
  const [sent,setSent]=useState(true);const [providerId,setProviderId]=useState('');const [note,setNote]=useState('');const [confirmed,setConfirmed]=useState(false);
  return <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-sm">{t('whatsapp.review')}</summary>
    <p className="mt-2 text-xs">{t('whatsapp.reviewHelp')}</p>
    <label className="mt-2 block text-xs">{t('whatsapp.finding')}<select className={input} value={sent?'sent':'not_sent'} onChange={e=>setSent(e.target.value==='sent')}><option value="sent">{t('whatsapp.accepted')}</option><option value="not_sent">{t('whatsapp.notSent')}</option></select></label>
    {sent&&<label className="mt-2 block text-xs">{t('whatsapp.messageId')}<input className={input} value={providerId} onChange={e=>setProviderId(e.target.value)} autoComplete="off"/></label>}
    <label className="mt-2 block text-xs">{t('whatsapp.reviewNote')}<textarea className={input} minLength={10} maxLength={1000} rows={2} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('whatsapp.reviewConfirm')}</label>
    <button type="button" disabled={busy||!confirmed||note.trim().length<10||(sent&&!providerId)} className={`${button} mt-2`} onClick={()=>onReview({operation:'review_send',messageId,sent,providerId,note,confirmReview:true})}>{t('whatsapp.recordReview')}</button>
  </details>;
}

export function WhatsAppPanel() {
  const t=useT();const whatsappError=useWhatsAppError();
  const statusLabel=(status:string)=>Object.hasOwn(whatsappEn.statuses,status)?t(`whatsapp.statuses.${status as keyof typeof whatsappEn.statuses}`):status;
  const [params]=useSearchParams();const initial=params.get('contact');
  const [settings,setSettings]=useState<any>(null);const [credentials,setCredentials]=useState<any>({});const [callback,setCallback]=useState('');
  const [secret,setSecret]=useState({token:'',appSecret:'',verifyToken:''});const [generated,setGenerated]=useState('');
  const [contacts,setContacts]=useState<Contact[]>([]);const [selected,setSelected]=useState<string|null>(initial);
  const [thread,setThread]=useState<{contact:string;messages:Message[]}|null>(null);
  const [draft,setDraft]=useState<{contact:string;body:string;ref:string}|null>(null);
  const [testRef,setTestRef]=useState<string|null>(null);const [testConfirmed,setTestConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);const working=useRef(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [catalog,setCatalog]=useState<any[]>([]);const [recent,setRecent]=useState<Array<{status:string}>>([]);
  const live=useRef(true);const current=useRef(selected);current.current=selected;
  const load=useCallback(async()=>{
    const config=await whatsappApi('whatsapp-admin');
    const [people,templates,messages]=await Promise.all([
      supabase.from('communication_whatsapp_contacts').select('*').eq('phone_number_id',config.settings.phone_number_id).order('last_message_at',{ascending:false}).limit(200),
      supabase.from('communication_whatsapp_templates').select('name,language,status,checked_at').order('name'),
      supabase.from('communication_whatsapp_messages').select('status').eq('direction','outbound').order('created_at',{ascending:false}).limit(500),
    ]);
    if([people,templates,messages].some(r=>r.error)) throw new Error('whatsapp_load_failed');
    if(!live.current)return;
    setSettings(config.settings);setCredentials(config.credentials);setCallback(config.callbackUrl);
    setContacts(people.data as Contact[]);setCatalog(templates.data??[]);setRecent(messages.data??[]);
  },[]);
  const refreshContacts=useCallback(async()=>{
    if(!settings?.phone_number_id)return;
    const [result,outbound]=await Promise.all([
      supabase.from('communication_whatsapp_contacts').select('*').eq('phone_number_id',settings.phone_number_id).order('last_message_at',{ascending:false}).limit(200),
      supabase.from('communication_whatsapp_messages').select('status').eq('direction','outbound').order('created_at',{ascending:false}).limit(500),
    ]);
    if(!result.error&&live.current)setContacts(result.data as Contact[]);
    if(!outbound.error&&live.current)setRecent(outbound.data??[]);
  },[settings?.phone_number_id]);
  useEffect(()=>{live.current=true;void load().catch(e=>setError(whatsappError(e.message)));return()=>{live.current=false;};},[load]);
  useEffect(()=>{if(initial)setSelected(initial);},[initial]);
  useEffect(()=>{void refreshContacts();const poll=setInterval(()=>void refreshContacts(),10_000);return()=>clearInterval(poll);},[refreshContacts]);
  useEffect(()=>{
    if(!selected)return;let valid=true;
    const refresh=async()=>{
      const result=await supabase.from('communication_whatsapp_messages').select('id,direction,body,status,kind,error,created_at,reviewed_at,review_note').eq('contact_id',selected).order('created_at',{ascending:false}).limit(200);
      if(valid&&live.current){if(result.error)setError(t('whatsapp.loadFailed'));else setThread({contact:selected,messages:(result.data as Message[]).reverse()});}
    };
    void refresh();const poll=setInterval(()=>void refresh(),10_000);return()=>{valid=false;clearInterval(poll);};
  },[selected,t]);
  const contact=contacts.find(c=>c.id===selected);
  const messages=thread?.contact===selected?thread.messages:null;
  const body=draft?.contact===selected?draft.body:'';
  async function operation(work:()=>Promise<void>) {
    if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');
    try{await work();}catch(e){if(live.current)setError(whatsappError(e instanceof Error?e.message:'whatsapp_unavailable'));}
    finally{working.current=false;if(live.current)setBusy(false);}
  }
  async function send(test=false) {
    if(!contact)return;
    const id=contact.id;const ref=test?(testRef??crypto.randomUUID()):(draft?.contact===id?draft.ref:crypto.randomUUID());
    if(test)setTestRef(ref);
    await operation(async()=>{
      const result=await whatsappApi('whatsapp-admin',{operation:test?'test':'reply',contactId:id,clientRef:ref,text:body,confirmTest:testConfirmed});
      if(current.current===id) {
        setNotice(result.error?whatsappError(result.error):result.status==='queued'?t('whatsapp.queued'):t('whatsapp.sentNotice',{status:statusLabel(result.status)}));
        // An uncertain result keeps its client reference; retrying cannot duplicate it.
        if(['sent','delivered','read'].includes(result.status)) {if(test){setTestRef(null);setTestConfirmed(false);}else setDraft(null);}
        if(['failed','blocked'].includes(result.status)) {if(test)setTestRef(null);else setDraft(previous=>previous?.contact===id?{...previous,ref:crypto.randomUUID()}:previous);}
        const resultMessages=await supabase.from('communication_whatsapp_messages').select('id,direction,body,status,kind,error,created_at,reviewed_at,review_note').eq('contact_id',id).order('created_at',{ascending:false}).limit(200);
        if(!resultMessages.error)setThread({contact:id,messages:(resultMessages.data as Message[]).reverse()});
      }
    });
  }
  return <section className="space-y-6">
    <header><h2 className="text-lg font-semibold">{t('whatsapp.title')}</h2><p className="mt-2 max-w-3xl text-sm text-brand-mid-grey">{t('whatsapp.help')}</p></header>
    {error&&<p role="alert" className="rounded-xl border p-3 text-sm text-state-alert">{error}</p>}{notice&&<p role="status" className="rounded-xl border p-3 text-sm">{notice}</p>}
    {!settings?<p>{t('whatsapp.loading')}</p>:<>
      <details className="rounded-2xl border bg-white p-5 dark:bg-[#181818]" open={!credentials.token}>
        <summary className="cursor-pointer font-semibold">{t('whatsapp.connection')} · {t(settings.enabled?'whatsapp.enabled':'whatsapp.off')} · {t(settings.mode==='test'?'whatsapp.testOnly':'whatsapp.live')}</summary>
        <form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();void operation(async()=>{
          await whatsappApi('whatsapp-admin',{operation:'save',...settings,...secret});setSecret({token:'',appSecret:'',verifyToken:''});setGenerated('');await load();setNotice(t('whatsapp.savedNotice'));
        });}}>
          <div className="grid gap-4 sm:grid-cols-2">
            {([['phone_number_id',t('whatsapp.phoneId')],['business_account_id',t('whatsapp.accountId')],['display_phone',t('whatsapp.phone')],['messaging_account_id',t('whatsapp.messagingId')]] as const).map(([key,label])=><label key={key} className="text-sm">{label}<input autoComplete="off" value={settings[key]} onChange={e=>setSettings({...settings,[key]:e.target.value})} className={input}/></label>)}
            <label className="text-sm">{t('whatsapp.audience')}<select value={settings.mode} onChange={e=>setSettings({...settings,mode:e.target.value})} className={input}><option value="test">{t('whatsapp.testOnly')}</option><option value="live">{t('whatsapp.live')}</option></select></label>
            <label className="text-sm">{t('whatsapp.testPhones')}<textarea rows={3} value={settings.test_recipients.join('\n')} onChange={e=>setSettings({...settings,test_recipients:e.target.value.split('\n')})} className={input}/></label>
          </div>
          <p className="text-xs text-brand-mid-grey">{t('whatsapp.version',{version:settings.api_version})}</p>
          <div className="grid gap-4 sm:grid-cols-3">{([['token',t('whatsapp.token')],['appSecret',t('whatsapp.appSecret')],['verifyToken',t('whatsapp.verifyToken')]] as const).map(([key,label])=><label key={key} className="text-sm">{label} · {t(credentials[key]?'whatsapp.saved':'whatsapp.needed')}<input type="password" autoComplete="new-password" value={secret[key]} onChange={e=>setSecret({...secret,[key]:e.target.value})} className={input}/></label>)}</div>
          <button disabled={busy} className={`${button} bg-brand-green text-white`} type="submit">{t('whatsapp.save')}</button>
        </form>
        <div className="mt-5 border-t pt-4 text-sm"><p className="font-semibold">{t('whatsapp.callback')}</p><code className="mt-2 block break-all rounded-lg bg-brand-off-white p-3 dark:bg-[#222]">{callback}</code>
          <p className="my-2">{t('whatsapp.callbackHelp')}</p>
          <p>{t('whatsapp.challenge')}: {t(settings.webhook_verified_at?'whatsapp.verified':'whatsapp.pending')} · {t('whatsapp.signedEvent')}: {t(settings.signed_event_at?'whatsapp.received':'whatsapp.pending')}</p>
          <button type="button" disabled={busy} className={`${button} mt-3`} onClick={()=>void operation(async()=>{const result=await whatsappApi('whatsapp-admin',{operation:'generate_verify_token'});setGenerated(result.verifyToken);await load();})}>{t('whatsapp.generate')}</button>
          {generated&&<div className="mt-3 rounded-lg border p-3"><p>{t('whatsapp.tokenHelp')}</p><code className="mt-2 block select-all break-all">{generated}</code><button type="button" className="mt-2 underline" onClick={()=>setGenerated('')}>{t('whatsapp.hide')}</button></div>}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
          <button type="button" disabled={busy} className={button} onClick={()=>void operation(async()=>{const result=await whatsappApi('whatsapp-admin',{operation:'check'});await load();setNotice(t('whatsapp.checkedNotice',{approved:result.approved,total:result.total,issues:result.issues.length}));})}>{t('whatsapp.check')}</button>
          <button type="button" disabled={busy} className={button} onClick={()=>void operation(async()=>{await whatsappApi('whatsapp-admin',{operation:'save',enabled:!settings.enabled});await load();setNotice(settings.enabled?t('whatsapp.pausedNotice'):t('whatsapp.enabledNotice'));})}>{settings.enabled?t('whatsapp.pause'):t('whatsapp.enable')}</button>
        </div>
      </details>
      <details className="rounded-2xl border p-5"><summary className="cursor-pointer font-semibold">{t('whatsapp.templates')}</summary>
        <p className="my-3 text-sm">{t('whatsapp.timing')}</p>
        <button type="button" disabled={busy} className={button} onClick={()=>void operation(async()=>{
          const pack=await whatsappApi('whatsapp-admin',{operation:'templates'});const exportPack={templates:pack.templates.map(({variables:_,...template}:any)=>template),issues:pack.issues};
          const url=URL.createObjectURL(new Blob([JSON.stringify(exportPack,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='groundwork-whatsapp-templates.json';a.click();URL.revokeObjectURL(url);
          setNotice(t('whatsapp.exportNotice',{issues:pack.issues.length}));
        })}>{t('whatsapp.export')}</button>
        <p className="mt-3 text-xs text-brand-mid-grey">{t('whatsapp.approvalHelp')}</p>
        <div className="mt-3 max-h-64 overflow-y-auto text-xs">{catalog.map(item=><p key={`${item.name}-${item.language}`} className="border-t py-2">{item.name} · {item.language} · {t(item.status==='APPROVED'?'whatsapp.verified':'whatsapp.needed')} · {t('whatsapp.checked')} {new Date(item.checked_at).toLocaleString()}</p>)}</div>
      </details>
      <div className="flex flex-wrap gap-3 text-xs"><span>{t('whatsapp.latest',{count:recent.length})}:</span>{['queued','sent','delivered','read','failed','uncertain','blocked'].map(status=><span key={status}>{statusLabel(status)}: {recent.filter(r=>r.status===status).length}</span>)}</div>
      <section>
        <div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">{t('whatsapp.inbox')}</h3><button type="button" disabled={busy} className={button} onClick={()=>void operation(load)}>{t('whatsapp.refresh')}</button></div>
        {!contacts.length?<p className="text-sm">{t('whatsapp.empty')}</p>:<div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
          <nav aria-label={t('whatsapp.contacts')} className="max-h-[65vh] space-y-2 overflow-y-auto">{contacts.map(item=><button type="button" key={item.id} onClick={()=>{setSelected(item.id);setTestConfirmed(false);setTestRef(null);setError('');setNotice('');}} aria-pressed={selected===item.id} className={`block w-full rounded-xl border p-3 text-left text-sm ${selected===item.id?'border-brand-green':''}`}><p className="font-semibold">{item.name||item.phone||item.bsuid}</p><p className="break-all text-xs">{item.phone||item.bsuid}</p><p className="mt-1 text-xs">{item.opted_out_at?t('whatsapp.stopped'):item.needs_attention?t('whatsapp.attention'):item.consent_at?t('whatsapp.connected'):t('whatsapp.consentNeeded')}</p></button>)}</nav>
          {!contact?<p className="text-sm">{t('whatsapp.choose')}</p>:<article className="min-w-0 rounded-2xl border bg-white p-4 dark:bg-[#181818]">
            <h4 className="font-semibold">{contact.name||contact.phone||contact.bsuid}</h4><p className="mt-1 text-xs">{contact.phone||contact.bsuid} · {serviceWindowOpen(contact.last_inbound_at)?t('whatsapp.openWindow'):t('whatsapp.closedWindow')}</p>
            {contact.opted_out_at&&<p className="mt-3 text-sm">{t('whatsapp.stoppedHelp')}</p>}
            {contact.automation_paused&&!contact.opted_out_at&&<div className="mt-3 rounded-xl border p-3 text-sm"><p>{t('whatsapp.holdHelp')}</p><button type="button" disabled={busy||!contact.consent_at} className="mt-2 underline" onClick={()=>void operation(async()=>{await whatsappApi('whatsapp-admin',{operation:'resume',contactId:contact.id});await refreshContacts();setNotice(t('whatsapp.resumed'));})}>{t('whatsapp.resume')}</button></div>}
            <div className="my-4 max-h-[50vh] space-y-3 overflow-y-auto">{messages===null?<p className="text-sm">{t('whatsapp.loadingMessages')}</p>:messages.map(message=><section key={message.id} className={`rounded-xl border p-3 ${message.direction==='inbound'?'border-brand-green/30':'bg-brand-off-white dark:bg-[#222]'}`}><p className="text-xs text-brand-mid-grey">{message.direction==='inbound'?t('whatsapp.recipient'):message.kind==='staff'?t('whatsapp.staff'):message.kind==='test'?t('whatsapp.test'):t('whatsapp.automated')} · {statusLabel(message.status)} · {new Date(message.created_at).toLocaleString()}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.body}</p>{message.error&&<p className="mt-2 text-xs text-state-alert">{whatsappError(message.error)}</p>}{message.reviewed_at&&<p className="mt-2 text-xs">{t('whatsapp.staffReview')}: {message.review_note}</p>}{message.status==='uncertain'&&<SendReview messageId={message.id} busy={busy} onReview={data=>void operation(async()=>{const result=await whatsappApi('whatsapp-admin',data);setNotice(result.resolved?t('whatsapp.reviewed'):t('whatsapp.alreadyReviewed'));setThread(null);await refreshContacts();})}/>}</section>)}</div>
            <form onSubmit={e=>{e.preventDefault();void send();}}><label className="text-sm">{t('whatsapp.reply')}<textarea rows={3} maxLength={4000} value={body} disabled={busy} onChange={e=>setDraft({contact:contact.id,body:e.target.value,ref:draft?.contact===contact.id&&draft.body===e.target.value?draft.ref:crypto.randomUUID()})} className={input}/></label><p className="mt-2 text-xs">{serviceWindowOpen(contact.last_inbound_at)?t('whatsapp.replyHelp'):t('whatsapp.closedHelp')}</p><button type="submit" disabled={busy||!settings.enabled||!!contact.opted_out_at||!body.trim()||!serviceWindowOpen(contact.last_inbound_at)} className={`${button} mt-3 bg-brand-green text-white`}>{t('whatsapp.send')}</button></form>
            {settings.mode==='test'&&<div className="mt-5 border-t pt-4 text-sm"><label className="flex items-start gap-2"><input type="checkbox" checked={testConfirmed} onChange={e=>setTestConfirmed(e.target.checked)} className="mt-1"/>{t('whatsapp.testConsent')}</label><button type="button" className={`${button} mt-3`} disabled={busy||!testConfirmed||!settings.enabled||!contact.consent_at||!!contact.opted_out_at} onClick={()=>void send(true)}>{t('whatsapp.testSend')}</button></div>}
          </article>}
        </div>}
      </section>
    </>}
  </section>;
}
