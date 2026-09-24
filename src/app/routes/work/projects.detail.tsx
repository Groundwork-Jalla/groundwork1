import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Check, FileText, Loader2, Lock, Upload } from 'lucide-react';
import {
  fetchAssignedProject, fetchSubstages, fetchProjectDocuments, fetchRework, fetchMyPayments,
  submitSiteUpdate,
  type AssignedProject, type ReworkItem, type ContractorPayment,
} from '@/lib/supabase/contractor-work';
import type { ProjectSubstageRow, ProjectDocumentRow } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { fileProblem, FILE_ACCEPT_ATTR, MAX_FILE_MB } from '@/lib/documents/accepted-files';
import { useT, type TKey } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

// =========================================================
// One assigned project, from the contractor's side.
//
// This is NOT the admin Project Workspace with controls removed. It answers one question —
// "what do I need to build or submit next?" — so the active stage and its checklist lead,
// and everything the contractor cannot act on is reference material behind a tab.
//
// Authority, enforced by the database and mirrored here so the UI never offers a dead
// control: no assign, no request verification, no record verification, no approve stage,
// no confirm funding, no authorise release. The contractor reports work; Groundwork
// governs what happens next.
// =========================================================

type Tab = 'work' | 'documents' | 'payments';

const TABS: { id: Tab; key: TKey }[] = [
  { id: 'work',      key: 'contractorProject.tabWork' },
  { id: 'documents', key: 'contractorProject.tabDocuments' },
  { id: 'payments',  key: 'contractorProject.tabPayments' },
];

