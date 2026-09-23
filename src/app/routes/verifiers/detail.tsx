import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, FileText, ImageIcon, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { loadVerification, signedFileUrl, type VerifierWorkDetail } from '@/lib/supabase/verifier-work';
import { recordVerification } from '@/lib/supabase/verifications';
import { formatDateTime, formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /verifiers/:id — one verification, and the one act a verifier may perform (06 §22).
//
// ── What is here ─────────────────────────────────────────────────────────────────────
// The project and stage, the work items claimed, the evidence photographs, the project's
// documents — everything needed to judge whether the stage is what it is said to be —
// and then the finding: verified, rejected, or more evidence needed.
//
// ── What is deliberately NOT here ────────────────────────────────────────────────────
// No approval, no rework, no assignment, no financials, no client management. Those are
// the operator's, and the database agrees: `approve_stage`, `request_rework`,
// `assign_verifier` and `request_verification` all refuse a non-admin. The verifier
// records what they found; Groundwork decides what to do about it.
//
// ── Isolation ────────────────────────────────────────────────────────────────────────
// The id in the URL proves nothing: the row is fetched with `verifier_id = me`, and RLS
// would refuse it anyway for a project this person is not a member of. A guessed id
// renders "not assigned to you", not somebody else's site.
// =========================================================

const DECISIONS = ['verified', 'rejected', 'needs_more_evidence'] as const;
type Decision = typeof DECISIONS[number];

export default function VerificationDetail() {
  const t = useT();
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [work, setWork] = useState<VerifierWorkDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !id) return;
    try {
      setWork(await loadVerification(id, user.id));
      setError(null);
    } catch (err) {
      setWork(null); setError(errorMessage(err, t('common.somethingWrong')));
    }
  }, [id, user, t]);
  useEffect(() => { load(); }, [load]);

  if (work === undefined) {
    return <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>;
  }
  if (work === null) {
    return (
      <div className="space-y-3">
        <Back />
        <div className="rounded-2xl border border-brand-border-grey bg-[#ffffff] px-5 py-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('verifier.detail.notFound')}</p>
          <p className="mt-1 text-xs text-brand-mid-grey">{error ?? t('verifier.detail.notFoundBody')}</p>
        </div>
      </div>
    );
  }

  const decided = work.decision !== 'pending';

  return (
    <div className="space-y-5">
      <Back />

      <header className="rounded-2xl border border-brand-border-grey bg-[#ffffff] px-5 py-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{work.projectName}</h1>
        <p className="mt-0.5 text-xs text-brand-mid-grey">
          {t('verifier.work.stage', { n: work.stageNumber })} · {work.stageName}
          {(work.projectCity || work.projectCountry) && ` · ${[work.projectCity, work.projectCountry].filter(Boolean).join(', ')}`}
        </p>
        <p className="mt-1 text-[11px] text-brand-mid-grey">
          {t('verifier.detail.requested', { when: formatRelative(work.requestedAt) })}
          {' · '}{t(`verifier.decision.${work.decision}` as TKey)}
          {work.decidedAt && ` · ${t('verifier.detail.recordedOn', { when: formatRelative(work.decidedAt) })}`}
        </p>
      </header>

      <Panel title={t('verifier.detail.substages')}>
        {work.substages.length === 0 ? (
          <p className="px-5 py-5 text-center text-xs text-brand-mid-grey">{t('verifier.detail.noSubstages')}</p>
        ) : (
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {work.substages.map(s => (
              <li key={s.id} className="px-5 py-3">
                <p className="text-sm text-brand-near-black dark:text-white">{s.name}</p>
                <p className="mt-0.5 text-[11px] text-brand-mid-grey">{s.status}{s.evidence.length > 0 && ` · ${s.evidence.length}`}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('verifier.detail.evidence')}>
        <FileList bucket="evidence" paths={work.substages.flatMap(s => s.evidence)} emptyText={t('verifier.detail.noEvidence')} />
      </Panel>

      <Panel title={t('verifier.detail.documents')}>
        <FileList bucket="documents" paths={work.documents.map(d => d.path)} names={work.documents.map(d => d.name)} emptyText={t('verifier.detail.noDocuments')} />
      </Panel>

      {decided ? (
        <Panel title={t('verifier.detail.recordTitle')}>
          <div className="px-5 py-4">
            <p className="text-sm text-brand-near-black dark:text-white">{t(`verifier.decision.${work.decision}` as TKey)}</p>
            {work.findings && <p className="mt-1 whitespace-pre-wrap text-xs text-brand-near-black dark:text-white">{work.findings}</p>}
            {work.visitedAt && <p className="mt-1 text-[11px] text-brand-mid-grey">{formatDateTime(work.visitedAt)}</p>}
            <p className="mt-2 text-[11px] text-brand-mid-grey">{t('verifier.detail.alreadyDecided')}</p>
          </div>
        </Panel>
      ) : (
        <RecordFinding verificationId={work.id} onRecorded={load} />
      )}
    </div>
  );
}

function Back() {
  const t = useT();
  return (
    <Link to="/verifiers" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
      <ArrowLeft className="size-3.5" />{t('verifier.detail.back')}
    </Link>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-[#ffffff] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{title}</h2>
      </header>
      {children}
    </section>
  );
}

/**
 * Private files, opened one at a time through a signed URL that expires. There is no
 * public URL for these buckets: the link is minted on click, for this reader, from the
 * member policies in 092 — so a link copied out of the page stops working, and a person
 * who is no longer assigned cannot mint one at all.
 */
function FileList({ bucket, paths, names, emptyText }: {
  bucket: 'evidence' | 'documents'; paths: string[]; names?: string[]; emptyText: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const open = async (path: string) => {
    setBusy(path); setFailed(null);
    const url = await signedFileUrl(bucket, path);
    setBusy(null);
    if (!url) { setFailed(path); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (paths.length === 0) return <p className="px-5 py-5 text-center text-xs text-brand-mid-grey">{emptyText}</p>;

  return (
    <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
      {paths.map((path, i) => (
        <li key={`${path}-${i}`} className="flex items-center gap-3 px-5 py-2.5">
          {bucket === 'evidence' ? <ImageIcon className="size-3.5 shrink-0 text-brand-muted-grey" /> : <FileText className="size-3.5 shrink-0 text-brand-muted-grey" />}
          <span className="min-w-0 flex-1 truncate text-xs text-brand-near-black dark:text-white">{names?.[i] || path.split('/').pop()}</span>
          <button type="button" onClick={() => open(path)} disabled={busy === path}
            className="shrink-0 rounded-lg border border-brand-border-grey px-2.5 py-1 text-[11px] font-semibold text-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white">
            {busy === path ? <Loader2 className="size-3 animate-spin" /> : t('verifier.detail.openFile')}
          </button>
          {failed === path && <span role="alert" className="text-[11px] text-state-alert">{t('verifier.detail.fileUnavailable')}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * The finding. `verified` requires a visit date because the database requires it (087);
 * the field is required here for usability, and the refusal below is still the
 * authority. After a successful write the verification is re-read — the row as stored is
 * what the screen then shows, never an assumed success.
 */
function RecordFinding({ verificationId, onRecorded }: { verificationId: string; onRecorded: () => void }) {
  const t = useT();
  const [decision, setDecision] = useState<Decision>('verified');
  const [visitedAt, setVisitedAt] = useState('');
  const [findings, setFindings] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsVisit = decision === 'verified';

  async function submit() {
    setBusy(true); setError(null);
    try {
      await recordVerification({
        verificationId,
        decision,
        findings: findings.trim() || undefined,
        visitedAt: visitedAt ? new Date(visitedAt).toISOString() : undefined,
      });
      onRecorded();
    } catch (err) {
      const msg = errorMessage(err, '');
      setError(msg.includes('visit_required') ? t('verifier.detail.visitRequired') : msg || t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-[#ffffff] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('verifier.detail.recordTitle')}</h2>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('verifier.detail.recordSub')}</p>
      </header>

      <div className="space-y-3 px-5 py-4">
        <div>
          <p className="text-[11px] text-brand-mid-grey">{t('verifier.detail.decisionLabel')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {DECISIONS.map(d => (
              <button key={d} type="button" onClick={() => setDecision(d)} aria-pressed={decision === d}
                className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                  decision === d
                    ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                    : 'border-brand-border-grey text-brand-near-black dark:border-[#2c2c2c] dark:text-white')}>
                {t(`verifier.decision.${d}` as TKey)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="visited-at" className="text-[11px] text-brand-mid-grey">{t('verifier.detail.visitLabel')}</label>
          <input id="visited-at" type="date" value={visitedAt} onChange={e => setVisitedAt(e.target.value)} required={needsVisit}
            className="mt-1 block rounded-lg border border-brand-border-grey bg-[#ffffff] px-3 py-1.5 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white" />
          {needsVisit && !visitedAt && <p className="mt-1 text-[11px] text-brand-mid-grey">{t('verifier.detail.visitRequired')}</p>}
        </div>

        <div>
          <label htmlFor="findings" className="text-[11px] text-brand-mid-grey">{t('verifier.detail.findingsLabel')}</label>
          <textarea id="findings" rows={3} value={findings} onChange={e => setFindings(e.target.value)} placeholder={t('verifier.detail.findingsHint')}
            className="mt-1 w-full rounded-lg border border-brand-border-grey bg-[#ffffff] px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit} disabled={busy || (needsVisit && !visitedAt)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
            {busy && <Loader2 className="size-3.5 animate-spin" />}{t('verifier.detail.submit')}
          </button>
          {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}
