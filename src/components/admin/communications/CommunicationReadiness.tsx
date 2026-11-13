import { useEffect,useRef,useState } from 'react';
import { useT } from '@/lib/i18n';
import { readCommunicationReadiness,type CommunicationReadiness as Report } from '@/lib/supabase/communications';

export function CommunicationReadiness({settingsVersion}:{settingsVersion?:string}) {
  const t=useT();const [report,setReport]=useState<Report|null>(null);
  const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);
  const version=useRef(0);const working=useRef(false);
  useEffect(()=>{version.current++;setReport(null);setFailed(false);return()=>{version.current++;};},[settingsVersion]);
  async function check() {
    if(working.current)return;working.current=true;setBusy(true);setFailed(false);setReport(null);
    const current=version.current;
    try{const result=await readCommunicationReadiness();if(current===version.current)setReport(result);}
    catch{if(current===version.current)setFailed(true);}
    finally{working.current=false;setBusy(false);}
  }
  return <section className="mt-5 rounded-xl border p-4">
    <h3 className="text-sm font-semibold">{t('communications.setup.title')}</h3>
    <p className="mt-2 text-xs text-brand-mid-grey">{t('communications.setup.help')}</p>
    <button type="button" disabled={busy} onClick={()=>void check()} className="mt-3 rounded-xl border px-3 py-2 text-sm disabled:opacity-40">{t(busy?'common.loading':'communications.setup.check')}</button>
    {failed&&<p role="alert" className="mt-3 text-sm text-state-alert">{t('communications.setup.failed')}</p>}
    {report&&<div role="status" className="mt-4">
      <p className="text-xs text-brand-mid-grey">{t('communications.setup.checked')} <time dateTime={report.checkedAt}>{new Date(report.checkedAt).toLocaleString()}</time></p>
      <ul className="mt-3 space-y-3">{report.checks.map(item=><li key={item.key} className="text-sm">
        <span className="font-semibold">{t(`communications.setup.names.${item.key}`)}</span>{' · '}
        <span className={item.state==='pass'?'text-brand-green':item.state==='attention'?'text-state-alert':'text-brand-mid-grey'}>{t(`communications.setup.states.${item.state}`)}</span>
        <p className="mt-1 text-xs text-brand-mid-grey">{t(`communications.setup.reasons.${item.reason}`)}{item.domains?.length?` (${item.domains.join(', ')})`:''}</p>
      </li>)}</ul>
    </div>}
    <p className="mt-4 text-xs text-brand-mid-grey">{t('communications.setup.acceptance')}</p>
  </section>;
}
