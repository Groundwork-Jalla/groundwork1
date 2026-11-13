import { useEffect,useRef,useState } from 'react';
import { useParams } from 'react-router';
import { useLanguage } from '@/lib/i18n';
import { translator } from '@/lib/i18n/translate';
import { readPreference,savePreference,type Preference } from '@/lib/supabase/communications';

/** Viewing a preference link never changes consent; the recipient confirms a choice. */
export default function CommunicationPreferences() {
  const {token=''}=useParams();const {lang}=useLanguage();
  const current=useRef(token);current.current=token;
  const [state,setState]=useState<{token:string;value:Preference}|null>(null);
  const [error,setError]=useState<'communications.unavailable'|'communications.saveFailed'|null>(null);const [busy,setBusy]=useState(false);const [saved,setSaved]=useState(false);
  useEffect(()=>{let live=true;setState(null);setError(null);setSaved(false);setBusy(false);
    if(!/^[0-9a-f-]{36}$/i.test(token)) {setError('communications.unavailable');return;}
    void readPreference(token).then(value=>{if(live)setState({token,value});}).catch(()=>{if(live)setError('communications.unavailable');});
    return()=>{live=false;};
  },[token]);
  const value=state?.token===token?state.value:null;
  const t=translator(value?.lang??lang);
  async function choose(choice:'pause_project'|'unsubscribe'|'resume') {
    if(busy||!value) return;const request=token;setBusy(true);setError(null);setSaved(false);
    try {const next=await savePreference(token,choice);if(current.current===request){setState({token:request,value:next});setSaved(true);}}
    catch {if(current.current===request)setError('communications.saveFailed');}
    finally {if(current.current===request)setBusy(false);}
  }
  return <main className="mx-auto max-w-xl p-6 py-16">
    <p className="text-sm font-semibold text-brand-green">Groundwork by Jalla</p>
    <h1 className="mt-4 text-2xl font-semibold">{t('communications.preferences')}</h1>
    <p className="mt-3 text-sm text-brand-mid-grey">{t('communications.preferenceHelp')}</p>
    {error&&<p role="alert" className="mt-4 text-state-alert">{t(error)}</p>}
    {!value&&!error&&<p className="mt-6">{t('common.loading')}</p>}
    {value&&<section id="project" className="mt-6 space-y-4 rounded-2xl border p-5">
      <p>{t(value.activation_unsubscribed?'communications.unsubscribed':value.project_creation_paused?'communications.projectPaused':'communications.remindersAllowed')}</p>
      <button type="button" disabled={busy||value.project_creation_paused} onClick={()=>void choose('pause_project')} className="block rounded-xl border px-4 py-3 text-left text-sm disabled:opacity-40">{t('communications.pauseProject')}</button>
      <button type="button" disabled={busy||value.activation_unsubscribed} onClick={()=>void choose('unsubscribe')} className="block rounded-xl border px-4 py-3 text-left text-sm disabled:opacity-40">{t('communications.stopReminders')}</button>
      {(value.project_creation_paused||value.activation_unsubscribed)&&<button type="button" disabled={busy} onClick={()=>void choose('resume')} className="rounded-xl bg-brand-green px-4 py-3 text-sm text-white">{t('communications.allowReminders')}</button>}
      {saved&&<p role="status" className="text-sm text-brand-green">{t('communications.preferenceSaved')}</p>}
    </section>}
  </main>;
}
