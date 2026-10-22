import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Clock, FileText, Loader2, Search, UserRound } from 'lucide-react';
import {
  attention, byStage, fetchPipeline, partnersOnly, pipelineAvailable, savePipeline, sortForWork,
  PIPELINE_STAGES, MANUAL_STAGES,
  type Attention, type PipelineRow, type PipelineStage,
} from '@/lib/admin/partner-pipeline';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/partners — the partner pipeline, as a worklist.
//
// Philip's rule: nobody sits in the pipeline without a stage, a last action, a next
// action, an owner, a next-action date and a fourteen-day activation deadline. So the
// ABSENCE of any of those is what this page leads with — an unowned applicant is not a
// blank column to scroll past, it is the first row on the list.
//
// The counters on /admin/contractors/records say where the funnel leaks. This says who
// to ring. They are different questions and deliberately different screens.
// =========================================================

export default function AdminPartnerPipeline() {
  const t = useT();
  const [rows, setRows] = useState<PipelineRow[] | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  /** Clicking a stage count narrows the list to it — a count nobody can open is decoration. */
  const [stage, setStage] = useState<PipelineStage | null>(null);
  /**
   * A contractor account is not a partner application.
   *
   * The board is built over every contractor, because "account created" and "onboarded"
   * are genuine funnel steps. But somebody reviewing applications is not looking for
   * people who never made one, so applicants lead and the rest are a click away.
   */
  const [scope, setScope] = useState<'partners' | 'everyone'>('partners');

  const load = useCallback(async () => {
    try {
      if (!(await pipelineAvailable())) { setAbsent(true); setRows([]); return; }
      setRows(await fetchPipeline());
      setError(null);
    } catch (e) {
      setRows([]);
      setError(errorMessage(e, t('adminPipeline.loadFailed')));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Whether the board can tell a partner from a contractor at all.
   *
   * 148 is what returns the application id. Before it is applied every row reads as
   * "never applied", and narrowing to applicants would show Ruth an empty screen —
   * worse than the noise it was meant to cut. So the separation only switches on once
   * the data can support it.
   */
  const canSeparate = (rows ?? []).some(r => r.applicationId !== null);

  const scoped = useMemo(
    () => (scope === 'partners' && canSeparate ? partnersOnly(rows ?? []) : (rows ?? [])),
    [rows, scope, canSeparate]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (r: PipelineRow) =>
      (!stage || r.stage === stage) &&
      (!q || [r.fullName, r.email, r.phone, r.specialty, r.ownerName, r.nextAction]
        .some(v => (v ?? '').toLowerCase().includes(q)));
    return sortForWork(scoped.filter(hit));
  }, [scoped, query, stage]);

  if (!rows) {
    return <div className="flex justify-center p-12"><Loader2 className="size-5 animate-spin text-brand-mid-grey" /></div>;
  }

  const counts = byStage(scoped);
  const needing = scoped.filter(r => attention(r) !== null).length;
  const applicants = partnersOnly(rows).length;
  const prospects = rows.length - applicants;

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          {t('adminPipeline.title')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('adminPipeline.subtitle')}</p>
      </header>

      {absent && (
        <p className="mb-6 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {t('adminPipeline.notApplied')}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-6 rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm dark:bg-[#1e1e1e] dark:text-white">{error}</p>
      )}

      {/* Where everybody is. Real rows only — an empty stage shows a zero, not a guess. */}
      <section className="mb-5" aria-label={t('adminPipeline.stageStrip')}>
        <ol className="grid gap-2 sm:grid-cols-5">
          {PIPELINE_STAGES.map(st => (
            <li key={st}>
              <button
                type="button"
                onClick={() => setStage(stage === st ? null : st)}
                aria-pressed={stage === st}
                disabled={counts[st] === 0 && stage !== st}
                className={cn(
                  'w-full rounded-xl border px-3 py-2 text-left transition-colors',
                  'disabled:cursor-default disabled:opacity-60',
                  stage === st
                    ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                    : 'border-brand-border-grey bg-white hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:border-white')}
              >
                <span className={cn('block truncate text-[11px]',
                  stage === st ? 'text-white/70 dark:text-brand-near-black/70' : 'text-brand-mid-grey')}>
                  {t(`adminPipeline.stage.${st}` as TKey)}
                </span>
                <span className={cn('block text-lg font-bold tabular-nums',
                  stage === st ? '' : 'text-brand-near-black dark:text-white')}>{counts[st]}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-brand-mid-grey" aria-hidden />
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder={t('adminPipeline.search')}
            className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-base sm:text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
          />
        </div>
        {needing > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-state-alert/10 px-3 py-1 text-xs font-semibold text-state-alert">
            <AlertTriangle className="size-3.5" aria-hidden />
            {t('adminPipeline.needing').replace('{n}', String(needing))}
          </span>
        )}
        {stage && (
          <button type="button" onClick={() => setStage(null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-border-grey px-3 py-1 text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black dark:border-[#444] dark:hover:text-white">
            {t('adminPipeline.clearStage').replace('{s}', t(`adminPipeline.stage.${stage}` as TKey))}
          </button>
        )}
      </div>

      {/* A partner applied. A contractor merely has an account. The screen says which. */}
      {canSeparate && (
      <p className="mb-4 text-xs text-brand-mid-grey">
        {scope === 'partners'
          ? t('adminPipeline.scopePartners')
              .replace('{n}', String(applicants)).replace('{m}', String(prospects))
          : t('adminPipeline.scopeEveryone')
              .replace('{n}', String(applicants)).replace('{m}', String(prospects))}{' '}
        <button type="button"
          onClick={() => { setScope(scope === 'partners' ? 'everyone' : 'partners'); setStage(null); }}
          className="font-semibold text-brand-near-black underline underline-offset-2 dark:text-white">
          {t(scope === 'partners' ? 'adminPipeline.showEveryone' : 'adminPipeline.showPartners')}
        </button>
      </p>
      )}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-brand-border-grey px-4 py-8 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
          {t(rows.length === 0 ? 'adminPipeline.empty' : 'adminPipeline.emptyFiltered')}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map(r => (
            <PipelineCard
              key={r.userId} row={r} canSeparate={canSeparate}
              expanded={open === r.userId}
              onToggle={() => setOpen(open === r.userId ? null : r.userId)}
              onSaved={load}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const FLAG_TONE: Record<Exclude<Attention, null>, string> = {
  // Accepted but invisible to clients is the loudest: the decision was made, the
  // applicant was told, and no client can find them.
  not_in_directory: 'bg-state-alert/10 text-state-alert',
  deadline_passed: 'bg-state-alert/10 text-state-alert',
  overdue:         'bg-state-alert/10 text-state-alert',
  unowned:         'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  no_next_action:  'bg-amber-500/10 text-amber-700 dark:text-amber-400',
};

function PipelineCard({ row, canSeparate, expanded, onToggle, onSaved }: {
  row: PipelineRow; canSeparate: boolean;
  expanded: boolean; onToggle: () => void; onSaved: () => Promise<void>;
}) {
  const t = useT();
  const flag = attention(row);

  return (
    <li className="rounded-xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <div className="flex items-center">
      <button type="button" onClick={onToggle} aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-brand-near-black dark:text-white">
              {row.fullName || row.email || t('adminPipeline.unnamed')}
            </span>
            <span className="shrink-0 rounded-full bg-brand-light-grey px-2 py-0.5 text-[11px] font-semibold text-brand-mid-grey dark:bg-[#2c2c2c]">
              {t(`adminPipeline.stage.${row.stage}` as TKey)}
            </span>
            {flag && (
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', FLAG_TONE[flag])}>
                {t(`adminPipeline.flag.${flag}` as TKey)}
              </span>
            )}
            {/* Never applied: a contractor account, not a partner. Said plainly rather
                than left for staff to infer from a missing button. */}
            {canSeparate && !row.applicationId && (
              <span className="shrink-0 rounded-full border border-brand-border-grey px-2 py-0.5 text-[11px] font-medium text-brand-mid-grey dark:border-[#444]">
                {t('adminPipeline.noApplication')}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-brand-mid-grey">
            {[row.specialty,
              row.applicationStatus === 'accepted' && row.inDirectory ? t('adminPipeline.inDirectory') : null,
              row.ownerName ? t('adminPipeline.ownedBy').replace('{n}', row.ownerName) : null,
              row.nextAction ? `${row.nextAction}${row.nextActionOn ? ` · ${row.nextActionOn}` : ''}` : null]
              .filter(Boolean).join(' · ') || t('adminPipeline.nothingRecorded')}
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-xs tabular-nums text-brand-mid-grey sm:flex">
          <Clock className="size-3.5" aria-hidden />
          {t('adminPipeline.daysInStage').replace('{n}', String(row.daysInStage))}
        </span>
      </button>

      {/* Outside the toggle, deliberately: a link nested in a button is not operable by
          keyboard and the row already has a job. This is the one Ruth was looking for —
          the answers themselves, which /admin/applications/:id has always rendered. */}
      {row.applicationId && (
        <Link
          to={`/admin/applications/${row.applicationId}`}
          className="mr-3 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-semibold text-brand-near-black hover:bg-brand-off-white dark:border-[#444] dark:text-white dark:hover:bg-[#2c2c2c]"
        >
          <FileText className="size-3.5" aria-hidden />
          {t('adminPipeline.review')}
        </Link>
      )}
      </div>

      {expanded && <PipelineEditor row={row} onSaved={onSaved} />}
    </li>
  );
}

function PipelineEditor({ row, onSaved }: { row: PipelineRow; onSaved: () => Promise<void> }) {
  const t = useT();
  const [lastAction, setLastAction] = useState('');
  const [nextAction, setNextAction] = useState(row.nextAction ?? '');
  const [nextOn, setNextOn] = useState(row.nextActionOn ?? '');
  const [deadline, setDeadline] = useState(row.activationDeadline ?? '');
  const [notes, setNotes] = useState(row.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reached = (s: PipelineStage) =>
    PIPELINE_STAGES.indexOf(row.stage) >= PIPELINE_STAGES.indexOf(s);

  const mark = async (patch: Parameters<typeof savePipeline>[1]) => {
    setBusy(true); setErr(null);
    try { await savePipeline(row.userId, patch); await onSaved(); }
    catch (e) { setErr(errorMessage(e, t('adminPipeline.saveFailed'))); }
    finally { setBusy(false); }
  };

  const field = 'w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-base sm:text-sm dark:border-[#444] dark:bg-[#141414] dark:text-white';

  return (
    <div className="space-y-4 border-t border-brand-border-grey px-4 py-4 dark:border-[#2c2c2c]">
      {/* The three the product cannot see for itself. Everything else on this card is
          derived, which is why only these are ticked by hand. */}
      <div className="flex flex-wrap gap-2">
        {MANUAL_STAGES.map(s => (
          <button
            key={s} type="button" disabled={busy}
            onClick={() => void mark(
              s === 'call_completed'   ? { callCompleted:   !reached(s) }
            : s === 'committed'        ? { committed:       !reached(s) }
            :                            { agreementSigned: !reached(s) })}
            className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
              reached(s)
                ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#444]')}
          >
            {t(`adminPipeline.mark.${s}` as TKey)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-brand-near-black dark:text-white">
            {t('adminPipeline.lastActionLabel')}
          </span>
          <input value={lastAction} onChange={e => setLastAction(e.target.value)} className={field}
            placeholder={row.lastAction ?? t('adminPipeline.lastActionPlaceholder')} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-brand-near-black dark:text-white">
            {t('adminPipeline.nextActionLabel')}
          </span>
          <input value={nextAction} onChange={e => setNextAction(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-brand-near-black dark:text-white">
            {t('adminPipeline.nextOnLabel')}
          </span>
          <input type="date" value={nextOn} onChange={e => setNextOn(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-brand-near-black dark:text-white">
            {t('adminPipeline.deadlineLabel')}
          </span>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className={field} />
          <span className="mt-1 block text-[11px] text-brand-mid-grey">{t('adminPipeline.deadlineHint')}</span>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-brand-near-black dark:text-white">
          {t('adminPipeline.notesLabel')}
        </span>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={field} />
      </label>

      {err && <p role="alert" className="text-xs text-state-alert">{err}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button" disabled={busy}
          onClick={() => void mark({
            lastAction: lastAction.trim() || undefined,
            nextAction: nextAction.trim() || undefined,
            nextActionOn: nextOn || undefined,
            activationDeadline: deadline || undefined,
            notes: notes.trim() || undefined,
          })}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-brand-near-black"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t('adminPipeline.save')}
        </button>
        {!row.ownerId && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <UserRound className="size-3.5" aria-hidden />{t('adminPipeline.flag.unowned')}
          </span>
        )}
      </div>
    </div>
  );
}
