import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import type { StageView, Workspace } from '@/lib/admin/workspace';
import { nameLookup, selectedStage } from '@/lib/admin/workspace-params';
import { stageActions, type StageAction, type StageActionKind } from '@/lib/admin/stage-actions';
import { BLOCKER_LABEL } from '@/lib/admin/lifecycle-badge';
import { requestVerification, recordVerification, type VerificationDecision } from '@/lib/supabase/verifications';
import { adminApproveStage, adminRequestRework } from '@/lib/supabase/approvals';
import { LedgerModal, type Contractor, type LedgerModalState, type StageRef } from '@/components/admin/ledger/LedgerModal';
import { RecordVerificationModal } from '@/components/admin/stages/RecordVerificationModal';
import { ReworkModal } from '@/components/admin/stages/ReworkModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { StageLadder } from './StageLadder';
import { StageLifecycleBadge } from './StageLifecycleBadge';
import { EvidenceList } from './EvidenceList';
import { DomainNote } from './DomainNote';
import { useAuth } from '@/contexts/AuthContext';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { formatUSDFull } from '@/lib/budget';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Stages tab — the operational control surface (05 §6, §7).
//
// Left: the ladder, every stage by its derived state. Right: the selected stage read as
// the loop the product is built around —
//
//   Work → Evidence → Verification → Approval → Funding → Release
//
// — each step showing what the record holds and nothing more: no evidence means "no
// evidence", not a placeholder; verification not requested says so; approved-but-unfunded
// says awaiting funding; no accepted contractor means release is unavailable with the
// database's own reason.
//
// THE MODEL SAYS WHAT IS TRUE; THE RPC DECIDES WHAT IS PERMITTED. `stageActions()` reads
// the assembled StageView and says which of the six existing acts to offer and why one is
// held; every button calls the existing SECURITY DEFINER boundary; on success the whole
// workspace is re-read (`onChanged`) — nothing is patched locally, no state is guessed.
// A refusal is shown as the database phrased it.
//
// Terminology: verification / verifier (14 Sep 2026 decision). Never "inspection".
// =========================================================

export function StagesTab({ loaded, stageId, onChanged }: { loaded: LoadedWorkspace; stageId: string | null; onChanged: () => void }) {
  const t = useT();
  const ws = loaded.workspace;
  const selected = selectedStage(ws, stageId);

  return (
    <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[18rem_minmax(0,1fr)] 2xl:p-8">
      <aside className="min-w-0 overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e] lg:self-start">
        {ws.stages.length === 0
          ? <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t('admin.workspace.overview.noSchedule')}</p>
          : <StageLadder projectId={ws.project.id} stages={ws.stages} selectedId={selected?.stage.id ?? null} tab="stages" />}
      </aside>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        {selected
          ? <StageDetail key={selected.stage.id} ws={ws} loaded={loaded} view={selected} onChanged={onChanged} />
          : <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t('admin.workspace.overview.noSchedule')}</p>}
      </section>
    </div>
  );
}

const ACTION_LABEL: Record<StageActionKind, TKey> = {
  request_verification: 'admin.verification.request',
  record_verification:  'admin.verification.recordDecision',
  approve:              'admin.workspace.stages.approve',
  rework:               'admin.requestChanges',
  confirm_funding:      'admin.ledger.confirmFunding',
  authorise_release:    'admin.ledger.authorise',
};

