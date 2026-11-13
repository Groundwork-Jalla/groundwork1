import { useCallback,useEffect,useRef,useState } from 'react';
import { Link } from 'react-router';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { queueCommunicationReply } from '@/lib/supabase/communications';
type Thread={id:string;email:string;automation_paused:boolean;last_message_at:string;lifecycle_enrollments:{full_name:string|null;context:{project_id?:string;project_name?:string}}};
type Message={id:string;direction:'inbound'|'outbound';body:string;subject:string;status:string;authenticated:boolean;attachment_count:number;created_at:string;client_ref:string|null};
const statusKeys={queued:'queued',sending:'sending',sent:'sent',received:'received',delivered:'delivered',bounced:'bounced',complained:'complained',failed:'failed',blocked:'blocked'} as const;
export function CommunicationInbox() {
  const t=useT();const [threads,setThreads]=useState<Thread[]>([]);const [selected,setSelected]=useState<string|null>(null);
  const [messages,setMessages]=useState<{thread:string;rows:Message[]}|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [draft,setDraft]=useState<{thread:string;body:string;ref:string}|null>(null);const [busy,setBusy]=useState(false);
  const [messageRefresh,setMessageRefresh]=useState(0);
  const current=useRef(selected);current.current=selected;const live=useRef(true);const working=useRef(false);
  const load=useCallback(async()=>{
    const result=await supabase.from('communication_threads').select('id,email,automation_paused,last_message_at,lifecycle_enrollments(full_name,context)').order('last_message_at',{ascending:false}).limit(200);
    if(!live.current)return;if(result.error){setError(t('communications.loadFailed'));return;}setThreads(result.data as unknown as Thread[]);
  },[t]);
  useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[load]);
  useEffect(()=>{setError('');setNotice('');},[selected]);
  useEffect(()=>{let valid=true;
    if(!selected)return;
    const refresh=async()=>{const result=await supabase.from('communication_messages').select('id,direction,subject,body,status,authenticated,attachment_count,created_at,client_ref').eq('thread_id',selected).order('created_at').limit(300);
      if(valid){if(result.error)setError(t('communications.loadFailed'));else setMessages({thread:selected,rows:result.data as Message[]});}};
    void refresh();const poll=setInterval(()=>{void refresh();void load();},15_000);return()=>{valid=false;clearInterval(poll);};
  },[selected,t,load,messageRefresh]);
  const thread=threads.find(item=>item.id===selected);const rows=messages?.thread===selected?messages.rows:null;
  const body=draft?.thread===selected?draft.body:'';
  async function send() {
    if(!thread||!body.trim()||working.current)return;const id=thread.id;const ref=draft?.thread===id?draft.ref:crypto.randomUUID();
    working.current=true;setBusy(true);setError('');setNotice('');
    try {await queueCommunicationReply(id,body,ref);if(live.current&&current.current===id){setDraft(null);setNotice(t('communications.replyQueued'));setMessageRefresh(value=>value+1);}await load();}
    catch {if(live.current&&current.current===id)setError(t('communications.queueFailed'));}
    finally {working.current=false;if(live.current)setBusy(false);}
  }
  async function resume() {
    if(!thread||working.current)return;const id=thread.id;working.current=true;setBusy(true);
    try {const result=await supabase.rpc('admin_resume_communication',{p_thread:id});if(result.error)throw result.error;if(live.current&&current.current===id)setNotice(t('communications.resumeDone'));await load();}
    catch {if(live.current&&current.current===id)setError(t('communications.saveFailed'));}
    finally {working.current=false;if(live.current)setBusy(false);}
  }
  return <section>
    <div className="mb-4 flex justify-between gap-3"><h2 className="text-lg font-semibold">{t('communications.inbox')}</h2><button type="button" onClick={()=>void load()} className="rounded-xl border px-3 py-2 text-xs">{t('communications.inboxRefresh')}</button></div>
    {error&&<p role="alert" className="mb-3 text-sm text-state-alert">{error}</p>}{notice&&<p role="status" className="mb-3 text-sm text-brand-green">{notice}</p>}
    {!threads.length?<p className="text-sm text-brand-mid-grey">{t('communications.inboxEmpty')}</p>:<div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <nav aria-label={t('communications.inbox')} className="max-h-[70vh] space-y-1 overflow-y-auto">{threads.map(item=><button type="button" key={item.id} onClick={()=>setSelected(item.id)} aria-pressed={selected===item.id} className={`block w-full rounded-xl border p-3 text-left text-sm ${selected===item.id?'border-brand-green bg-brand-green/5':''}`}>
        <p className="font-semibold">{item.lifecycle_enrollments?.full_name||item.email}</p><p className="break-all text-xs text-brand-mid-grey">{item.email}</p><p className="mt-1 text-xs">{item.lifecycle_enrollments?.context?.project_name}</p>
        <time className="text-[11px] text-brand-mid-grey">{new Date(item.last_message_at).toLocaleString()}</time>
      </button>)}</nav>
      {!thread?<p>{t('communications.selectThread')}</p>:<article className="min-w-0 rounded-2xl border bg-white p-4 dark:bg-[#181818]">
        <h3 className="break-all font-semibold">{thread.email}</h3>
        {thread.lifecycle_enrollments?.context?.project_id&&/^[0-9a-f-]{36}$/i.test(thread.lifecycle_enrollments.context.project_id)&&<Link className="text-xs underline" to={`/admin/projects/${thread.lifecycle_enrollments.context.project_id}`}>{thread.lifecycle_enrollments.context.project_name||t('projectLinks.title')}</Link>}
        {thread.automation_paused&&<div className="mt-3 rounded-xl bg-brand-off-white p-3 text-xs dark:bg-[#252525]"><p>{t('communications.automationPaused')}</p><button type="button" disabled={busy} onClick={()=>void resume()} className="mt-2 underline">{t('communications.resumeAutomation')}</button></div>}
        <div className="my-4 max-h-[55vh] space-y-4 overflow-y-auto">
          {!rows?<p>{t('common.loading')}</p>:!rows.length?<p>{t('communications.noMessages')}</p>:rows.map(message=><section key={message.id} className={`rounded-xl border p-3 ${message.direction==='inbound'?'border-brand-green/30':'bg-brand-off-white dark:bg-[#222]'}`}>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-brand-mid-grey"><p>{t(message.direction==='inbound'?'communications.recipient':message.client_ref?'communications.staff':'communications.automated')} · {t(`communications.${statusKeys[message.status as keyof typeof statusKeys]??'failed'}`)}</p><time>{new Date(message.created_at).toLocaleString()}</time></div>
            {message.direction==='inbound'&&!message.authenticated&&<p className="mt-2 text-xs text-state-alert">{t('communications.unverified')}</p>}
            <p className="mt-2 text-sm font-semibold">{message.subject}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.body}</p>
            {message.attachment_count>0&&<p className="mt-2 text-xs text-brand-mid-grey">{t('communications.attachments',{count:message.attachment_count})}</p>}
          </section>)}
        </div>
        <form onSubmit={event=>{event.preventDefault();void send();}}>
          <label className="block text-sm">{t('communications.reply')}<textarea rows={4} required maxLength={10000} disabled={busy} value={body} onChange={event=>setDraft(previous=>({thread:thread.id,body:event.target.value,ref:previous?.thread===thread.id&&previous.body===event.target.value?previous.ref:crypto.randomUUID()}))} className="mt-2 w-full rounded-xl border bg-transparent p-3"/></label>
          <p className="mt-2 text-xs text-brand-mid-grey">{t('communications.replyHelp')}</p><button type="submit" disabled={busy||!body.trim()} className="mt-3 rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{t('communications.sendReply')}</button>
        </form>
      </article>}
    </div>}
  </section>;
}
