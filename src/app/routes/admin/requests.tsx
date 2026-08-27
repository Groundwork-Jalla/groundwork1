import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Plus, Copy, Check, Trash2, ExternalLink, Clapperboard,
} from 'lucide-react';
import {
  AGENT_IDS, ENABLED_AGENTS, PRESETS, briefFor,
  createAgentRequest, deleteAgentRequest, fetchAgentRequests, updateAgentRequest,
  type AgentId, type AgentRequestRow, type RequestLanguage, type RequestStatus,
} from '@/lib/supabase/agent-requests';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';

// =========================================================
// /admin/requests — ask an agent for a piece of work.
//
// Groundwork's agents (.claude/agents/) run against the repository, so only a developer
// can invoke them. This is how everyone else asks: state what you need, it queues, the
// result comes back here. A brief desk, not a runner — see migration 054 for why that
// separation is deliberate rather than a shortfall.
//
// THE FORM ASKS FOR INTENT. Three questions — who watches it, what they should be able
// to do afterwards, when you need it — and the agent works out the shot list. Asking a
// CEO for a shot list gets empty fields; asking what he is trying to achieve gets an
// answer in ninety seconds.
// =========================================================

const STATUS_META: Record<RequestStatus, { labelKey: TKey; cls: string }> = {
  new:         { labelKey: 'admin.requests.statusNew',        cls: 'bg-brand-near-black text-white' },
  in_progress: { labelKey: 'admin.requests.statusInProgress', cls: 'bg-state-held/15 text-state-held border border-state-held/30' },
  delivered:   { labelKey: 'admin.requests.statusDelivered',  cls: 'bg-state-active/10 text-state-active border border-state-active/30' },
  declined:    { labelKey: 'admin.requests.statusDeclined',   cls: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
};

const LANGUAGES: { id: RequestLanguage; labelKey: TKey }[] = [
  { id: 'en',   labelKey: 'admin.requests.langEn'   },
  { id: 'fr',   labelKey: 'admin.requests.langFr'   },
  { id: 'both', labelKey: 'admin.requests.langBoth' },
];

const AGENT_LABEL: Record<AgentId, TKey> = {
  'video-producer': 'admin.requests.agent.videoProducer',
  'budget-analyst': 'admin.requests.agent.budgetAnalyst',
  'qs-liaison':     'admin.requests.agent.qsLiaison',
  'beta-triage':    'admin.requests.agent.betaTriage',
  'ops-desk':       'admin.requests.agent.opsDesk',
};

export default function AdminRequests() {
  const t = useT();
  const { lang } = useLanguage();

  const [rows, setRows]       = useState<AgentRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [target, setTarget]       = useState<AgentRequestRow | null>(null);
  const [busy, setBusy]           = useState(false);
  const [copied, setCopied]       = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchAgentRequests()
      .then(r => { setRows(r); setError(null); })
      .catch(e => setError(errorMessage(e, t('admin.requests.loadFailed'))))
      .finally(() => setLoading(false));
  };
  useEffect(load, [t]);

  const open = useMemo(
    () => rows.filter(r => r.status === 'new' || r.status === 'in_progress').length,
    [rows],
  );

  async function setStatus(r: AgentRequestRow, status: RequestStatus) {
    setRows(prev => prev.map(x => (x.id === r.id ? { ...x, status } : x)));
    try { await updateAgentRequest(r.id, { status }); }
    catch (e) { setError(errorMessage(e, t('admin.requests.saveFailed'))); load(); }
  }

  async function confirmDelete() {
    if (!target) return;
    setBusy(true);
    try {
      await deleteAgentRequest(target.id);
      setRows(prev => prev.filter(r => r.id !== target.id));
      setTarget(null);
    } catch (e) {
      setError(errorMessage(e, t('admin.del.failed')));
    } finally { setBusy(false); }
  }

  function copyBrief(r: AgentRequestRow) {
    // What a developer pastes into the agent. Copying beats re-typing: a paraphrased
    // brief is a different brief, and the gap shows up in what comes back.
    navigator.clipboard?.writeText(briefFor(r)).then(
      () => { setCopied(r.id); setTimeout(() => setCopied(null), 1800); },
      () => setError(t('admin.requests.copyFailed')),
    );
  }

  const fmt = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—'
      : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB',
          { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.requests.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.requests.subtitle')}</p>
        </div>
        {!composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black"
          >
            <Plus className="size-4" /> {t('admin.requests.newCta')}
          </button>
        )}
      </header>

      {composing && (
        <ComposeForm
          onCancel={() => setComposing(false)}
          onCreated={() => { setComposing(false); load(); }}
        />
      )}

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </p>
      ) : rows.length === 0 ? (
        !composing && (
          <div className="rounded-2xl border border-dashed border-brand-border-grey px-6 py-12 text-center">
            <Clapperboard className="mx-auto mb-3 size-6 text-brand-mid-grey" />
            <p className="text-sm font-medium text-brand-near-black">{t('admin.requests.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-brand-mid-grey">
              {t('admin.requests.emptyBody')}
            </p>
          </div>
        )
      ) : (
        <>
          <p className="mb-3 text-xs text-brand-mid-grey">
            {t('admin.requests.openCount', { open, total: rows.length })}
          </p>
          <div className="flex flex-col gap-2">
            {rows.map(r => (
              <RequestCard
                key={r.id}
                row={r}
                copied={copied === r.id}
                onCopy={() => copyBrief(r)}
                onStatus={s => setStatus(r, s)}
                onDelete={() => setTarget(r)}
                fmtDate={fmt}
              />
            ))}
          </div>
        </>
      )}

      <ConfirmDelete
        open={!!target}
        subject={target?.title ?? ''}
        busy={busy}
        error={null}
        onConfirm={confirmDelete}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}