export default function ContractorProjectDetail() {
  const t = useT();
  const { projectId } = useParams<{ projectId: string }>();
  const { stageLabel, substageLabel } = useStageLabels();

  const [assigned, setAssigned] = useState<AssignedProject | null | 'denied'>(null);
  const [substages, setSubstages] = useState<ProjectSubstageRow[]>([]);
  const [documents, setDocuments] = useState<ProjectDocumentRow[]>([]);
  const [rework, setRework] = useState<ReworkItem[]>([]);
  const [payments, setPayments] = useState<{ rows: ContractorPayment[]; available: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>('work');

  const load = useCallback(async () => {
    if (!projectId) return;
    // A project that is not yours returns no row under RLS — the same answer as one that
    // does not exist, which is the answer it should get.
    const a = await fetchAssignedProject(projectId).catch(() => null);
    if (!a) { setAssigned('denied'); return; }
    setAssigned(a);
    const [subs, docs, rw, pay] = await Promise.all([
      fetchSubstages(projectId).catch(() => []),
      fetchProjectDocuments(projectId).catch(() => []),
      fetchRework([a]).catch(() => []),
      fetchMyPayments().catch(() => ({ rows: [], available: false })),
    ]);
    setSubstages(subs);
    setDocuments(docs);
    setRework(rw);
    setPayments({ ...pay, rows: pay.rows.filter(r => r.projectId === projectId) });
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const activeSubstages = useMemo(
    () => (assigned && assigned !== 'denied' && assigned.activeStage
      ? substages.filter(s => s.stage_id === assigned.activeStage!.id)
      : []),
    [assigned, substages],
  );

  if (assigned === null) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

  if (assigned === 'denied') {
    return (
      <div className="py-10">
        <Back />
        <p className="mt-4 rounded-xl border border-brand-border-grey bg-white px-4 py-3 text-sm text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
          {t('contractorProject.notYours')}
        </p>
      </div>
    );
  }

  const { project, stages, activeStage, completedStages, totalStages } = assigned;

  return (
    <div className="flex flex-col gap-5">
      <Back />

      <header>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{project.name}</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">
          {[project.city, project.country].filter(Boolean).join(', ')}
          {totalStages > 0 && ` · ${t('contractor.projects.stageOf', { n: completedStages, total: totalStages })}`}
        </p>
      </header>

      {/* What a reviewer sent back sits above everything: it is the work. */}
      {rework.length > 0 && (
        <section className="rounded-2xl border border-state-held/40 bg-state-held/10 p-5">
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
            {t('contractor.needsAction.title')}
          </h2>
          <ul className="mt-2 flex flex-col gap-3">
            {rework.map(r => (
              <li key={r.stageId}>
                <p className="text-sm font-semibold text-brand-near-black dark:text-white">
                  {t('contractor.needsAction.stage', { n: r.stageNumber })} · {r.stageName}
                  <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-state-held">
                    {t(r.decision === 'rejected'
                      ? 'contractor.decision.rejected'
                      : 'contractor.decision.needsMoreEvidence')}
                  </span>
                </p>
                {r.findings && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-brand-near-black dark:text-white">{r.findings}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="flex gap-1 border-b border-brand-border-grey dark:border-[#2c2c2c]">
        {TABS.map(x => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)}
                  className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    tab === x.id
                      ? 'border-brand-near-black text-brand-near-black dark:border-white dark:text-white'
                      : 'border-transparent text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white')}>
            {t(x.key)}
          </button>
        ))}
      </nav>

      {tab === 'work' && (
        <>
          {/* The stage ladder, read from the real lifecycle. No control to advance it:
              completing a stage is not the contractor's to do. */}
          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="mb-3 text-sm font-semibold text-brand-near-black dark:text-white">
              {t('contractorProject.pipeline')}
            </h2>
            {stages.length === 0 ? (
              <p className="text-sm text-brand-mid-grey">{t('contractor.projects.noStages')}</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {stages.map(s => (
                  <li key={s.id} className={cn('flex items-center gap-3 rounded-lg px-3 py-2',
                    s.id === activeStage?.id && 'bg-brand-off-white dark:bg-[#2c2c2c]')}>
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                      s.status === 'complete' ? 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black'
                      : s.id === activeStage?.id ? 'border-2 border-brand-near-black text-brand-near-black dark:border-white dark:text-white'
                      : 'bg-brand-off-white text-brand-mid-grey dark:bg-[#2c2c2c]')}>
                      {s.status === 'complete' ? <Check className="size-3" />
                        : s.status === 'locked' ? <Lock className="size-3" />
                        : s.stage_number}
                    </span>
                    <span className={cn('flex-1 text-sm',
                      s.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white')}>
                      {stageLabel(s)}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-brand-mid-grey">
                      {t(`contractorStageStatus.${s.status}` as TKey)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {activeStage
            ? <SubmitWork projectId={project.id} stage={activeStage} substages={activeSubstages}
                          substageLabel={substageLabel} onSubmitted={load} />
            : (
              <section className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-10 text-center">
                <p className="text-sm font-medium text-brand-near-black dark:text-white">
                  {t('contractorProject.noActiveStage')}
                </p>
                <p className="mt-1 text-xs text-brand-mid-grey">{t('contractorProject.noActiveStageBody')}</p>
              </section>
            )}
        </>
      )}

      {tab === 'documents' && (
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="mb-3 text-sm font-semibold text-brand-near-black dark:text-white">
            {t('contractorProject.tabDocuments')}
          </h2>
          {documents.length === 0 ? (
            <p className="text-sm text-brand-mid-grey">{t('contractorProject.noDocuments')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {documents.map(d => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-brand-mid-grey" />
                  <span className="min-w-0 flex-1 truncate text-sm text-brand-near-black dark:text-white">
                    {d.file_name}
                  </span>
                  <span className="shrink-0 text-[11px] text-brand-mid-grey tabular-nums">
                    {d.file_size ? `${Math.round(d.file_size / 1024)} KB` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'payments' && (
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
            {t('contractorProject.tabPayments')}
          </h2>
          {/* Observation only. Groundwork records and governs; a licensed payment
              provider holds and moves the money. No confirm/authorise/reconcile here. */}
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('contractorPayments.note')}</p>

          {payments === null ? (
            <p className="py-6 text-sm text-brand-mid-grey">{t('common.loading')}</p>
          ) : !payments.available ? (
            <p className="py-6 text-sm text-brand-mid-grey">{t('contractorPayments.unavailable')}</p>
          ) : payments.rows.length === 0 ? (
            <p className="py-6 text-sm text-brand-mid-grey">{t('contractorPayments.none')}</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {payments.rows.map(p => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-brand-near-black dark:text-white">
                    {p.note ?? t('contractorPayments.milestone')}
                  </span>
                  <span className="text-sm tabular-nums text-brand-near-black dark:text-white">
                    {p.currency} {p.amount.toLocaleString()}
                  </span>
                  <span className="rounded-full bg-brand-off-white px-2.5 py-1 text-[11px] font-medium text-brand-near-black dark:bg-[#2c2c2c] dark:text-white">
                    {p.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Back() {
  const t = useT();
  return (
    <Link to="/work/projects"
          className="inline-flex items-center gap-1.5 text-sm text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
      <ArrowLeft className="size-3.5" /> {t('contractorProject.back')}
    </Link>
  );
}

/**
 * Report work on the active stage.
 *
 * The upload goes to the private `evidence` bucket and `submit_site_update` records it —
 * see contractor-work.ts for why that order matters. The file is checked here first, so a
 * refusal arrives before anything is uploaded rather than after.
 */
function SubmitWork({ projectId, stage, substages, substageLabel, onSubmitted }: {
  projectId: string;
  stage: { id: string; status: string };
  substages: ProjectSubstageRow[];
  substageLabel: (s: Pick<ProjectSubstageRow, 'substage_key' | 'name'>) => string;
  onSubmitted: () => Promise<void> | void;
}) {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [substageId, setSubstageId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // submit_site_update refuses a stage that is not active or under review; offering the
  // form anyway would be offering a control the database will reject.
  const open = stage.status === 'active' || stage.status === 'pending_review';

  async function submit() {
    setError(null); setBusy(true);
    try {
      await submitSiteUpdate({
        projectId, stageId: stage.id,
        substageId: substageId || null,
        description: description.trim() || null,
        files,
        // Idempotency: a retry on a bad site connection returns the same row rather than
        // appending the same photos twice.
        clientRef: crypto.randomUUID(),
      });
      setFiles([]); setDescription(''); setSubstageId(''); setDone(true);
      await onSubmitted();
    } catch (err) {
      setError(errorMessage(err, t('contractorSubmit.failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('contractorSubmit.title')}</h2>
      <p className="mt-0.5 text-xs text-brand-mid-grey">{t('contractorSubmit.subtitle')}</p>

      {substages.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {substages.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <span className={cn('flex size-4 items-center justify-center rounded border',
                s.status === 'complete'
                  ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                  : 'border-brand-border-grey')}>
                {s.status === 'complete' && <Check className="size-2.5" />}
              </span>
              <span className={s.status === 'complete' ? 'text-brand-mid-grey line-through' : 'text-brand-near-black dark:text-white'}>
                {substageLabel(s)}
              </span>
              {s.evidence_urls.length > 0 && (
                <span className="text-[11px] text-brand-mid-grey">
                  {t('contractorSubmit.photoCount', { n: s.evidence_urls.length })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <p className="mt-4 text-sm text-brand-mid-grey">{t('contractorSubmit.closed')}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {substages.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-brand-mid-grey">{t('contractorSubmit.whichItem')}</span>
              <select value={substageId} onChange={e => setSubstageId(e.target.value)}
                      className="h-9 w-full rounded-lg border border-brand-border-grey bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white">
                <option value="">{t('contractorSubmit.wholeStage')}</option>
                {substages.map(s => <option key={s.id} value={s.id}>{substageLabel(s)}</option>)}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-brand-mid-grey">{t('contractorSubmit.notes')}</span>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                      className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white" />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-brand-mid-grey">
              {t('contractorSubmit.files', { mb: MAX_FILE_MB })}
            </span>
            <input type="file" multiple accept={FILE_ACCEPT_ATTR}
                   onChange={e => {
                     const picked = Array.from(e.target.files ?? []);
                     e.target.value = '';
                     const bad = picked.find(f => fileProblem(f));
                     if (bad) {
                       setError(t(fileProblem(bad) === 'size'
                         ? 'project.documents.tooLarge' : 'project.documents.badType', { mb: MAX_FILE_MB }));
                       return;
                     }
                     setError(null); setDone(false);
                     setFiles(prev => [...prev, ...picked]);
                   }}
                   className="block w-full text-sm text-brand-mid-grey file:mr-3 file:rounded-lg file:border file:border-brand-border-grey file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-brand-near-black dark:file:bg-[#141414] dark:file:text-white" />
          </label>

          {files.length > 0 && (
            <ul className="flex flex-col gap-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs text-brand-mid-grey">
                  <span className="truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          className="shrink-0 underline underline-offset-2">{t('common.remove')}</button>
                </li>
              ))}
            </ul>
          )}

          {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
          {done && !error && <p role="status" className="text-xs text-state-complete">{t('contractorSubmit.sent')}</p>}

          <button type="button" disabled={busy || (files.length === 0 && !description.trim())}
                  onClick={submit}
                  className="inline-flex w-fit items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {busy ? t('contractorSubmit.sending') : t('contractorSubmit.cta')}
          </button>
        </div>
      )}
    </section>
  );
}
