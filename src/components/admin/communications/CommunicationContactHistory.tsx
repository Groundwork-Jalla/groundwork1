import { useEffect,useRef,useState } from 'react';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { logCommunicationContact } from '@/lib/supabase/communication-tracking';
type Followup={id:string;email:string;status:string;note:string;due_at:string|null;attempt_count:number};
type ContactEvent={id:string;kind:string;note:string;created_at:string;contacted_at:string|null};
const local=(date:Date)=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19);
export function CommunicationContactHistory({followupId,onChanged,nextContactHours=48}:{followupId:string;onChanged:()=>void;nextContactHours?:number}) {
 const t=useT();const [item,setItem]=useState<Followup|null>(null);const [events,setEvents]=useState<ContactEvent[]>([]);
 const [note,setNote]=useState('');const [contacted,setContacted]=useState(()=>local(new Date()));const [next,setNext]=useState(()=>local(new Date(Date.now()+nextContactHours*3600_000)));
 const [kind,setKind]=useState<'contacted'|'awaiting_reply'>('contacted');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(0);
 const current=useRef(followupId);current.current=followupId;const working=useRef(false);const panel=useRef<HTMLElement>(null);
 useEffect(()=>{let live=true;setItem(null);setError('');setEvents([]);
  void Promise.all([
   supabase.from('followup_queue').select('id,email,status,note,due_at,attempt_count').eq('id',followupId).single(),
   supabase.from('communication_followup_events').select('id,kind,note,created_at,contacted_at').eq('followup_id',followupId).order('created_at',{ascending:false}),
  ]).then(([followup,history])=>{if(!live)return;if(followup.error||history.error)throw followup.error??history.error;
   setItem(followup.data);setEvents(history.data??[]);if(followup.data?.due_at&&Date.parse(followup.data.due_at)>Date.now())setNext(local(new Date(followup.data.due_at)));
  }).catch(problem=>{if(live)setError(t(['42703','PGRST204'].includes(problem.code)?'communications.tracking.install':'communications.tracking.loadFailed'));});
  return()=>{live=false;};
 },[followupId,revision,t]);
 useEffect(()=>{setNote('');setKind('contacted');setContacted(local(new Date()));setNext(local(new Date(Date.now()+nextContactHours*3600_000)));panel.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[followupId,nextContactHours]);
 async function save(event:React.FormEvent) {
  event.preventDefault();if(!item||item.id!==followupId||working.current)return;const id=item.id;
  if(!note.trim()){setError(t('communications.noteRequired'));return;}
  if(!Number.isFinite(Date.parse(contacted))){setError(t('communications.tracking.contactTimeInvalid'));return;}
  if(item.status==='open'&&(!Number.isFinite(Date.parse(next))||Date.parse(next)<=Date.now())){setError(t('communications.futureRequired'));return;}
  working.current=true;setBusy(true);setError('');
  try{await logCommunicationContact({id,kind,note,contactedAt:new Date(contacted).toISOString(),nextAt:item.status==='open'?new Date(next).toISOString():null});
   if(current.current===id){setNote('');setRevision(value=>value+1);onChanged();}
  }catch(problem){if(current.current===id){const message=String((problem as {message?:string}).message??'');setError(t(message.includes('invalid_contact_time')?'communications.tracking.contactTimeInvalid':message.includes('future_followup_required')?'communications.futureRequired':'communications.saveFailed'));}}
  finally{working.current=false;setBusy(false);}
 }
 return <section ref={panel} className="mt-5 rounded-2xl border border-brand-green/30 bg-white p-4 dark:bg-[#181818]">
  <h3 className="font-semibold">{t('communications.tracking.contactHistory')}</h3>{error&&<p role="alert" className="mt-2 text-sm text-state-alert">{error}</p>}
  <button type="button" onClick={()=>setRevision(value=>value+1)} className="mt-2 text-xs underline">{t('communications.inboxRefresh')}</button>
  {!item||item.id!==followupId?(!error&&<p className="mt-3 text-sm">{t('common.loading')}</p>):<>
   <p className="mt-2 text-sm">{item.email} · {t(item.status==='open'?'communications.tracking.contactOpen':'communications.tracking.contactClosed')}</p>
   <p className="mt-2 text-xs text-brand-mid-grey">{t('communications.tracking.contactHelp')}</p>
   <form onSubmit={event=>void save(event)} className="mt-4 space-y-3">
    <label className="block text-xs">{t('communications.tracking.contactTime')}<input required type="datetime-local" step={1} value={contacted} onChange={event=>setContacted(event.target.value)} className="ml-2 rounded-xl border bg-transparent px-3 py-2 text-sm"/></label>
    <label className="block text-xs">{t('communications.note')}<textarea required rows={3} maxLength={5000} value={note} onChange={event=>setNote(event.target.value)} className="mt-1 w-full rounded-xl border bg-transparent p-3 text-sm"/></label>
    <select aria-label={t('communications.logContact')} value={kind} onChange={event=>setKind(event.target.value as typeof kind)} className="rounded-xl border bg-transparent px-3 py-2 text-sm"><option value="contacted">{t('communications.contacted')}</option><option value="awaiting_reply">{t('communications.awaitingReply')}</option></select>
    {item.status==='open'&&<label className="ml-3 text-xs">{t('communications.due')}<input required type="datetime-local" step={1} value={next} onChange={event=>setNext(event.target.value)} className="ml-2 rounded-xl border bg-transparent px-3 py-2 text-sm"/></label>}
    <button type="submit" disabled={busy} className="ml-3 rounded-xl bg-brand-green px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{t('communications.logContact')}</button>
   </form>
   <ol className="mt-5 space-y-3 border-t pt-3">{events.map(event=><li key={event.id} className="text-xs"><p>{new Date(event.contacted_at??event.created_at).toLocaleString()} · {event.kind.replace(/_/g,' ')}</p><p className="mt-1 whitespace-pre-wrap">{event.note}</p></li>)}</ol>
  </>}
 </section>;
}
