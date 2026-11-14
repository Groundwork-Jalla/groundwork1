import { useCallback,useEffect,useState } from 'react';
import { useT } from '@/lib/i18n';
import { whatsappApi } from '@/lib/supabase/whatsapp-communications';

export function WhatsAppConsent() {
  const t=useT();
  const [state,setState]=useState<any>(null);const [phone,setPhone]=useState('');const [consent,setConsent]=useState(false);
  const [link,setLink]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const load=useCallback(async()=>{try{const result=await whatsappApi('whatsapp-profile');setState(result);if(result.contact?.consent_at&&!result.contact?.opted_out_at)setLink('');}catch{/* Not released/configured yet. Existing profile stays usable. */}},[]);
  useEffect(()=>{void load();const refresh=()=>void load();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[load]);
  useEffect(()=>{if(!link)return;const poll=setInterval(()=>void load(),5000);return()=>clearInterval(poll);},[link,load]);
  if(!state?.available) return null;
  const connected=state.contact?.consent_at&&!state.contact?.opted_out_at;
  async function act(operation:'connect'|'disconnect') {
    if(busy)return;setBusy(true);setError('');
    try {const result=await whatsappApi('whatsapp-profile',{operation,phone,consent});setLink(result.url??'');await load();}
    catch(e){const code=e instanceof Error?e.message:'';setError(t(code==='test_recipient_required'?'whatsapp.profile.test':code==='consent_request_wait'?'whatsapp.profile.wait':'whatsapp.profile.failed'));}
    finally{setBusy(false);}
  }
  return <section className="my-5 rounded-2xl border p-5">
    <h2 className="font-semibold">{t('whatsapp.profile.title')}</h2>
    <p className="my-2 text-sm text-brand-mid-grey">{t('whatsapp.profile.help')}</p>
    {connected?<><p role="status" className="my-3 text-sm">{t('whatsapp.profile.connected')} {state.contact.phone}</p><button type="button" disabled={busy} className="text-sm underline" onClick={()=>void act('disconnect')}>{t('whatsapp.profile.stop')}</button></>:<>
      <label className="block text-sm">{t('whatsapp.profile.phone')}<input type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+237…" className="my-2 block w-full rounded-lg border bg-transparent p-3" /></label>
      <label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/>{t('whatsapp.profile.consent')}</label>
      <button type="button" disabled={busy||!phone||!consent} onClick={()=>void act('connect')} className="rounded-xl bg-brand-green px-4 py-2 text-sm text-white disabled:opacity-40">{t('whatsapp.profile.connect')}</button>
      {link&&<div className="mt-3 text-sm"><p>{t('whatsapp.profile.instructions')}</p><a href={link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold underline">{t('whatsapp.profile.open')}</a></div>}
    </>}
    {error&&<p role="alert" className="mt-3 text-sm text-state-alert">{error}</p>}
  </section>;
}
