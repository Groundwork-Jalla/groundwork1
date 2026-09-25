import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, FileText, ImageIcon, Loader2, MapPin, ArrowUpRight, Layers, CalendarDays, ClipboardCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { loadVerification, signedFileUrl, type VerifierWorkDetail } from '@/lib/supabase/verifier-work';
import { recordVerification } from '@/lib/supabase/verifications';
import { errorMessage } from '@/lib/errors';
import { useFormat, useT, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { cn } from '@/lib/utils';

const DECISIONS = ['verified', 'rejected', 'needs_more_evidence'] as const;
type Decision = typeof DECISIONS[number];
const field = 'w-full rounded-lg border border-brand-border-grey bg-[#ffffff] px-3 py-2 text-sm text-brand-near-black focus:outline-none focus:ring-2 focus:ring-brand-mid-grey dark:border-[#444] dark:bg-[#1e1e1e] dark:text-white';

/** Shared by the dashboard and the direct URL. Every load still checks the viewer's id. */
export function VerificationWorkspace({ verificationId: id, onRecorded, history }: {
  verificationId: string;
  onRecorded?: () => Promise<void> | void;
  history?: ReactNode;
}) {
  const t = useT();
  const f = useFormat();
  const { user } = useAuth();
  const { stageLabel } = useStageLabels();
  const [work, setWork] = useState<VerifierWorkDetail | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    if (!user) return;
    const version = ++request.current;
    try {
      const result = await loadVerification(id, user.id);
      if (version !== request.current) return;
      setWork(result); setError(null);
    } catch (err) {
      if (version !== request.current) return;
      setWork(null); setError(err);
    }
  }, [id, user?.id]);
  useEffect(() => {
    setWork(undefined);
    void load();
    return () => { request.current++; };
  }, [load]);

  if (work === undefined) return <p role="status" className="flex items-center gap-2 py-8 text-xs text-brand-mid-grey"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</p>;
  if (work === null) return <Panel title={t('verifier.detail.notFound')}>
    <div className="p-5">
      <p role={error ? 'alert' : undefined} className="text-sm text-brand-mid-grey">{error ? errorMessage(error, t('common.somethingWrong')) : t('verifier.detail.notFoundBody')}</p>
      {error != null && <button type="button" onClick={() => void load()} className="mt-3 text-xs underline">{t('verifier.dashboard.retry')}</button>}
    </div>
  </Panel>;

  const decided = work.decision !== 'pending';
  const stageName = stageLabel({ name: work.stageName, stage_key: work.stageKey });
  const refresh = async () => { await load(); await onRecorded?.(); };
  return <div className="space-y-5 text-brand-near-black dark:text-white">
    <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_1fr_1.25fr]">
      <Panel title={t('verifier.dashboard.context')} icon={<FileText className="size-4" />}>
        <div className="space-y-4 p-5">
          <div><h3 className="text-base font-semibold">{work.projectName}</h3><p className="mt-1 text-xs text-brand-mid-grey">{t('verifier.work.stage', { n: work.stageNumber })} · {stageName}</p></div>
          <p className="flex items-start gap-2 text-xs text-brand-mid-grey"><MapPin className="size-4 shrink-0" />{[work.projectCity, work.projectCountry].filter(Boolean).join(', ') || '—'}</p>
          <p className="text-xs text-brand-mid-grey">{t('verifier.detail.requested', { when: f.relative(work.requestedAt) })}</p>
          <p className="break-all text-[10px] text-brand-mid-grey">{t('verifier.dashboard.reference')}: {work.id}</p>
          <Link to={`/verifiers/${work.id}`} className="inline-flex items-center gap-2 rounded-lg border border-brand-border-grey px-3 py-2 text-xs font-semibold dark:border-[#444]">{t('verifier.dashboard.openReview')}<ArrowUpRight className="size-3" /></Link>
        </div>
      </Panel>
      <Panel title={t('verifier.dashboard.stageReview')} icon={<Layers className="size-4" />}>
        <div className="p-5">
          <h3 className="text-sm font-semibold">{stageName}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-brand-mid-grey">{t('verifier.dashboard.checklistHint')}</p>
          {work.substages.length === 0 ? <p className="mt-4 text-xs text-brand-mid-grey">{t('verifier.detail.noSubstages')}</p> : <ul className="mt-4 max-h-52 space-y-3 overflow-y-auto">
            {work.substages.map(s => <li key={s.id} className="flex items-start gap-2 text-xs">
              <span aria-label={s.status === 'complete' ? t('status.complete') : t('status.inProgress')} className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', s.status === 'complete' ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black' : 'border-brand-border-grey dark:border-[#555]')}>
                {s.status === 'complete' && <Check className="size-3" />}
              </span>
              <span className="leading-relaxed">{s.name}{s.evidence.length > 0 && <span className="ml-1 text-brand-mid-grey">({s.evidence.length})</span>}</span>
            </li>)}
          </ul>}
        </div>
      </Panel>
      <EvidenceFiles key={work.id} work={work} />
    </div>
    <div className={cn('grid min-w-0 gap-5', history && 'xl:grid-cols-[2fr_1fr]')}>
      {decided ? <Panel title={t('verifier.detail.recordTitle')} icon={<ClipboardCheck className="size-4" />}>
        <div className="space-y-3 p-5">
          <p className="text-sm font-semibold">{t(`verifier.decision.${work.decision}` as TKey)}</p>
          {work.findings && <p className="whitespace-pre-wrap break-words text-sm">{work.findings}</p>}
          <p className="text-xs text-brand-mid-grey">{t('verifier.dashboard.siteVisit')}: {work.visitedAt ? f.date(work.visitedAt) : t('verifier.dashboard.noVisit')}</p>
          {work.decidedAt && <p className="text-xs text-brand-mid-grey">{t('verifier.detail.recordedOn', { when: f.dateTime(work.decidedAt) })}</p>}
          <p className="text-xs text-brand-mid-grey">{t('verifier.detail.alreadyDecided')}</p>
        </div>
      </Panel> : <RecordFinding key={work.id} verificationId={work.id} initialVisit={work.visitedAt} onRecorded={refresh} />}
      {history}
    </div>
  </div>;
}

