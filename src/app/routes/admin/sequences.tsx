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
}
interface Step {
  id: string; sequence_key: string; position: number; delay_hours: number;
  channel: 'email' | 'whatsapp'; subject_en: string; subject_fr: string; body_en: string; body_fr: string;
}
interface Followup {
  id: string; sequence_key: string; email: string; full_name: string | null; phone: string | null;
  status: 'open' | 'done' | 'dismissed'; note: string; created_at: string;
}
interface SendRow { id: string; sequence_key: string; email: string; channel: string; status: string; error: string | null; sent_at: string }

type Tab = 'sequences' | 'followups' | 'log';

const field = 'w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-blue/30';

export default function AdminSequences() {
  const [tab, setTab] = useState<Tab>('sequences');
  const [seqs, setSeqs] = useState<Sequence[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, st, en, fu, lg] = await Promise.all([
      supabase.from('lifecycle_sequences').select('*').order('name'),
      supabase.from('lifecycle_sequence_steps').select('*').order('position'),
      supabase.from('lifecycle_enrollments').select('sequence_key').eq('status', 'active'),
      supabase.from('followup_queue').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('lifecycle_sends').select('*').order('sent_at', { ascending: false }).limit(100),
    ]);
    const failed = [s, st, en, fu, lg].find(r => r.error);
    if (failed?.error) { setError(failed.error.message); return; }
    setSeqs((s.data ?? []) as Sequence[]);
    setSteps((st.data ?? []) as Step[]);
    const c: Record<string, number> = {};
    for (const r of (en.data ?? []) as { sequence_key: string }[]) c[r.sequence_key] = (c[r.sequence_key] ?? 0) + 1;
    setCounts(c);
    setFollowups((fu.data ?? []) as Followup[]);
    setSends((lg.data ?? []) as SendRow[]);
    setError(null);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

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
  async function resolve(id: string, status: 'done' | 'dismissed') {
    const { error: e } = await supabase.from('followup_queue')
      .update({ status, resolved_at: new Date().toISOString() }).eq('id', id);
    if (e) setError(e.message); else load();
  }
  async function saveNote(f: Followup) {
    await supabase.from('followup_queue').update({ note: f.note }).eq('id', f.id);
  }
  async function runNow() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const r = await fetch('/api/events?action=lifecycle-run', {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const b = await r.json().catch(() => ({}));
    setNotice(r.ok ? `Sent ${b.sent ?? 0}, failed ${b.failed ?? 0}, queued ${b.followups ?? 0} for follow-up` : 'Run failed');
    load();
  }

  if (loading) {
    return <p className="flex items-center gap-2 p-8 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" /> Loading…</p>;
  }

  const openFollowups = followups.filter(f => f.status === 'open');

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">Sequences</h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">
            Automatic emails and WhatsApp messages, started by lifecycle events. Every sequence starts switched off with
            placeholder wording — edit it, then switch it on. Use {'{{first_name}}'} to personalise.
          </p>
        </div>
        <button onClick={runNow} className="inline-flex items-center gap-2 rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50">
          <Play className="size-4" /> Run due now
        </button>
      </header>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      <div className="mb-5 flex gap-1.5">
        {([['sequences', 'Sequences'], ['followups', `Follow-up queue · ${openFollowups.length}`], ['log', 'Send log']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-medium',
              tab === k ? 'border-brand-near-black bg-brand-near-black text-white' : 'border-brand-border-grey bg-white text-brand-near-black')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'sequences' && (
        <div className="space-y-5">
          {seqs.map(s => {
            const own = steps.filter(x => x.sequence_key === s.key);
            return (
              <section key={s.key} className="rounded-2xl border border-brand-border-grey bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-brand-near-black">{s.name}</h2>
                    <p className="text-xs text-brand-mid-grey">
                      {s.description} Starts on <code>{s.trigger_event}</code>; stops on {s.exit_events.length ? s.exit_events.map(e => <code key={e}>{e} </code>) : 'nothing'}
                      · {counts[s.key] ?? 0} in progress
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={s.enabled} onChange={e => patchSeq(s.key, { enabled: e.target.checked })} />
                    {s.enabled ? 'On' : 'Off'}
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
                        <strong>Step {st.position}</strong>
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

      {tab === 'followups' && (
        <ul className="space-y-3">
          {followups.length === 0 && <li className="text-sm text-brand-mid-grey">Nobody has reached Day 7 yet.</li>}
          {followups.map(f => (
            <li key={f.id} className="rounded-2xl border border-brand-border-grey bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-brand-near-black">{f.full_name || f.email}</p>
                  <p className="text-xs text-brand-mid-grey">{f.email}{f.phone ? ` · ${f.phone}` : ''} · {f.sequence_key} · {new Date(f.created_at).toLocaleDateString()}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium">{f.status}</span>
              </div>
              <textarea rows={2} className={cn(field, 'mt-3')} placeholder="Note — what happened on the call?" value={f.note}
                onChange={e => setFollowups(p => p.map(x => x.id === f.id ? { ...x, note: e.target.value } : x))}
                onBlur={() => saveNote(f)} />
              {f.status === 'open' && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => saveNote(f).then(() => resolve(f.id, 'done'))} className="rounded-lg bg-brand-near-black px-3 py-1.5 text-sm font-semibold text-white">Mark done</button>
                  <button onClick={() => resolve(f.id, 'dismissed')} className="rounded-lg border border-brand-border-grey px-3 py-1.5 text-sm">Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === 'log' && (
        <div className="overflow-x-auto rounded-2xl border border-brand-border-grey bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-brand-mid-grey">
              <tr><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">Sequence</th><th className="p-3">Channel</th><th className="p-3">Result</th></tr>
            </thead>
            <tbody>
              {sends.length === 0 && <tr><td className="p-3 text-brand-mid-grey" colSpan={5}>Nothing sent yet.</td></tr>}
              {sends.map(r => (
                <tr key={r.id} className="border-t border-brand-border-grey">
                  <td className="p-3">{new Date(r.sent_at).toLocaleString()}</td>
                  <td className="p-3">{r.email}</td>
                  <td className="p-3">{r.sequence_key}</td>
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
