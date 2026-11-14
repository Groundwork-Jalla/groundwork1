import { useCallback,useEffect,useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { whatsappApi } from '@/lib/supabase/whatsapp-communications';

export function WhatsAppConsent() {
  const {lang}=useLanguage();const fr=lang==='fr';
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
    catch(e){const code=e instanceof Error?e.message:'';setError(code==='test_recipient_required'?(fr?'Ce numéro doit être autorisé pour le test. Contactez Groundwork.':'This number must be added to the test recipients. Contact Groundwork.') : code==='consent_request_wait'?(fr?'Patientez 30 secondes avant de réessayer.':'Wait 30 seconds before requesting another connection link.'):(fr?'Vérifiez le numéro et réessayez.':'Check the number, including its country code, and try again.'));}
    finally{setBusy(false);}
  }
  return <section className="my-5 rounded-2xl border p-5">
    <h2 className="font-semibold">{fr?'Rappels WhatsApp':'WhatsApp reminders'}</h2>
    <p className="my-2 text-sm text-brand-mid-grey">{fr?'Recevez des rappels pour votre prochaine action et échangez avec notre équipe. Envoyez STOP à tout moment pour les arrêter.':'Receive reminders for your next action and talk to our team. Send STOP at any time to stop WhatsApp messages.'}</p>
    {connected?<><p role="status" className="my-3 text-sm">{fr?'Connecté :':'Connected:'} {state.contact.phone}</p><button type="button" disabled={busy} className="text-sm underline" onClick={()=>void act('disconnect')}>{fr?'Arrêter les messages WhatsApp':'Stop WhatsApp messages'}</button></>:<>
      <label className="block text-sm">{fr?'Votre numéro WhatsApp avec indicatif':'Your WhatsApp number with country code'}<input type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+237…" className="my-2 block w-full rounded-lg border bg-transparent p-3" /></label>
      <label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/>{fr?'Je souhaite recevoir les rappels de Groundwork et les réponses de son équipe sur WhatsApp.':'I agree to receive Groundwork reminders and team replies on WhatsApp.'}</label>
      <button type="button" disabled={busy||!phone||!consent} onClick={()=>void act('connect')} className="rounded-xl bg-brand-green px-4 py-2 text-sm text-white disabled:opacity-40">{fr?'Préparer la connexion WhatsApp':'Connect WhatsApp'}</button>
      {link&&<div className="mt-3 text-sm"><p>{fr?'Ouvrez WhatsApp et envoyez le message START prérempli depuis ce numéro. Le lien est valable 10 minutes.':'Open WhatsApp and send the prepared START message from this number. This link is valid for 10 minutes.'}</p><a href={link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold underline">{fr?'Ouvrir WhatsApp':'Open WhatsApp'}</a></div>}
    </>}
    {error&&<p role="alert" className="mt-3 text-sm text-state-alert">{error}</p>}
  </section>;
}
