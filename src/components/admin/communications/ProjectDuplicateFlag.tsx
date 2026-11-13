import { useEffect,useRef,useState } from 'react';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { markDuplicateProject } from '@/lib/supabase/communication-tracking';
export function ProjectDuplicateFlag({projectId}:{projectId:string}) {
 const t=useT();const [flag,setFlag]=useState<{reason:string;marked_at:string}|null>(null);const [draft,setDraft]=useState('');
 const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [available,setAvailable]=useState(true);const working=useRef(false);
 const current=useRef(projectId);current.current=projectId;
 useEffect(()=>{let live=true;setLoading(true);setAvailable(false);setError('');setFlag(null);setDraft('');
  void Promise.resolve(supabase.from('communication_duplicate_projects').select('reason,marked_at').eq('project_id',projectId).maybeSingle()).then(result=>{
   if(!live)return;if(result.error)throw result.error;setAvailable(true);setFlag(result.data);setDraft(result.data?.reason??'');
  }).catch(problem=>{if(live)setError(t(['42P01','PGRST205'].includes(problem.code)?'communications.tracking.install':'communications.tracking.loadFailed'));})
   .finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
 },[projectId,t]);
 async function save(duplicate:boolean) {
  if(working.current||loading||!available)return;if(duplicate&&!draft.trim()){setError(t('communications.tracking.reasonRequired'));return;}const id=projectId;
  working.current=true;setBusy(true);setError('');
  try{await markDuplicateProject(id,duplicate,draft);if(current.current===id){setFlag(duplicate?{reason:draft.trim(),marked_at:new Date().toISOString()}:null);if(!duplicate)setDraft('');}}
  catch{if(current.current===id)setError(t('communications.tracking.flagFailed'));}finally{working.current=false;setBusy(false);}
 }
 return <section className="m-5 rounded-2xl border bg-white p-4 dark:bg-[#181818]">
  <h2 className="text-sm font-semibold">{t('communications.tracking.duplicateReview')}</h2><p className="mt-2 text-xs text-brand-mid-grey">{t('communications.tracking.duplicateHelp')}</p>
  {error&&<p role="alert" className="mt-2 text-sm text-state-alert">{error}</p>}
  {loading?<p className="mt-3 text-sm">{t('common.loading')}</p>:available&&<form onSubmit={event=>{event.preventDefault();void save(true);}} className="mt-3">
   <p className="text-sm">{t(flag?'communications.tracking.duplicate':'communications.tracking.standard')}</p>
   <label className="mt-3 block text-xs">{t('communications.tracking.reason')}<textarea rows={2} maxLength={2000} required value={draft} onChange={event=>setDraft(event.target.value)} className="mt-1 w-full rounded-xl border bg-transparent p-2 text-sm"/></label>
   <div className="mt-3 flex flex-wrap gap-2"><button type="submit" disabled={busy} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40">{t('communications.tracking.markDuplicate')}</button>{flag&&<button type="button" disabled={busy} onClick={()=>void save(false)} className="rounded-xl border px-3 py-2 text-sm">{t('communications.tracking.clearDuplicate')}</button>}</div>
  </form>}
 </section>;
}
