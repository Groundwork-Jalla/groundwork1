import { useEffect,useRef,useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { listAdminUsers,type AdminUser } from '@/lib/supabase/admin-users';
export interface CommunicationFollowup {
  id:string;email:string;full_name:string|null;phone:string|null;status:string;note:string;reason:string;priority:string;
  owner_id:string|null;due_at:string|null;contact_status:string;attempt_count:number;kind:'activation'|'reply'|'delivery';
  enrollment_id:string|null;context:{project_id?:string;project_name?:string};
}
const field='mt-1 w-full rounded-xl border bg-white p-2 text-sm dark:bg-[#181818]';
export function localDateInput(date:Date):string {return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);}
export function CommunicationFollowups({items,onChanged,nextContactHours=48}:{items:CommunicationFollowup[];onChanged:()=>void;nextContactHours?:number}) {
  const t=useT();const {user}=useAuth();const [filter,setFilter]=useState('all');const [staff,setStaff]=useState<AdminUser[]>([]);
  useEffect(()=>{let live=true;void listAdminUsers().then(users=>{if(live)setStaff(users.filter(person=>person.roles.split(',').includes('admin')));}).catch(()=>{});return()=>{live=false;};},[]);
  const open=items.filter(item=>item.status==='open'&&(filter!=='mine'||item.owner_id===user?.id)&&(filter!=='overdue'||!!item.due_at&&Date.parse(item.due_at)<=Date.now()))
    .sort((a,b)=>(a.priority===b.priority?0:a.priority==='high'?-1:1)||(Date.parse(a.due_at??'')||Infinity)-(Date.parse(b.due_at??'')||Infinity));
  return <section>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{t('communications.followups')}</h2>
      <select aria-label={t('communications.followups')} value={filter} onChange={event=>setFilter(event.target.value)} className="rounded-xl border p-2 text-sm">
        <option value="all">{t('communications.all')}</option><option value="mine">{t('communications.mine')}</option><option value="overdue">{t('communications.overdue')}</option>
      </select></div>
    {!open.length&&<p className="text-sm text-brand-mid-grey">{t('communications.noFollowups')}</p>}
    <div className="space-y-4">{open.map(item=><FollowupCard key={`${item.id}:${item.due_at}:${item.attempt_count}:${item.owner_id}`} item={item} staff={staff} onChanged={onChanged} nextContactHours={nextContactHours}/>)}</div>
  </section>;
}
function FollowupCard({item,staff,onChanged,nextContactHours}:{item:CommunicationFollowup;staff:AdminUser[];onChanged:()=>void;nextContactHours:number}) {
  const t=useT();const working=useRef(false);const [note,setNote]=useState('');const [owner,setOwner]=useState(item.owner_id??'');
  const [due,setDue]=useState(localDateInput(new Date(item.due_at&&Date.parse(item.due_at)>Date.now()?item.due_at:Date.now()+nextContactHours*3600_000)));
  const [action,setAction]=useState<'contacted'|'awaiting_reply'|'reschedule'>('contacted');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [history,setHistory]=useState<any[]|null>(null);
  async function submit(kind:string) {
    if(working.current)return;working.current=true;setBusy(true);setError('');
    try {
      if(!['assign','resolve'].includes(kind)&&(!Number.isFinite(Date.parse(due))||Date.parse(due)<=Date.now())) throw new Error('future_followup_required');
      const response=await supabase.rpc('admin_followup_action',{p_id:item.id,p_action:kind,p_note:note,p_due_at:kind==='assign'||kind==='resolve'?null:new Date(due).toISOString(),p_owner:kind==='assign'?owner||null:null});
      if(response.error)throw response.error;onChanged();
    }catch(error){const message=String((error as {message?:string})?.message??'');setError(t(message.includes('required_action_incomplete')?'communications.actionIncomplete':message.includes('future_followup_required')?'communications.futureRequired':/note_required/.test(message)?'communications.noteRequired':'communications.saveFailed'));}
    finally{working.current=false;setBusy(false);}
  }
  async function loadHistory() {const result=await supabase.from('communication_followup_events').select('id,actor_id,kind,note,created_at,due_at').eq('followup_id',item.id).order('created_at',{ascending:false});if(result.error)setError(t('communications.loadFailed'));else setHistory(result.data??[]);}
  return <article className="rounded-2xl border bg-white p-4 dark:bg-[#181818]">
    <div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{item.full_name||item.email}</p><a className="text-xs underline" href={`mailto:${item.email}`}>{item.email}</a>{item.phone&&<a className="ml-3 text-xs underline" href={`tel:${item.phone}`}>{item.phone}</a>}</div>
      <span className="text-xs">{t(item.kind==='reply'?'communications.kindReply':item.kind==='delivery'?'communications.kindDelivery':'communications.kindActivation')}</span></div>
    <p className="mt-2 text-sm">{item.reason}</p>{item.context?.project_name&&<p className="text-xs text-brand-mid-grey">{item.context.project_name}</p>}
    <p className="mt-2 text-xs">{t('communications.attempts')}: {item.attempt_count} · {t('communications.due')}: {item.due_at?new Date(item.due_at).toLocaleString():'—'}</p>
    {item.note&&<p className="mt-2 whitespace-pre-wrap text-xs text-brand-mid-grey">{item.note}</p>}
    <div className="mt-4 flex gap-2"><label className="flex-1 text-xs">{t('communications.owner')}<select value={owner} onChange={event=>setOwner(event.target.value)} className={field}><option value="">{t('communications.unassigned')}</option>{staff.map(person=><option key={person.id} value={person.id}>{person.fullName||person.email}</option>)}</select></label>
      <button disabled={busy} type="button" onClick={()=>void submit('assign')} className="self-end rounded-xl border px-3 py-2 text-xs">{t('common.save')}</button></div>
    <label className="mt-3 block text-xs">{t('communications.note')}<textarea rows={2} value={note} onChange={event=>setNote(event.target.value)} maxLength={5000} className={field}/></label>
    <div className="mt-3 grid gap-3 sm:grid-cols-2"><select aria-label={t('communications.logContact')} value={action} onChange={event=>setAction(event.target.value as typeof action)} className={field}>
      <option value="contacted">{t('communications.contacted')}</option><option value="awaiting_reply">{t('communications.awaitingReply')}</option><option value="reschedule">{t('communications.reschedule')}</option></select>
      <label className="text-xs">{t('communications.due')}<input type="datetime-local" value={due} onChange={event=>setDue(event.target.value)} className={field}/></label></div>
    {error&&<p role="alert" className="mt-3 text-sm text-state-alert">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>void submit(action)} className="rounded-xl bg-brand-green px-3 py-2 text-xs font-semibold text-white">{t('communications.logContact')}</button>
      <button type="button" disabled={busy} onClick={()=>void submit('resolve')} className="rounded-xl border px-3 py-2 text-xs">{t('communications.resolve')}</button>
      <button type="button" onClick={()=>void loadHistory()} className="rounded-xl border px-3 py-2 text-xs">{t('communications.history')}</button></div>
    {history&&<ul className="mt-3 space-y-2 border-t pt-3 text-xs">{history.map(event=><li key={event.id}><span>{new Date(event.created_at).toLocaleString()} · {event.kind.replace(/_/g,' ')} · {event.actor_id?(staff.find(person=>person.id===event.actor_id)?.fullName||staff.find(person=>person.id===event.actor_id)?.email||event.actor_id):t('communications.automated')}</span><p className="whitespace-pre-wrap text-brand-mid-grey">{event.note}</p></li>)}</ul>}
  </article>;
}