function StageDetail({ ws, loaded, view, onChanged }: { ws: Workspace; loaded: LoadedWorkspace; view: StageView; onChanged: () => void }) {
  const t = useT();
  const { user } = useAuth();
  const { stageLabel, substageLabel } = useStageLabels();
  const name = nameLookup(ws);
  const who = (id: string | null | undefined) => name(id) || t('admin.workspace.header.unknownAccount');

  const activeVerifiers = ws.team.verifiers.filter(v => v.status === 'active');
  const contractors: Contractor[] = ws.team.contractors
    .filter(c => c.status === 'accepted' && c.contractor_user_id)
    .map(c => ({ userId: c.contractor_user_id as string, email: c.email }));
  const actions = stageActions(view, {
    activeVerifiers: activeVerifiers.length,
    contractors: contractors.length,
    verificationsAvailable: ws.available.verifications,
    ledgerAvailable: ws.available.ledger,
  });
  const action = (k: StageActionKind) => actions.find(a => a.kind === k) as StageAction;

  // ── Act state ─────────────────────────────────────────────────────────────────────
  const [busy, setBusy]       = useState<StageActionKind | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [picker, setPicker]   = useState(false);
  const [verifier, setVerifier] = useState('');
  const [showRecord, setShowRecord]   = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showRework, setShowRework]   = useState(false);
  const [ledger, setLedger]           = useState<LedgerModalState>(null);

  /** Run one existing act; on success re-read the model. A refusal is shown as phrased. */
  async function run(kind: StageActionKind, fn: () => Promise<unknown>) {
    setBusy(kind); setError(null);
    try {
      await fn();
      onChanged();
      return true;
    } catch (err) {
      const msg = errorMessage(err, '');
      setError(
        msg.includes('not_verified')    ? t('admin.verification.errNotVerified')
        : msg.includes('not_assigned')    ? t('admin.verification.errNotAssigned')
        : msg.includes('already_pending') ? t('admin.verification.errAlreadyPending')
        : msg || t('common.somethingWrong'),
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  const stageRef: StageRef = {
    id: view.stage.id, projectId: ws.project.id, stageNumber: view.stage.stage_number,
    name: stageLabel(view.stage), status: view.stage.status, milestone: view.stage.payment_milestone_usd,
  };
  const v = view.latestVerification;
  const evidencePaths = [...new Set([
    ...view.substages.flatMap(s => s.evidence_urls ?? []),
    ...view.siteUpdates.flatMap(u => u.evidencePaths),
  ])];
  const milestone = view.stage.payment_milestone_usd ?? 0;
  const decisionKey = (d: VerificationDecision) => `admin.workspace.stage.decision.${d}` as TKey;

  function onAction(kind: StageActionKind) {
    setError(null);
    switch (kind) {
      case 'request_verification': setPicker(p => !p); break;
      case 'record_verification':  setShowRecord(true); break;
      case 'approve':              setShowApprove(true); break;
      case 'rework':               setShowRework(true); break;
      case 'confirm_funding':      if (view.tranche) setLedger({ kind: 'confirm', payment: view.tranche }); break;
      case 'authorise_release':    setLedger({ kind: 'authorise', stage: stageRef }); break;
    }
  }

  const offered = actions.filter(a => a.offered);

  return (
    <div>
      {/* ── Head: what this stage is, its state, every blocker ───────────────────── */}
      <header className="border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-grey">{t('admin.workspace.stage.eyebrow', { n: view.stage.stage_number })}</p>
        <h2 className="mt-0.5 text-lg font-semibold text-brand-near-black dark:text-white">{stageLabel(view.stage)}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <StageLifecycleBadge lifecycle={view.lifecycle} showBlocker={false} />
          {view.lifecycle.blockers.filter(b => b !== 'on_hold').map(b => (
            <span key={b} className="text-xs text-brand-mid-grey first-letter:uppercase">{t(BLOCKER_LABEL[b])}</span>
          ))}
          {view.stage.completed_at && (
            <span className="text-xs text-brand-mid-grey">{t('admin.workspace.stages.approvedOn', { date: formatDate(view.stage.completed_at) })}</span>
          )}
        </div>

        {/* ── Action row: the acts this state admits, each live or held with its reason ── */}
        {offered.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {offered.map(a => (
                <button
                  key={a.kind}
                  type="button"
                  disabled={!a.enabled || busy !== null}
                  onClick={() => onAction(a.kind)}
                  title={a.reasonKey ? t(a.reasonKey) : undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    a.kind === 'approve' || a.kind === 'authorise_release'
                      ? 'bg-brand-near-black text-white hover:bg-black dark:bg-white dark:text-brand-near-black dark:hover:bg-white/90'
                      : 'border border-brand-border-grey text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white dark:hover:border-white',
                  )}
                >
                  {busy === a.kind && <Loader2 className="size-3.5 animate-spin" />}
                  {t(ACTION_LABEL[a.kind])}
                </button>
              ))}
            </div>
            {/* Every held act says why, in the database's words. */}
            {offered.filter(a => !a.enabled && a.reasonKey).map(a => (
              <p key={a.kind} className="text-[11px] text-brand-mid-grey">
                <span className="font-medium text-brand-near-black dark:text-white">{t(ACTION_LABEL[a.kind])}</span> — {t(a.reasonKey as TKey)}
              </p>
            ))}
            {picker && action('request_verification').enabled && (
              <div className="flex flex-wrap items-center gap-2">
                <select value={verifier} onChange={e => setVerifier(e.target.value)} aria-label={t('admin.verification.selectVerifier')}
                  className="rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 text-xs text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
                  <option value="">{t('admin.verification.selectVerifier')}</option>
                  {activeVerifiers.map(pv => <option key={pv.id} value={pv.userId}>{who(pv.userId)} — {pv.discipline}</option>)}
                </select>
                <button type="button" disabled={!verifier || busy !== null}
                  onClick={() => run('request_verification', () => requestVerification(view.stage.id, verifier)).then(ok => { if (ok) { setPicker(false); setVerifier(''); } })}
                  className="rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
                  {busy === 'request_verification' ? t('admin.verification.requesting') : t('admin.verification.request')}
                </button>
              </div>
            )}
            {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
          </div>
        )}
      </header>

      {/* ── The loop, step by step ───────────────────────────────────────────────── */}
      <ol className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
        {/* 1 · Work */}
        <Step n={1} title={t('admin.workspace.stages.work')}>
          {view.substages.length === 0 ? (
            <Muted>{t('admin.workspace.stage.substagesNone')}</Muted>
          ) : (
            <ul className="space-y-1.5">
              {view.substages.map(s => (
                <li key={s.id} className="flex items-center gap-2 text-xs">
                  <span className={cn('size-1.5 shrink-0 rounded-full',
                    s.status === 'complete' ? 'bg-state-complete' : s.status === 'pending_review' ? 'bg-state-held' : s.status === 'in_progress' ? 'bg-state-active' : 'bg-state-locked')} />
                  <span className="min-w-0 flex-1 truncate text-brand-near-black dark:text-white">{substageLabel(s)}</span>
                  <span className="shrink-0 text-[11px] text-brand-mid-grey">{t(`admin.workspace.stages.substage.${s.status}` as TKey)}</span>
                </li>
              ))}
            </ul>
          )}
        </Step>

        {/* 2 · Evidence */}
        <Step n={2} title={t('admin.workspace.stage.evidence')}>
          {!ws.available.siteUpdates && evidencePaths.length === 0 ? (
            <DomainNote state={loaded.errors.siteUpdates ? 'error' : 'unavailable'} reason={loaded.errors.siteUpdates} />
          ) : evidencePaths.length === 0 ? (
            <Muted>{t('admin.workspace.stage.evidenceNone')}</Muted>
          ) : (
            <>
              <EvidenceList paths={evidencePaths} />
              {view.siteUpdates.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {view.siteUpdates.map(u => (
                    <li key={u.id} className="text-[11px] text-brand-mid-grey">
                      <span className="text-brand-near-black dark:text-white">{who(u.submittedBy)}</span> · <span title={formatDateTime(u.submittedAt)}>{formatRelative(u.submittedAt)}</span>
                      {u.description && ` · ${u.description}`}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Step>

        {/* 3 · Verification */}
        <Step n={3} title={t('admin.workspace.stages.verification')}>
          {!ws.available.verifications ? (
            <DomainNote state={loaded.errors.verifications ? 'error' : 'unavailable'} reason={loaded.errors.verifications} />
          ) : view.stage.verification_required !== true ? (
            <Muted>{t('admin.verification.notRequired')}</Muted>
          ) : view.verifications.length === 0 ? (
            <Muted>{t('admin.workspace.stage.verificationNone')}</Muted>
          ) : (
            <ul className="space-y-3">
              {view.verifications.map(r => (
                <li key={r.id} className="text-xs">
                  <p className="text-brand-near-black dark:text-white">
                    <span className={cn('font-medium', r.decision === 'verified' ? 'text-state-complete' : r.decision === 'pending' ? 'text-state-held' : 'text-state-alert')}>
                      {t(decisionKey(r.decision))}
                    </span>
                    {' · '}{who(r.verifierId)}
                    {' · '}<span className="text-brand-mid-grey" title={formatDateTime(r.decidedAt ?? r.requestedAt)}>{formatRelative(r.decidedAt ?? r.requestedAt)}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                    {t('admin.workspace.stages.requestedBy', { name: who(r.requestedBy), when: formatRelative(r.requestedAt) })}
                    {' · '}{r.visitedAt ? t('admin.workspace.stage.visited', { date: formatDate(r.visitedAt) }) : t('admin.workspace.stage.notVisited')}
                    {r.certificateId && ` · ${t('admin.workspace.stage.certificate')}`}
                  </p>
                  {r.findings && <p className="mt-1 whitespace-pre-wrap text-[11px] text-brand-near-black dark:text-white">{r.findings}</p>}
                  {r.recordedOnBehalfOf && r.recordedBy && (
                    <p className="mt-0.5 text-[11px] italic text-brand-mid-grey">
                      {t('admin.verification.onBehalf', { admin: who(r.recordedBy), reason: r.reason ?? '' })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Step>

        {/* 4 · Approval */}
        <Step n={4} title={t('admin.workspace.stages.approval')}>
          <Muted>
            {view.stage.status === 'complete'
              ? t('admin.workspace.stages.approvedOn', { date: formatDate(view.stage.completed_at) })
              : view.stage.status === 'pending_review'
                ? (action('approve').enabled ? t('admin.workspace.stages.readyToApprove') : t('admin.verification.approveBlocked'))
                : view.stage.status === 'active' ? t('admin.workspace.stages.notSubmitted') : t('admin.workspace.stages.lockedStep')}
          </Muted>
        </Step>

        {/* 5 · Funding */}
        <Step n={5} title={t('admin.workspace.stage.tranche')}>
          {!ws.available.ledger ? (
            <DomainNote state={loaded.errors.ledger ? 'error' : 'unavailable'} reason={loaded.errors.ledger} />
          ) : milestone <= 0 ? (
            <Muted>{t('admin.workspace.stage.milestoneNone')}</Muted>
          ) : (
            <p className="text-xs text-brand-near-black dark:text-white">
              <span className="font-semibold tabular-nums">{formatUSDFull(milestone)}</span>
              <span className="text-brand-mid-grey"> · {view.tranche ? t(`admin.ledger.state.${view.tranche.state}` as TKey) : t('admin.workspace.stages.noTranche')}</span>
              {view.tranche?.fundingSource === 'staff_confirmed' && (
                <span className="text-brand-mid-grey"> · {t('admin.ledger.source.staff_confirmed', { name: who(view.tranche.confirmedBy), when: formatRelative(view.tranche.confirmedAt) })}</span>
              )}
              {view.tranche?.fundingSource === 'provider' && (
                <span className="text-brand-mid-grey"> · {t('admin.ledger.source.provider', { when: formatRelative(view.tranche.settledAt ?? view.tranche.updatedAt) })}</span>
              )}
            </p>
          )}
        </Step>

        {/* 6 · Release */}
        <Step n={6} title={t('admin.workspace.stage.release')}>
          {!ws.available.ledger ? (
            <DomainNote state={loaded.errors.ledger ? 'error' : 'unavailable'} reason={loaded.errors.ledger} />
          ) : view.release ? (
            <p className="text-xs text-brand-near-black dark:text-white">
              <span className="font-semibold tabular-nums">{formatUSDFull(view.release.amount)}</span>
              <span className={cn(' · ', view.release.state === 'failed' ? 'text-state-alert' : 'text-brand-mid-grey')}> · {t(`admin.ledger.state.${view.release.state}` as TKey)}</span>
              <span className="text-brand-mid-grey"> · {t('admin.ledger.to', { name: who(view.release.beneficiaryId) })}</span>
              <span className="text-brand-mid-grey"> · {t('admin.ledger.releasedBy', { name: who(view.release.authorisedBy), when: formatRelative(view.release.authorisedAt) })}</span>
              {view.release.failureReason && <span className="text-state-alert"> · {view.release.failureReason}</span>}
            </p>
          ) : (
            <Muted>{t('admin.workspace.stage.releaseNone')}</Muted>
          )}
        </Step>
      </ol>

      {/* ── The existing modals, each writing through its existing RPC ────────────── */}
      {v && (
        <RecordVerificationModal
          open={showRecord}
          verifierName={who(v.verifierId)}
          onClose={() => setShowRecord(false)}
          onConfirm={async input => {
            const ok = await run('record_verification', () => recordVerification({
              verificationId: v.id, decision: input.decision, findings: input.findings || undefined,
              visitedAt: input.visited ? new Date().toISOString() : undefined, onBehalfOf: v.verifierId, reason: input.reason,
            }));
            if (ok) setShowRecord(false);
          }}
        />
      )}
      <ConfirmModal
        open={showApprove}
        title={t('admin.approveStageTitle')}
        description={t('admin.workspace.stages.approveBody', { n: view.stage.stage_number, project: ws.project.name })}
        confirmLabel={t('admin.workspace.stages.approve')}
        loading={busy === 'approve'}
        onConfirm={() => { if (user) run('approve', () => adminApproveStage(ws.project.id, view.stage.id, view.stage.stage_number, user.id)).then(() => setShowApprove(false)); }}
        onCancel={() => setShowApprove(false)}
      />
      <ReworkModal
        open={showRework}
        onClose={() => setShowRework(false)}
        onConfirm={reason => { if (user) run('rework', () => adminRequestRework(ws.project.id, view.stage.id, view.stage.stage_number, user.id, reason)).then(ok => { if (ok) setShowRework(false); }); }}
      />
      <AnimatePresence>
        {ledger && (
          <LedgerModal
            modal={ledger}
            projectName={ws.project.name}
            stage={stageRef}
            contractors={ledger.kind === 'authorise' ? contractors : []}
            onClose={() => setLedger(null)}
            onDone={() => { setLedger(null); onChanged(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 px-5 py-4">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-brand-border-grey text-[11px] font-semibold tabular-nums text-brand-mid-grey dark:border-[#2c2c2c]">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-grey">{title}</h3>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-brand-mid-grey">{children}</p>;
}