// ── One request ──────────────────────────────────────────

function RequestCard({
  row, copied, onCopy, onStatus, onDelete, fmtDate,
}: {
  row: AgentRequestRow;
  copied: boolean;
  onCopy: () => void;
  onStatus: (s: RequestStatus) => void;
  onDelete: () => void;
  fmtDate: (iso: string | null) => string;
}) {
  const t = useT();
  const meta = STATUS_META[row.status];

  return (
    <div className="rounded-xl border border-brand-border-grey bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.cls)}>
              {t(meta.labelKey)}
            </span>
            <span className="rounded-full bg-brand-off-white px-2 py-0.5 text-[11px] text-brand-mid-grey">
              {t(AGENT_LABEL[row.agent])}
            </span>
            {row.needed_by && (
              <span className="text-[11px] text-brand-mid-grey">
                {t('admin.requests.neededBy', { date: fmtDate(row.needed_by) })}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold text-brand-near-black">{row.title}</p>

          {/* The brief, as answered. Shown in full rather than behind a disclosure: it is
              three short lines and it is the thing anyone opening this card came to read. */}
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
            <Field label={t('admin.requests.fAudience')} value={row.audience} />
            <Field label={t('admin.requests.fGoal')}     value={row.goal} />
            <Field label={t('admin.requests.fChannel')}  value={row.channel} />
            <Field label={t('admin.requests.fLanguage')} value={t(
              row.language === 'en' ? 'admin.requests.langEn'
                : row.language === 'fr' ? 'admin.requests.langFr'
                : 'admin.requests.langBoth')} />
          </dl>
          {row.notes && (
            <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-brand-mid-grey">
              {row.notes}
            </p>
          )}

          {row.output_url && (
            <a
              href={row.output_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-near-black underline underline-offset-2"
            >
              <ExternalLink className="size-3.5" /> {t('admin.requests.openOutput')}
            </a>
          )}
          {row.output_note && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-brand-mid-grey">{row.output_note}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Copy is the primary action for whoever runs the agent. */}
          <button
            type="button"
            onClick={onCopy}
            title={t('admin.requests.copyBrief')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-[11px] font-medium text-brand-near-black transition-colors hover:bg-brand-off-white"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {t(copied ? 'admin.requests.copied' : 'admin.requests.copyBrief')}
          </button>
          <select
            value={row.status}
            onChange={e => onStatus(e.target.value as RequestStatus)}
            aria-label={t('admin.requests.changeStatus')}
            className="rounded-lg border border-brand-border-grey bg-white px-2 py-1.5 text-[11px] text-brand-near-black outline-none focus:ring-2 focus:ring-brand-near-black/20"
          >
            {(Object.keys(STATUS_META) as RequestStatus[]).map(s => (
              <option key={s} value={s}>{t(STATUS_META[s].labelKey)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${t('admin.del.confirm')} ${row.title}`}
            className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-state-alert"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-brand-mid-grey">{label}</dt>
      <dd className="min-w-0 text-brand-near-black">{value}</dd>
    </div>
  );
}

// ── The brief form ───────────────────────────────────────

function ComposeForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const t = useT();
  const [agent, setAgent]       = useState<AgentId>(ENABLED_AGENTS[0]);
  const [preset, setPreset]     = useState<string>('custom');
  const [title, setTitle]       = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal]         = useState('');
  const [channel, setChannel]   = useState('');
  const [language, setLanguage] = useState<RequestLanguage>('en');
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const presets = PRESETS.filter(p => p.agent === agent);

  function choose(id: string) {
    setPreset(id);
    // Fill the title so the form opens part-answered. Only when untouched — overwriting
    // something already typed to "help" is the kind of assistance nobody asks for twice.
    const p = presets.find(x => x.id === id);
    if (p && !title.trim()) setTitle(t(p.labelKey));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr(t('admin.requests.errTitle')); return; }
    setSaving(true); setErr(null);
    try {
      await createAgentRequest({
        agent, preset, title, audience, goal, channel, language,
        neededBy: neededBy || null, notes,
      });
      onCreated();
    } catch (e2) {
      setErr(errorMessage(e2, t('admin.requests.saveFailed')));
      setSaving(false);
    }
  }

  const hint = presets.find(p => p.id === preset)?.hintKey;

  return (
    <form onSubmit={submit} className="mb-6 rounded-2xl border border-brand-border-grey bg-white p-5">
      {/* Which agent. One option today, so it renders as a static label rather than a
          dropdown of one — a select you cannot change is furniture. */}
      {ENABLED_AGENTS.length > 1 ? (
        <label className="mb-4 block">
          <span className="mb-1.5 block text-xs font-semibold text-brand-near-black">{t('admin.requests.fAgent')}</span>
          <select
            value={agent}
            onChange={e => { setAgent(e.target.value as AgentId); setPreset('custom'); }}
            className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
          >
            {AGENT_IDS.filter(a => ENABLED_AGENTS.includes(a)).map(a => (
              <option key={a} value={a}>{t(AGENT_LABEL[a])}</option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mb-4 text-xs text-brand-mid-grey">
          {t('admin.requests.askingAgent', { agent: t(AGENT_LABEL[agent]) })}
        </p>
      )}

      <p className="mb-2 text-xs font-semibold text-brand-near-black">{t('admin.requests.fPreset')}</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => choose(p.id)}
            aria-pressed={preset === p.id}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              preset === p.id
                ? 'border-brand-near-black bg-brand-near-black text-white'
                : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black',
            )}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>
      {hint && <p className="mb-4 text-[11px] leading-relaxed text-brand-mid-grey">{t(hint)}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Text label={t('admin.requests.fTitle')} value={title} onChange={setTitle} required />
        <Text label={t('admin.requests.fChannel')} hint={t('admin.requests.fChannelHint')} value={channel} onChange={setChannel} />
        <Text label={t('admin.requests.fAudience')} hint={t('admin.requests.fAudienceHint')} value={audience} onChange={setAudience} />
        <Text label={t('admin.requests.fGoal')} hint={t('admin.requests.fGoalHint')} value={goal} onChange={setGoal} />

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-brand-near-black">{t('admin.requests.fLanguage')}</span>
          <div className="flex gap-1.5">
            {LANGUAGES.map(l => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLanguage(l.id)}
                aria-pressed={language === l.id}
                className={cn(
                  'flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors',
                  language === l.id
                    ? 'border-brand-near-black bg-brand-near-black text-white'
                    : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey',
                )}
              >
                {t(l.labelKey)}
              </button>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-brand-near-black">{t('admin.requests.fNeededBy')}</span>
          <input
            type="date"
            value={neededBy}
            onChange={e => setNeededBy(e.target.value)}
            className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold text-brand-near-black">{t('admin.requests.fNotes')}</span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder={t('admin.requests.fNotesHint')}
          className="w-full resize-y rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
        />
      </label>

      {err && <p role="alert" className="mt-3 text-xs text-state-alert">{err}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-40"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t('admin.requests.submit')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-3 py-2.5 text-sm font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

function Text({
  label, hint, value, onChange, required,
}: {
  label: string; hint?: string; value: string;
  onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-brand-near-black">
        {label}{required && <span className="text-state-alert">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={hint}
        className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none placeholder:text-brand-mid-grey/70 focus:ring-2 focus:ring-brand-near-black/20"
      />
    </label>
  );
}
