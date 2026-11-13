import { CommunicationSettings } from '@/components/admin/communications/CommunicationSettings';
import { CommunicationInbox } from '@/components/admin/communications/CommunicationInbox';
import { CommunicationRunStatus } from '@/components/admin/communications/CommunicationRunStatus';
import { CommunicationFollowups,type CommunicationFollowup } from '@/components/admin/communications/CommunicationFollowups';
import { useT } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/sequences
//
// The lifecycle journeys the app sends itself (migration 177): edit the steps and the
// wording, switch a sequence on, and work the Day-7 follow-up queue. Every sequence is
// seeded switched OFF with placeholder copy — nothing is sent until someone turns it on.
// Admin-only: RLS on these tables is `is_admin()`.
// =========================================================

interface Sequence {
  key: string; name: string; description: string; trigger_event: string;
  exit_events: string[]; audience: string; followup_after_days: number | null; enabled: boolean;
  journey: string; awaiting_action: string;
}
interface Step {
  id: string; sequence_key: string; position: number; delay_hours: number;
  channel: 'email' | 'whatsapp'; subject_en: string; subject_fr: string; body_en: string; body_fr: string;
  code: string; cta_label_en: string; cta_label_fr: string;
}
interface Followup extends CommunicationFollowup {
  id: string; sequence_key: string; email: string; full_name: string | null; phone: string | null;
  status: 'open' | 'done' | 'dismissed'; note: string; created_at: string;
  reason: string; priority: 'high' | 'normal'; owner: string | null; due_at: string | null;
}
interface SendRow {
  id: string; enrollment_id: string | null; sequence_key: string; email: string; channel: string; status: string;
  error: string | null; sent_at: string; step_code: string | null; subject: string | null;
}
interface Enrollment {
  id: string; sequence_key: string; email: string; full_name: string | null; phone: string | null;
  next_send_at: string | null; last_sent_at: string | null; last_step_code: string | null; emails_sent: number;
  context: { project_name?: string } | null;
}

type Tab = 'attention' | 'sequences' | 'log' | 'inbox' | 'settings';

