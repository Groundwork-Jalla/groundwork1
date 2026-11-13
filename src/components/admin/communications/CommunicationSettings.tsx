import { useEffect,useRef,useState } from 'react';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { listAdminUsers,type AdminUser } from '@/lib/supabase/admin-users';
import type { CommunicationSettings as Settings } from '@/lib/supabase/communications';
import { CommunicationRunStatus } from './CommunicationRunStatus';

const field='mt-1 w-full rounded-xl border border-brand-border-grey bg-white p-2 text-sm dark:bg-[#181818]';
export function CommunicationSettings() {
  const t=useT();const working=useRef(false);
  const [settings,setSettings]=useState<Settings|null>(null);const [staff,setStaff]=useState<AdminUser[]>([]);
  const [recipients,setRecipients]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);const [reload,setReload]=useState(0);
  const [lastRun,setLastRun]=useState<{started_at:string;status:string}|null>(null);
  const [issues,setIssues]=useState<{key:string;code:string;last_seen_at:string}[]>([]);
  useEffect(()=>{let live=true;setLoading(true);void Promise.all([
    supabase.from('communication_settings').select('*').eq('id',true).single(),listAdminUsers(),
    supabase.from('communication_runs').select('started_at,status').order('started_at',{ascending:false}).limit(1),
    supabase.from('communication_issues').select('key,code,last_seen_at').is('resolved_at',null).order('last_seen_at',{ascending:false}).limit(10),
  ]).then(([result,users,runs,problems])=>{
    if(!live)return;if(result.error||runs.error||problems.error)throw new Error('load');
    setSettings(result.data);setRecipients(result.data.test_recipients.join('\n'));setStaff(users.filter(u=>u.roles.split(',').includes('admin')));setLastRun(runs.data?.[0]??null);
    setIssues(problems.data??[]);
  }).catch(()=>{if(live)setNotice(t('communications.loadFailed'));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[t,reload]);
  const patch=(value:Partial<Settings>)=>setSettings(previous=>previous?{...previous,...value}:null);
  async function save(event:React.FormEvent) {
    event.preventDefault();if(!settings||working.current)return;working.current=true;setBusy(true);setNotice('');
    try {
      const {data,error}=await supabase.rpc('admin_save_communication_settings',{p_expected_at:settings.updated_at,p_settings:{...settings,test_recipients:recipients.split(/[\s,;]+/).map(value=>value.trim()).filter(Boolean)}});
      if(error)throw error;setSettings(data);setRecipients(data.test_recipients.join('\n'));setNotice(t('communications.saved'));
    }catch(error){setNotice(t(String((error as {message?:string})?.message).includes('stale_settings')?'communications.staleSettings':'communications.saveSettingsFailed'));}
    finally{working.current=false;setBusy(false);}
  }
  return <section className="max-w-2xl rounded-2xl border bg-white p-5 dark:bg-[#181818]">
    <h2 className="text-lg font-semibold">{t('communications.settingsTitle')}</h2>
    <p className="mt-2 text-sm text-brand-mid-grey">{t('communications.settingsHelp')}</p>
    {notice&&<p role="status" className="mt-4 text-sm">{notice}</p>}
    {!settings?loading?<p className="mt-4">{t('common.loading')}</p>:<button type="button" onClick={()=>setReload(value=>value+1)} className="mt-4 rounded-xl border px-3 py-2 text-sm">{t('communications.inboxRefresh')}</button>:<form onSubmit={event=>void save(event)} className="mt-5 space-y-4">
      <label className="block text-sm">{t('communications.senderName')}<input required maxLength={100} className={field} value={settings.sender_name} onChange={event=>patch({sender_name:event.target.value})}/></label>
      <label className="block text-sm">{t('communications.senderEmail')}<input type="email" className={field} value={settings.sender_email??''} onChange={event=>patch({sender_email:event.target.value})}/></label>
      <label className="block text-sm">{t('communications.followupSender')}<input type="email" required className={field} value={settings.followup_sender_email} onChange={event=>patch({followup_sender_email:event.target.value})}/></label>
      <label className="block text-sm">{t('communications.applicationSender')}<input type="email" required className={field} value={settings.application_sender_email} onChange={event=>patch({application_sender_email:event.target.value})}/></label>
      <label className="block text-sm">{t('communications.replyDomain')}<input className={field} value={settings.reply_domain??''} onChange={event=>patch({reply_domain:event.target.value})}/><span className="mt-1 block text-xs text-brand-mid-grey">{t('communications.replyDomainHelp')}</span></label>
      <label className="block text-sm">{t('communications.testRecipients')}<textarea rows={3} className={field} value={recipients} onChange={event=>setRecipients(event.target.value)}/><span className="mt-1 block text-xs text-brand-mid-grey">{t('communications.testHelp')}</span></label>
      <label className="block text-sm">{t('communications.defaultOwner')}<select className={field} value={settings.default_owner_id??''} onChange={event=>patch({default_owner_id:event.target.value||null})}>
        <option value="">{t('communications.unassigned')}</option>{staff.map(user=><option key={user.id} value={user.id}>{user.fullName||user.email}</option>)}
      </select></label>
      <label className="block text-sm">{t('communications.nextContactHours')}<input type="number" min={1} max={720} required className={field} value={settings.next_contact_hours} onChange={event=>patch({next_contact_hours:Number(event.target.value)})}/></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.delivery_enabled} onChange={event=>patch({delivery_enabled:event.target.checked})}/>{t('communications.enabled')}</label>
      <button type="submit" disabled={busy} className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{t('communications.saveSettings')}</button>
    </form>}
    <CommunicationRunStatus run={lastRun}/>
    {!!issues.length&&<section className="mt-5 rounded-xl border border-state-alert/30 p-3"><h3 className="text-sm font-semibold">{t('communications.receivingNeedsAttention')}</h3><ul className="mt-2 space-y-2 text-xs">{issues.map(issue=><li key={issue.key}>{t(issue.code==='inbound_provider_403'?'communications.receivingPermission':'communications.receivingFailed')} <time>{new Date(issue.last_seen_at).toLocaleString()}</time></li>)}</ul></section>}
  </section>;
}
