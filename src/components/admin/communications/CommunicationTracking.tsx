import { useEffect,useState } from 'react';
import { Link } from 'react-router';
import { useLanguage,useT } from '@/lib/i18n';
import { ACTIVATION_JOURNEYS } from '@/lib/lifecycle/journeys';
import { COMMUNICATION_RATIOS,TRACKING_STATES,dateFilterValue,readCommunicationTracking,type CommunicationTrackingReport } from '@/lib/supabase/communication-tracking';
import { CommunicationContactHistory } from './CommunicationContactHistory';
const field='rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm dark:bg-[#181818]';
export function CommunicationTracking({onConversation,nextContactHours=48}:{onConversation:(thread:string)=>void;nextContactHours?:number}) {
 const t=useT();const {lang}=useLanguage();
 const [from,setFrom]=useState(()=>dateFilterValue(new Date(Date.now()-30*86400_000)));
 const [through,setThrough]=useState(()=>dateFilterValue(new Date()));const [search,setSearch]=useState('');
 const [journey,setJourney]=useState('');const [state,setState]=useState('');const [page,setPage]=useState(0);const [revision,setRevision]=useState(0);
 const [report,setReport]=useState<CommunicationTrackingReport|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [contactHistory,setContactHistory]=useState<string|null>(null);
 useEffect(()=>{let live=true;setBusy(true);setError('');
  const timer=setTimeout(()=>{void readCommunicationTracking({from,through,search,journey,state,offset:page*50}).then(result=>{if(live)setReport(result);})
   .catch(problem=>{if(live)setError(t(problem.message==='communication_tracking_not_installed'?'communications.tracking.install':problem.message==='invalid_tracking_dates'?'communications.tracking.invalidDates':'communications.tracking.loadFailed'));})
   .finally(()=>{if(live)setBusy(false);});},200);
  return()=>{live=false;clearTimeout(timer);};
 },[from,through,search,journey,state,page,revision,t]);
 const date=(value:string|null)=>value?new Date(value).toLocaleString(lang):'—';
 const number=(value:number)=>new Intl.NumberFormat(lang,{maximumFractionDigits:1}).format(value);
 const percent=(value:number|null)=>value===null?'—':`${number(value)}%`;
 return <section aria-busy={busy}>
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{t('communications.tracking.title')}</h2><button type="button" onClick={()=>setRevision(value=>value+1)} disabled={busy} className={field}>{t('communications.inboxRefresh')}</button></div>
  <p className="mt-2 max-w-4xl text-sm text-brand-mid-grey">{t('communications.tracking.help')}</p>
  <div className="mt-4 flex flex-wrap gap-3"><label className="text-xs">{t('communications.tracking.from')}<input type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(0);}} className={`ml-2 ${field}`}/></label>
   <label className="text-xs">{t('communications.tracking.through')}<input type="date" value={through} onChange={event=>{setThrough(event.target.value);setPage(0);}} className={`ml-2 ${field}`}/></label></div>
  {error&&<p role="alert" className="mt-4 text-sm text-state-alert">{error}</p>}{busy&&<p className="mt-4 text-sm">{t('common.loading')}</p>}
  {report&&<>
   <p className="mt-3 text-xs text-brand-mid-grey">{t('communications.tracking.asOf')} {date(report.asOf)}</p>
   <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{COMMUNICATION_RATIOS.map(key=><article key={key} className="rounded-2xl border bg-white p-4 dark:bg-[#181818]">
    <h3 className="text-sm font-semibold">{t(`communications.tracking.metrics.${key}.title`)}</h3><p className="mt-2 text-2xl font-semibold">{percent(report.metrics[key].percent)}</p>
    <p className="mt-1 text-xs">{number(report.metrics[key].completed)} / {number(report.metrics[key].total)}</p><p className="mt-2 text-xs text-brand-mid-grey">{t(`communications.tracking.metrics.${key}.help`)}</p>
   </article>)}<article className="rounded-2xl border bg-white p-4 dark:bg-[#181818]"><h3 className="text-sm font-semibold">{t('communications.tracking.connectionTime')}</h3>
    <p className="mt-2 text-2xl font-semibold">{report.metrics.medianConnectionHours===null?'—':t('communications.tracking.hours',{count:number(report.metrics.medianConnectionHours)})}</p>
    <p className="mt-2 text-xs text-brand-mid-grey">{t('communications.tracking.timeCoverage',{count:report.metrics.knownConnectionTimes})}</p></article></div>
   <p className="mt-3 text-xs text-brand-mid-grey">{t('communications.tracking.coverage',{signups:report.metrics.knownSignupEvents,unknown:report.metrics.unclassifiedSignupEvents,connections:report.metrics.historicalUnknownConnectionTimes,invitations:report.metrics.invitationsWithoutDeliveryProof})}</p>
   <h3 className="mt-7 font-semibold">{t('communications.tracking.recovery')}</h3><p className="mt-1 text-xs text-brand-mid-grey">{t('communications.tracking.recoveryHelp')}</p>
   {!report.recovery.length?<p className="mt-3 text-sm text-brand-mid-grey">{t('communications.tracking.noRecovery')}</p>:<div className="mt-3 overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">{t('communications.tracking.message')}</th><th className="p-3">{t('communications.tracking.recovered')}</th><th className="p-3">{t('communications.tracking.rate')}</th></tr></thead>
    <tbody>{report.recovery.map(item=><tr key={`${item.sequence_key}:${item.step_code}`} className="border-t"><td className="p-3">{item.step_code} · {item.subject}</td><td className="p-3">{item.completed} / {item.total}</td><td className="p-3">{percent(item.percent)}</td></tr>)}</tbody></table></div>}
   <h3 className="mt-7 font-semibold">{t('communications.tracking.people')}</h3><p className="mt-1 text-xs text-brand-mid-grey">{t('communications.tracking.peopleHelp')}</p>
   <div className="mt-3 flex flex-wrap gap-3"><input aria-label={t('communications.tracking.search')} placeholder={t('communications.tracking.search')} maxLength={200} value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}} className={field}/>
    <select aria-label={t('communications.journeys.filter')} value={journey} onChange={event=>{setJourney(event.target.value);setPage(0);}} className={field}><option value="">{t('communications.journeys.all')}</option>{ACTIVATION_JOURNEYS.map(item=><option key={item.id} value={item.name}>{t(`communications.journeys.titles.${item.id}`)}</option>)}</select>
    <select aria-label={t('communications.tracking.state')} value={state} onChange={event=>{setState(event.target.value);setPage(0);}} className={field}><option value="">{t('communications.tracking.allStates')}</option>{TRACKING_STATES.map(value=><option key={value} value={value}>{t(`communications.tracking.states.${value}`)}</option>)}</select></div>
   <div className="mt-3 overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr>{(['person','action','message','next','followup'] as const).map(key=><th key={key} className="p-3">{t(`communications.tracking.${key}`)}</th>)}</tr></thead><tbody>
    {!report.rows.length&&<tr><td colSpan={5} className="p-4 text-brand-mid-grey">{t('communications.tracking.noPeople')}</td></tr>}
    {report.rows.map(row=><tr key={row.id} className="border-t align-top"><td className="p-3"><p className="font-semibold">{row.name||row.email}</p><a href={`mailto:${row.email}`} className="block text-xs underline">{row.email}</a>{row.phone&&<a href={`tel:${row.phone}`} className="block text-xs underline">{row.phone}</a>}
     {row.projectId&&<Link to={`/admin/projects/${row.projectId}`} className="mt-1 block text-xs underline">{row.projectName||t('projectLinks.title')}</Link>}</td>
     <td className="p-3"><p>{row.action||'—'}</p><p className="mt-1 text-xs">{row.journey}</p><p className="mt-1 text-xs">{t(`communications.tracking.states.${row.state}`)}</p><time className="mt-1 block text-xs text-brand-mid-grey">{date(row.enteredAt)}</time>{row.completedAt&&<p className="mt-1 text-xs text-brand-green">{t('communications.tracking.completedAt')} {date(row.completedAt)}</p>}</td>
     <td className="p-3">{row.lastEmail?<><p>{row.lastEmail.code} · {row.lastEmail.subject}</p><p className="mt-1 text-xs text-brand-mid-grey">{row.lastEmail.status} · {date(row.lastEmail.sentAt)}</p></>:'—'}<button type="button" disabled={!row.threadId} onClick={()=>{if(row.threadId)onConversation(row.threadId);}} className="mt-2 block text-xs underline disabled:opacity-40">{t('communications.tracking.conversation')}</button></td>
     <td className="p-3"><p>{row.nextEmailCode||'—'}</p><time className="text-xs text-brand-mid-grey">{date(row.nextEmailAt)}</time></td>
     <td className="p-3">{row.followup?<><p>{row.followup.ownerName||t('communications.unassigned')}</p><p className="mt-1 text-xs">{t('communications.attempts')}: {row.followup.attempts}</p><time className="mt-1 block text-xs text-brand-mid-grey">{date(row.followup.dueAt)}</time><button type="button" onClick={()=>setContactHistory(row.followup!.id)} className="mt-2 block text-xs underline">{t('communications.tracking.contactHistory')}</button></>:'—'}</td></tr>)}
   </tbody></table></div>
   <div className="mt-3 flex items-center gap-3 text-sm"><button type="button" disabled={page===0} onClick={()=>setPage(value=>value-1)} className={field}>{t('communications.tracking.previous')}</button><p>{t('communications.tracking.page',{count:page+1,total:report.total})}</p><button type="button" disabled={report.offset+report.rows.length>=report.total} onClick={()=>setPage(value=>value+1)} className={field}>{t('communications.tracking.nextPage')}</button></div>
   {contactHistory&&<CommunicationContactHistory followupId={contactHistory} nextContactHours={nextContactHours} onChanged={()=>setRevision(value=>value+1)}/>}
   <h3 className="mt-7 font-semibold">{t('communications.tracking.projects')}</h3><p className="mt-1 text-xs text-brand-mid-grey">{t('communications.tracking.projectsHelp')}</p>
   <ul className="mt-3 space-y-2">{report.projects.map(project=><li key={project.id} className="flex flex-wrap justify-between gap-2 rounded-xl border p-3 text-sm"><Link to={`/admin/projects/${project.id}`} className="underline">{project.name}</Link><span>{project.origin} · {t(project.duplicate?'communications.tracking.duplicate':'communications.tracking.standard')} · {t(project.connected?'communications.tracking.connected':'communications.tracking.connecting')}</span></li>)}</ul>
  </>}
 </section>;
}