const ago = (iso: string | null) => {
  if (!iso) return '—';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? 'under an hour ago' : h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
const until = (iso: string | null) => {
  if (!iso) return 'no more emails';
  const h = Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h <= 0 ? 'next email due now' : h < 48 ? `next email in ${h}h` : `next email in ${Math.ceil(h / 24)}d`;
};

const field = 'w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-blue/30';

export default function AdminSequences() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('attention');
  const [seqs, setSeqs] = useState<Sequence[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [waiting, setWaiting] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [nextContactHours,setNextContactHours]=useState(48);
  const [lastRun, setLastRun] = useState<{started_at:string;status:string}|null>(null);
  const [preview, setPreview] = useState<{ recipient: string; step: string | null; subject: string | null; state: string; reason: string; whatsappPaused: boolean }[] | null>(null);

  const load = useCallback(async () => {
    const [s, st, en, fu, lg, settings, runs] = await Promise.all([
      supabase.from('lifecycle_sequences').select('*').order('name'),
      supabase.from('lifecycle_sequence_steps').select('*').order('position'),
      supabase.from('lifecycle_enrollments').select('id, sequence_key, email, full_name, phone, next_send_at, last_sent_at, last_step_code, emails_sent, context').eq('status', 'active').limit(1000),
      supabase.from('followup_queue').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('lifecycle_sends').select('*').order('sent_at', { ascending: false }).limit(300),
      supabase.from('communication_settings').select('delivery_enabled,next_contact_hours').eq('id',true).single(),
      supabase.from('communication_runs').select('started_at,status').order('started_at',{ascending:false}).limit(1),
    ]);
    const failed = [s, st, en, fu, lg, settings, runs].find(r => r.error);
    if (failed?.error) { setError(failed.error.message); return; }
    setSeqs((s.data ?? []) as Sequence[]);
    setSteps((st.data ?? []) as Step[]);
    const c: Record<string, number> = {};
    const active = (en.data ?? []) as Enrollment[];
    for (const r of active) c[r.sequence_key] = (c[r.sequence_key] ?? 0) + 1;
    setCounts(c);
    setWaiting(active.filter(r => r.emails_sent > 0).sort((a, b) => String(a.last_sent_at).localeCompare(String(b.last_sent_at))));
    setFollowups((fu.data ?? []) as Followup[]);
    setSends((lg.data ?? []) as SendRow[]);
    setDeliveryEnabled(settings.data?.delivery_enabled===true);setLastRun(runs.data?.[0]??null);
    setNextContactHours(settings.data?.next_contact_hours??48);
    setError(null);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
    const refresh = () => { if(document.visibilityState!=='hidden') void load(); };
    window.addEventListener('focus',refresh);const poll=setInterval(refresh,30_000);
    return()=>{window.removeEventListener('focus',refresh);clearInterval(poll);};
  }, [load]);

  async function patchSeq(key: string, patch: Partial<Sequence>) {
    setSeqs(p => p.map(s => s.key === key ? { ...s, ...patch } : s));
    const { error: e } = await supabase.from('lifecycle_sequences')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('key', key);
    if (e) { setError(e.message); load(); }
  }
  async function patchStep(id: string, patch: Partial<Step>) {
    setSteps(p => p.map(s => s.id === id ? { ...s, ...patch } : s));
  }
  async function saveStep(step: Step) {
    const { id: _id, sequence_key: _k, ...rest } = step;
    const { error: e } = await supabase.from('lifecycle_sequence_steps').update(rest).eq('id', step.id);
    setNotice(e ? null : 'Saved'); if (e) setError(e.message);
  }
  async function addStep(key: string) {
    const pos = Math.max(0, ...steps.filter(s => s.sequence_key === key).map(s => s.position)) + 1;
    const { error: e } = await supabase.from('lifecycle_sequence_steps')
      .insert({ sequence_key: key, position: pos, delay_hours: 24 });
    if (e) setError(e.message); else load();
  }
  async function removeStep(id: string) {
    const { error: e } = await supabase.from('lifecycle_sequence_steps').delete().eq('id', id);
    if (e) setError(e.message); else load();
  }
  async function runNow(previewOnly = false) {
    if (running) return;
    setRunning(true); setError(null); setNotice(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const response = await fetch('/api/events?action=lifecycle-run', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: previewOnly }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Run failed');
      if (previewOnly) {
        setPreview(result.rows ?? []);
        setNotice(`${result.checked ?? 0} checked, ${result.ready ?? 0} ready. No email was sent.`);
      } else {
        setPreview(null);
        setNotice(`Sent ${result.sent ?? 0}, failed ${result.failed ?? 0}, queued ${result.followups ?? 0} for follow-up`);
        await load();
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Run failed'); }
    finally { setRunning(false); }
  }

  if (loading) {
    return <p className="flex items-center gap-2 p-8 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" /> Loading…</p>;
  }

  const openFollowups = followups.filter(f => f.status === 'open')
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1));
  const seqByKey = new Map(seqs.map(s => [s.key, s]));
  const waitingIds = new Set(waiting.map(w => w.id));
  const problems = sends.filter(r => r.status === 'failed' && r.enrollment_id && waitingIds.has(r.enrollment_id));
  const attentionCount = openFollowups.length + problems.length;

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">{t('communications.pageTitle')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">
            {t('communications.pageHelp')}
          </p>
        </div>
        <button disabled={running} onClick={() => void runNow(true)} className="rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm font-semibold">Preview due messages</button>
        <button disabled={running} onClick={() => void runNow(false)} className="inline-flex items-center gap-2 rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50">
          <Play className="size-4" /> Run due now
        </button>
      </header>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      {!deliveryEnabled&&<p role="status" className="mb-4 rounded-xl border p-3 text-sm">{t('communications.deliveryPaused')} <button type="button" onClick={()=>setTab('settings')} className="underline">{t('communications.settings')}</button></p>}
      <CommunicationRunStatus run={lastRun}/>
      {preview && <details className="rounded-xl border border-brand-border-grey bg-white p-4" open>
        <summary className="cursor-pointer text-sm font-semibold">Reminder preview</summary>
        <ul className="mt-3 space-y-3 text-xs">{preview.map((row, index) => <li key={index}>
          <p className="font-semibold">{row.recipient} · {row.step || 'Follow-up review'}</p>
          <p>{row.subject}</p>
          <p className="text-brand-mid-grey">{row.whatsappPaused ? 'WhatsApp outreach paused' : row.reason.replace(/_/g, ' ')}</p>
        </li>)}</ul>
      </details>}


      <div className="mb-5 flex flex-wrap gap-1.5">
        {([['attention', `Needs attention · ${attentionCount}`], ['sequences', 'Sequences'], ['log', 'Send log'], ['inbox', t('communications.inbox')], ['settings', t('communications.settings')]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-medium',
              tab === k ? 'border-brand-near-black bg-brand-near-black text-white' : 'border-brand-border-grey bg-white text-brand-near-black')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'inbox' && <CommunicationInbox />}
      {tab === 'settings' && <CommunicationSettings />}

      {tab === 'sequences' && (
        <div className="space-y-5">
          {seqs.map((s, i) => {
            const own = steps.filter(x => x.sequence_key === s.key);
            const frMissing = own.some(x => !x.body_fr.trim());
            return (
              <section key={s.key} className="rounded-2xl border border-brand-border-grey bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    {s.journey && s.journey !== seqs[i - 1]?.journey && (
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-blue">{s.journey}</p>
                    )}
                    <h2 className="text-base font-semibold text-brand-near-black">{s.name}</h2>
                    <p className="text-xs text-brand-mid-grey">
                      {s.description} Starts on <code>{s.trigger_event}</code>; stops on {s.exit_events.length ? s.exit_events.map(e => <code key={e}>{e} </code>) : 'nothing'}
                      · {counts[s.key] ?? 0} in progress
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={s.enabled} onChange={e => patchSeq(s.key, { enabled: e.target.checked })} />
                    {s.enabled ? 'On' : 'Off'}
                    {frMissing && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">French missing</span>}
                  </label>
                </div>

                <div className="mt-3 flex items-center gap-2 text-sm">
                  <span>Hand to a person after</span>
                  <input type="number" min={1} className="w-16 rounded-lg border border-brand-border-grey px-2 py-1"
                    value={s.followup_after_days ?? ''} placeholder="—"
                    onChange={e => patchSeq(s.key, { followup_after_days: e.target.value ? Number(e.target.value) : null })} />
                  <span>days (blank = never)</span>
                </div>

                <div className="mt-4 space-y-4">
                  {own.map(st => (
                    <div key={st.id} className="rounded-xl border border-brand-border-grey p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                        <strong>{st.code ? `${st.code} · ` : ''}Step {st.position}</strong>
                        <span>send</span>
                        <input type="number" min={0} className="w-20 rounded-lg border border-brand-border-grey px-2 py-1"
                          value={st.delay_hours} onChange={e => patchStep(st.id, { delay_hours: Number(e.target.value) || 0 })} />
                        <span>hours after {st.position === 1 ? 'enrolling' : 'the previous step'} by</span>
                        <select className="rounded-lg border border-brand-border-grey px-2 py-1" value={st.channel}
                          onChange={e => patchStep(st.id, { channel: e.target.value as Step['channel'] })}>
                          <option value="email">Email</option>
                          <option value="whatsapp">WhatsApp</option>
                        </select>
                        <button onClick={() => removeStep(st.id)} className="ml-auto text-red-600" aria-label="Remove step"><Trash2 className="size-4" /></button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {st.channel === 'email' && <input className={field} placeholder="Subject (EN)" value={st.subject_en} onChange={e => patchStep(st.id, { subject_en: e.target.value })} />}
                        {st.channel === 'email' && <input className={field} placeholder="Objet (FR)" value={st.subject_fr} onChange={e => patchStep(st.id, { subject_fr: e.target.value })} />}
                        <textarea rows={5} className={field} placeholder="Message (EN)" value={st.body_en} onChange={e => patchStep(st.id, { body_en: e.target.value })} />
                        <textarea rows={5} className={field} placeholder="Message (FR)" value={st.body_fr} onChange={e => patchStep(st.id, { body_fr: e.target.value })} />
                      </div>
                      {st.channel === 'email' && (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <input className={field} placeholder="Button label (EN)" value={st.cta_label_en} onChange={e => patchStep(st.id, { cta_label_en: e.target.value })} />
                          <input className={field} placeholder="Libellé du bouton (FR)" value={st.cta_label_fr} onChange={e => patchStep(st.id, { cta_label_fr: e.target.value })} />
                        </div>
                      )}
                      <button onClick={() => saveStep(st)} className="mt-2 rounded-lg bg-brand-near-black px-3 py-1.5 text-sm font-semibold text-white">Save step</button>
                    </div>
                  ))}
                  <button onClick={() => addStep(s.key)} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue">
                    <Plus className="size-4" /> Add step
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {tab === 'attention' && (
        <div className="space-y-8">
          <CommunicationFollowups items={followups} onChanged={() => { void load(); }} nextContactHours={nextContactHours}/>

          {problems.length > 0 && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-red-700">Delivery problems · {problems.length}</h2>
              <ul className="space-y-2">
                {problems.map(r => (
                  <li key={r.id} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm">
                    <strong>{r.email}</strong> — {r.step_code ?? r.sequence_key} failed {ago(r.sent_at)}: {r.error ?? 'unknown error'}. It is retried every hour.
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-base font-semibold text-brand-near-black">Emailed, waiting on them · {waiting.length}</h2>
            <p className="mb-3 text-xs text-brand-mid-grey">Longest wait first. Each one leaves this list the moment they do the action.</p>
            <div className="overflow-x-auto rounded-2xl border border-brand-border-grey bg-white">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-brand-mid-grey">
                  <tr><th className="p-3">Who</th><th className="p-3">Journey</th><th className="p-3">Waiting for</th><th className="p-3">Last email</th><th className="p-3">Next</th></tr>
                </thead>
                <tbody>
                  {waiting.length === 0 && <tr><td className="p-3 text-brand-mid-grey" colSpan={5}>No one is mid-sequence.</td></tr>}
                  {waiting.map(w => {
                    const sq = seqByKey.get(w.sequence_key);
                    return (
                      <tr key={w.id} className="border-t border-brand-border-grey align-top">
                        <td className="p-3">
                          <p className="font-medium">{w.full_name || w.email}</p>
                          <p className="text-xs text-brand-mid-grey">{w.full_name ? w.email : ''}{w.context?.project_name ? ` · ${w.context.project_name}` : ''}</p>
                        </td>
                        <td className="p-3">{sq?.name ?? w.sequence_key}</td>
                        <td className="p-3">{sq?.awaiting_action || '—'}</td>
                        <td className="p-3">{w.last_step_code ?? '—'} · {ago(w.last_sent_at)} <span className="text-xs text-brand-mid-grey">({w.emails_sent} sent)</span></td>
                        <td className="p-3 text-xs text-brand-mid-grey">{until(w.next_send_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'log' && (
        <div className="overflow-x-auto rounded-2xl border border-brand-border-grey bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-brand-mid-grey">
              <tr><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">Email</th><th className="p-3">Channel</th><th className="p-3">Result</th></tr>
            </thead>
            <tbody>
              {sends.length === 0 && <tr><td className="p-3 text-brand-mid-grey" colSpan={5}>Nothing sent yet.</td></tr>}
              {sends.map(r => (
                <tr key={r.id} className="border-t border-brand-border-grey">
                  <td className="p-3">{new Date(r.sent_at).toLocaleString()}</td>
                  <td className="p-3">{r.email}</td>
                  <td className="p-3">{r.step_code ? `${r.step_code} · ` : ''}{r.subject ?? r.sequence_key}</td>
                  <td className="p-3">{r.channel}</td>
                  <td className={cn('p-3', r.status === 'failed' && 'text-red-600')}>{r.status}{r.error ? ` — ${r.error}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
