import { useCallback,useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase/client';
import { whatsappApi } from '@/lib/supabase/whatsapp-communications';
import { serviceWindowOpen,whatsappError } from '../../../../shared/whatsapp';

type Contact={id:string;phone:string|null;bsuid:string|null;name:string;user_id:string|null;consent_at:string|null;opted_out_at:string|null;automation_paused:boolean;needs_attention:boolean;last_inbound_at:string|null};
type Message={id:string;direction:string;body:string;status:string;kind:string;error:string|null;created_at:string;reviewed_at?:string|null;review_note?:string|null};
const input='mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm';
const button='rounded-lg border px-3 py-2 text-sm disabled:opacity-40';
function SendReview({messageId,busy,onReview}:{messageId:string;busy:boolean;onReview:(data:Record<string,unknown>)=>void}) {
  const [sent,setSent]=useState(true);const [providerId,setProviderId]=useState('');const [note,setNote]=useState('');const [confirmed,setConfirmed]=useState(false);
  return <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-sm">Review uncertain send</summary>
    <p className="mt-2 text-xs">Check WhatsApp Manager and the recipient before deciding. This records the finding and never resends the message.</p>
    <label className="mt-2 block text-xs">Finding<select className={input} value={sent?'sent':'not_sent'} onChange={e=>setSent(e.target.value==='sent')}><option value="sent">Meta accepted the message</option><option value="not_sent">Confirmed that the message was not sent</option></select></label>
    {sent&&<label className="mt-2 block text-xs">Meta message ID (wamid…)<input className={input} value={providerId} onChange={e=>setProviderId(e.target.value)} autoComplete="off"/></label>}
    <label className="mt-2 block text-xs">What did you verify?<textarea className={input} minLength={10} maxLength={1000} rows={2} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked this result. Recording it allows later reminders to continue when eligible.</label>
    <button type="button" disabled={busy||!confirmed||note.trim().length<10||(sent&&!providerId)} className={`${button} mt-2`} onClick={()=>onReview({operation:'review_send',messageId,sent,providerId,note,confirmReview:true})}>Record delivery review</button>
  </details>;
}

export function WhatsAppPanel() {
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
    const result=await supabase.from('communication_whatsapp_contacts').select('*').order('last_message_at',{ascending:false}).limit(200);
    if(!result.error&&live.current)setContacts(result.data as Contact[]);
  },[]);
  useEffect(()=>{live.current=true;void load().catch(e=>setError(whatsappError(e.message)));return()=>{live.current=false;};},[load]);
  useEffect(()=>{if(initial)setSelected(initial);},[initial]);
  useEffect(()=>{
    if(!selected)return;let valid=true;
    const refresh=async()=>{
      const result=await supabase.from('communication_whatsapp_messages').select('id,direction,body,status,kind,error,created_at,reviewed_at,review_note').eq('contact_id',selected).order('created_at',{ascending:false}).limit(200);
      if(valid&&live.current){if(result.error)setError('Could not load this WhatsApp conversation.');else setThread({contact:selected,messages:(result.data as Message[]).reverse()});}
      await refreshContacts();
    };
    void refresh();const poll=setInterval(()=>void refresh(),10_000);return()=>{valid=false;clearInterval(poll);};
  },[selected,refreshContacts]);
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
        setNotice(result.error?whatsappError(result.error):result.status==='queued'?'Message queued for the next scheduled run.':`Message status: ${result.status}. Delivery and read status come from Meta callbacks.`);
        // An uncertain/failed accepted request keeps its stable client reference. Retrying the button cannot duplicate it.
        if(['sent','delivered','read'].includes(result.status)) {if(test){setTestRef(null);setTestConfirmed(false);}else setDraft(null);}
        const resultMessages=await supabase.from('communication_whatsapp_messages').select('id,direction,body,status,kind,error,created_at,reviewed_at,review_note').eq('contact_id',id).order('created_at',{ascending:false}).limit(200);
        if(!resultMessages.error)setThread({contact:id,messages:(resultMessages.data as Message[]).reverse()});
      }
    });
  }
  return <section className="space-y-6">
    <header><h2 className="text-lg font-semibold">WhatsApp · direct Meta connection</h2><p className="mt-2 max-w-3xl text-sm text-brand-mid-grey">Groundwork schedules reminders, records delivery, receives replies and queues human follow-up. Start with Meta’s test number and verified team phones. Email settings stay separate.</p></header>
    {error&&<p role="alert" className="rounded-xl border p-3 text-sm text-state-alert">{error}</p>}{notice&&<p role="status" className="rounded-xl border p-3 text-sm">{notice}</p>}
    {!settings?<p>Connection settings are loading. If the WhatsApp migration is pending, apply it before configuring this channel.</p>:<>
      <details className="rounded-2xl border bg-white p-5 dark:bg-[#181818]" open={!credentials.token}>
        <summary className="cursor-pointer font-semibold">Connection settings · {settings.enabled?'sending enabled':'sending off'} · {settings.mode}</summary>
        <form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();void operation(async()=>{
          await whatsappApi('whatsapp-admin',{operation:'save',...settings,...secret});setSecret({token:'',appSecret:'',verifyToken:''});setGenerated('');await load();setNotice('Connection saved. New signing details require webhook verification before sending.');
        });}}>
          <div className="grid gap-4 sm:grid-cols-2">
            {([['phone_number_id','Meta phone-number ID'],['business_account_id','WhatsApp Business Account ID'],['display_phone','Business/test phone with country code'],['messaging_account_id','Messaging account ID (only if Meta requires it)']] as const).map(([key,label])=><label key={key} className="text-sm">{label}<input autoComplete="off" value={settings[key]} onChange={e=>setSettings({...settings,[key]:e.target.value})} className={input}/></label>)}
            <label className="text-sm">Audience<select value={settings.mode} onChange={e=>setSettings({...settings,mode:e.target.value})} className={input}><option value="test">Test recipients only</option><option value="live">All connected, consenting users</option></select></label>
            <label className="text-sm">Test recipients (one international phone per line)<textarea rows={3} value={settings.test_recipients.join('\n')} onChange={e=>setSettings({...settings,test_recipients:e.target.value.split('\n')})} className={input}/></label>
          </div>
          <p className="text-xs text-brand-mid-grey">Meta API version: {settings.api_version}. Secret values below are write-only. Leave a field empty to keep the saved value.</p>
          <div className="grid gap-4 sm:grid-cols-3">{([['token','Access token'],['appSecret','Meta App Secret'],['verifyToken','Webhook verify token']] as const).map(([key,label])=><label key={key} className="text-sm">{label} · {credentials[key]?'saved':'needed'}<input type="password" autoComplete="new-password" value={secret[key]} onChange={e=>setSecret({...secret,[key]:e.target.value})} className={input}/></label>)}</div>
          <button disabled={busy} className={`${button} bg-brand-green text-white`} type="submit">Save connection</button>
        </form>
        <div className="mt-5 border-t pt-4 text-sm"><p className="font-semibold">Meta callback URL</p><code className="mt-2 block break-all rounded-lg bg-brand-off-white p-3 dark:bg-[#222]">{callback}</code>
          <p className="my-2">Subscribe the app to the <strong>messages</strong> webhook field. Save the App Secret before verifying the callback. A valid incoming message proves the signed callback works.</p>
          <p>Callback challenge: {settings.webhook_verified_at?'verified':'pending'} · Signed event: {settings.signed_event_at?'received':'pending'}</p>
          <button type="button" disabled={busy} className={`${button} mt-3`} onClick={()=>void operation(async()=>{const result=await whatsappApi('whatsapp-admin',{operation:'generate_verify_token'});setGenerated(result.verifyToken);await load();})}>Generate verify token</button>
          {generated&&<div className="mt-3 rounded-lg border p-3"><p>Copy this token into Meta’s Verify token field. Generating it paused sending until the webhook is verified again.</p><code className="mt-2 block select-all break-all">{generated}</code><button type="button" className="mt-2 underline" onClick={()=>setGenerated('')}>Hide token</button></div>}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
          <button type="button" disabled={busy} className={button} onClick={()=>void operation(async()=>{const result=await whatsappApi('whatsapp-admin',{operation:'check'});await load();setNotice(`Meta connection checked. ${result.approved}/${result.total} exact reminder templates approved. ${result.issues.length} copy items need review.`);})}>Check connection and templates</button>
          <button type="button" disabled={busy} className={button} onClick={()=>void operation(async()=>{await whatsappApi('whatsapp-admin',{operation:'save',enabled:!settings.enabled});await load();setNotice(settings.enabled?'WhatsApp sending paused.':'WhatsApp sending enabled for the saved audience and enabled journeys.');})}>{settings.enabled?'Pause sending':'Enable sending'}</button>
        </div>
      </details>
      <details className="rounded-2xl border p-5"><summary className="cursor-pointer font-semibold">Automated reminders and template approvals</summary>
        <p className="my-3 text-sm">Enabled journeys use the same action and timing as email, with a separate WhatsApp ledger. Only the latest due reminder is sent when connecting late. Completing the action stops its reminders. Replies pause automation; Day 7 creates a human follow-up for qualified stalled users.</p>
        <button type="button" disabled={busy} className={button} onClick={()=>void operation(async()=>{
          const pack=await whatsappApi('whatsapp-admin',{operation:'templates'});const exportPack={templates:pack.templates.map(({variables:_,...template}:any)=>template),issues:pack.issues};
          const url=URL.createObjectURL(new Blob([JSON.stringify(exportPack,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='groundwork-whatsapp-templates.json';a.click();URL.revokeObjectURL(url);
          setNotice(`Template pack exported. ${pack.issues.length} copy items need review before approval. Submit the definitions in WhatsApp Manager, then run the connection check.`);
        })}>Export English/French template pack</button>
        <p className="mt-3 text-xs text-brand-mid-grey">Meta decides template approval and category. Editing journey copy or action labels requires matching approval again. Missing or changed templates are held; a generic welcome never replaces a project reminder.</p>
        <div className="mt-3 max-h-64 overflow-y-auto text-xs">{catalog.map(item=><p key={`${item.name}-${item.language}`} className="border-t py-2">{item.name} · {item.language} · {item.status} · checked {new Date(item.checked_at).toLocaleString()}</p>)}</div>
      </details>
      <div className="flex flex-wrap gap-3 text-xs"><span>Latest {recent.length} outbound messages:</span>{['queued','sent','delivered','read','failed','uncertain','blocked'].map(status=><span key={status}>{status}: {recent.filter(r=>r.status===status).length}</span>)}</div>
      <section>
        <div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">WhatsApp inbox</h3><button type="button" disabled={busy} className={button} onClick={()=>void operation(load)}>Refresh</button></div>
        {!contacts.length?<p className="text-sm">No WhatsApp messages yet. After webhook setup, send a message from your verified team phone. Connect that phone from the account’s profile to test reminders.</p>:<div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
          <nav aria-label="WhatsApp contacts" className="max-h-[65vh] space-y-2 overflow-y-auto">{contacts.map(item=><button type="button" key={item.id} onClick={()=>{setSelected(item.id);setTestConfirmed(false);setTestRef(null);setError('');setNotice('');}} aria-pressed={selected===item.id} className={`block w-full rounded-xl border p-3 text-left text-sm ${selected===item.id?'border-brand-green':''}`}><p className="font-semibold">{item.name||item.phone||item.bsuid}</p><p className="break-all text-xs">{item.phone||item.bsuid}</p><p className="mt-1 text-xs">{item.opted_out_at?'Stopped':item.needs_attention?'Needs attention':item.consent_at?'Connected':'Reminder consent needed'}</p></button>)}</nav>
          {!contact?<p className="text-sm">Choose a WhatsApp conversation.</p>:<article className="min-w-0 rounded-2xl border bg-white p-4 dark:bg-[#181818]">
            <h4 className="font-semibold">{contact.name||contact.phone||contact.bsuid}</h4><p className="mt-1 text-xs">{contact.phone||contact.bsuid} · {serviceWindowOpen(contact.last_inbound_at)?'Reply window open':'Reply window closed'}</p>
            {contact.opted_out_at&&<p className="mt-3 text-sm">This person stopped WhatsApp messages. They must reconnect from their profile to receive them again.</p>}
            {contact.automation_paused&&!contact.opted_out_at&&<div className="mt-3 rounded-xl border p-3 text-sm"><p>WhatsApp reminders are paused while the team handles this reply. Email conversation pauses also need review in the shared inbox.</p><button type="button" disabled={busy||!contact.consent_at} className="mt-2 underline" onClick={()=>void operation(async()=>{await whatsappApi('whatsapp-admin',{operation:'resume',contactId:contact.id});await refreshContacts();setNotice('WhatsApp reply reviewed. Reminders can resume once shared conversation holds are also cleared.');})}>Review complete · resume WhatsApp reminders</button></div>}
            <div className="my-4 max-h-[50vh] space-y-3 overflow-y-auto">{messages===null?<p className="text-sm">Loading messages…</p>:messages.map(message=><section key={message.id} className={`rounded-xl border p-3 ${message.direction==='inbound'?'border-brand-green/30':'bg-brand-off-white dark:bg-[#222]'}`}><p className="text-xs text-brand-mid-grey">{message.direction==='inbound'?'Recipient':message.kind==='staff'?'Staff':message.kind==='test'?'Connection test':'Automated'} · {message.status} · {new Date(message.created_at).toLocaleString()}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.body}</p>{message.error&&<p className="mt-2 text-xs text-state-alert">{whatsappError(message.error)}</p>}{message.reviewed_at&&<p className="mt-2 text-xs">Staff review: {message.review_note}</p>}{message.status==='uncertain'&&<SendReview messageId={message.id} busy={busy} onReview={data=>void operation(async()=>{const result=await whatsappApi('whatsapp-admin',data);setNotice(result.resolved?'Delivery review recorded. The message has not been resent.':'A callback or another Admin already resolved this message.');setThread(null);await refreshContacts();})}/>}</section>)}</div>
            <form onSubmit={e=>{e.preventDefault();void send();}}><label className="text-sm">Reply on WhatsApp<textarea rows={3} maxLength={4000} value={body} disabled={busy} onChange={e=>setDraft({contact:contact.id,body:e.target.value,ref:draft?.contact===contact.id&&draft.body===e.target.value?draft.ref:crypto.randomUUID()})} className={input}/></label><p className="mt-2 text-xs">{serviceWindowOpen(contact.last_inbound_at)?'This sends a WhatsApp message to this person.':'Ask the recipient to message the business again to reopen the 24-hour reply window.'}</p><button type="submit" disabled={busy||!settings.enabled||!!contact.opted_out_at||!body.trim()||!serviceWindowOpen(contact.last_inbound_at)} className={`${button} mt-3 bg-brand-green text-white`}>Send WhatsApp reply</button></form>
            {settings.mode==='test'&&<div className="mt-5 border-t pt-4 text-sm"><label className="flex items-start gap-2"><input type="checkbox" checked={testConfirmed} onChange={e=>setTestConfirmed(e.target.checked)} className="mt-1"/>This is our controlled recipient, verified in Meta, and they agreed to receive the connection test.</label><button type="button" className={`${button} mt-3`} disabled={busy||!testConfirmed||!settings.enabled||!contact.consent_at||!!contact.opted_out_at} onClick={()=>void send(true)}>Send Meta hello_world test</button></div>}
          </article>}
        </div>}
      </section>
    </>}
  </section>;
}