export function Panel({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-brand-border-grey bg-[#ffffff] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
    <header className="flex items-center gap-2 border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">{icon}<h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{title}</h2></header>
    {children}
  </section>;
}

function EvidenceFiles({ work }: { work: VerifierWorkDetail }) {
  const t = useT();
  const [tab, setTab] = useState<'evidence' | 'documents'>('evidence');
  const paths = [...new Set(work.substages.flatMap(s => s.evidence))];
  return <Panel title={t('verifier.dashboard.workspace')} icon={<ImageIcon className="size-4" />}>
    <div className="flex gap-1 border-b border-brand-border-grey px-3 dark:border-[#2c2c2c]">
      {(['evidence', 'documents'] as const).map(key => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={cn('border-b-2 px-2 py-3 text-[11px] font-medium', tab === key ? 'border-brand-near-black text-brand-near-black dark:border-white dark:text-white' : 'border-transparent text-brand-mid-grey')}>
        {t(`verifier.detail.${key}`)} ({key === 'evidence' ? paths.length : work.documents.length})
      </button>)}
    </div>
    <FileList key={`${work.id}:${tab}`} bucket={tab} paths={tab === 'evidence' ? paths : work.documents.map(d => d.path)} names={tab === 'documents' ? work.documents.map(d => d.name) : undefined} emptyText={t(tab === 'evidence' ? 'verifier.detail.noEvidence' : 'verifier.detail.noDocuments')} />
  </Panel>;
}

function FileList({ bucket, paths, names, emptyText }: {
  bucket: 'evidence' | 'documents'; paths: string[]; names?: string[]; emptyText: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [fallback, setFallback] = useState<{ path: string; url: string } | null>(null);
  const open = async (path: string) => {
    // Reserve a tab during the click; signing happens asynchronously.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setBusy(path); setFailed(null); setFallback(null);
    try {
      const url = await signedFileUrl(bucket, path);
      if (!url) { tab?.close(); setFailed(path); return; }
      if (tab) tab.location.replace(url);
      else setFallback({ path, url });
    } catch { tab?.close(); setFailed(path); }
    finally { setBusy(null); }
  };
  if (paths.length === 0) return <p className="px-5 py-8 text-xs text-brand-mid-grey">{emptyText}</p>;
  return <ul className="max-h-64 divide-y divide-brand-border-grey overflow-y-auto dark:divide-[#2c2c2c]">
    {paths.map((path, i) => <li key={`${path}-${i}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-off-white text-brand-mid-grey dark:bg-[#292929]">{bucket === 'evidence' ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}</span>
      <span className="min-w-0 flex-1 truncate text-xs" title={names?.[i] || path.split('/').pop()}>{names?.[i] || path.split('/').pop()}</span>
      {fallback?.path === path ? <a href={fallback.url} target="_blank" rel="noopener noreferrer" className="text-xs underline">{t('verifier.detail.openFile')}</a> : <button type="button" onClick={() => void open(path)} disabled={busy !== null} aria-label={`${t('verifier.detail.openFile')} ${names?.[i] || path.split('/').pop()}`} className="rounded-lg border border-brand-border-grey px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40 dark:border-[#444]">
        {busy === path ? <Loader2 className="size-3 animate-spin" /> : t('verifier.detail.openFile')}
      </button>}
      {failed === path && <span role="alert" className="w-full text-[11px] text-state-alert">{t('verifier.detail.fileUnavailable')}</span>}
    </li>)}
  </ul>;
}

function RecordFinding({ verificationId, initialVisit, onRecorded }: {
  verificationId: string; initialVisit: string | null; onRecorded: () => Promise<void>;
}) {
  const t = useT();
  const [decision, setDecision] = useState<Decision>('verified');
  const [visitedAt, setVisitedAt] = useState(initialVisit?.slice(0, 10) ?? '');
  const [findings, setFindings] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsVisit = decision === 'verified';
  async function submit() {
    setBusy(true); setError(null);
    try {
      await recordVerification({
        verificationId, decision,
        findings: findings.trim(),
        visitedAt: visitedAt ? new Date(visitedAt).toISOString() : undefined,
      });
      await onRecorded();
    } catch (err) {
      const msg = errorMessage(err, '');
      setError(msg.includes('visit_required') ? t('verifier.detail.visitRequired') : msg || t('common.somethingWrong'));
    } finally { setBusy(false); }
  }
  return <form onSubmit={e => { e.preventDefault(); if (!busy && findings.trim() && (!needsVisit || visitedAt)) void submit(); }} className="grid min-w-0 gap-5 md:grid-cols-[1fr_1.5fr]">
    <Panel title={t('verifier.dashboard.siteVisit')} icon={<CalendarDays className="size-4" />}>
      <div className="space-y-3 p-5">
        <label className="block text-xs text-brand-mid-grey" htmlFor="visited-at">{t('verifier.detail.visitLabel')}</label>
        <input id="visited-at" type="date" value={visitedAt} onChange={e => setVisitedAt(e.target.value)} required={needsVisit} disabled={busy} className={field} />
        <p className="text-[11px] leading-relaxed text-brand-mid-grey">{t('verifier.dashboard.siteVisitHint')}</p>
        {needsVisit && !visitedAt && <p className="text-[11px] text-brand-mid-grey">{t('verifier.detail.visitRequired')}</p>}
      </div>
    </Panel>
    <Panel title={t('verifier.detail.recordTitle')} icon={<ClipboardCheck className="size-4" />}>
      <div className="space-y-4 p-5">
        <fieldset disabled={busy}>
          <legend className="text-xs text-brand-mid-grey">{t('verifier.detail.decisionLabel')}</legend>
          <div className="mt-2 space-y-2">
            {DECISIONS.map(d => <label key={d} className="flex items-center gap-2 text-xs"><input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="accent-brand-near-black" />{t(`verifier.decision.${d}` as TKey)}</label>)}
          </div>
        </fieldset>
        <div>
          <label htmlFor="findings" className="text-xs text-brand-mid-grey">{t('verifier.dashboard.findings')}</label>
          <textarea id="findings" rows={3} required disabled={busy} value={findings} onChange={e => setFindings(e.target.value)} placeholder={t('verifier.detail.findingsHint')} className={`mt-1 ${field}`} />
        </div>
        <button type="submit" disabled={busy || (needsVisit && !visitedAt) || !findings.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-near-black px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
          {busy && <Loader2 className="size-3.5 animate-spin" />}{t('verifier.detail.submit')}
        </button>
        {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
      </div>
    </Panel>
  </form>;
}
