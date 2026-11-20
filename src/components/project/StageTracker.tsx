import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Download, Loader2, Lock, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { StageMarker } from './StageMarker';
import { SubstageRow } from './SubstageRow';
import { EvidenceThumbs } from './EvidenceThumbs';
import type { ProjectStageRow, ProjectSubstageRow, StageStatus } from '@/types/project';
import { MoneyValue } from './MoneyValue';
import { DocumentViewer } from './DocumentViewer';
import { fetchProjectCertificates, type IssuedCertificate } from '@/lib/supabase/certificates';
import { formatShare } from '@/lib/budget/stage-shares';
import { useProjectMoneyContext } from '@/lib/budget/project-money-context';
import { stageReceiptBalance, stageReceiptExcess, stageReceiptTotalExcess } from '@/lib/payments/stage-receipt-balance';
import { useLanguage, useT, type TKey } from '@/lib/i18n';
import { currencyFractionDigits } from '@/lib/format';
import { StagePaymentGate } from '@/components/project/StagePaymentGate';
import { StageBreakdownPanel } from '@/components/project/StageBreakdownPanel';
import { partWorkReady, useSubstagePayments } from '@/lib/supabase/substage-payments';
import type { SubstagePaymentRequest } from '@/lib/supabase/contractor-payments';
import type { ApproveStageResult, StagePayment } from '@/lib/supabase/verifications';
import { useStageLabels } from '@/lib/stage-labels';
import { canActOnProjectStage, currentProjectStage, projectReflectsApproval, projectStagesAfterApproval, stagePaymentAcknowledged, stageWorkReady, stageStartsWithEvidence, canSubmitStageReceipt } from '@/lib/projects/stage-progression';


// ── Stage circle (horizontal pipeline) ───────────────────

function StageCircle({
  status, current = false,
  number,
  selected,
}: {
  status: StageStatus;
  current?: boolean;
  number: number;
  selected: boolean;
}) {
  return <StageMarker position={status === 'complete' ? 'done' : current || status === 'active' || status === 'pending_review' ? 'current' : 'future'}
    number={number} selected={selected} size="lg" />;
}

// ── Stage badge ────────────────────────────────────────────

// `tier` is not decoration here. On Self Verify nobody at Jalla reviews a stage, so
// "In Review" would name a wait that does not exist — the stage is the owner's own to
// approve. Anything that renders a stage state has to know which plan it is on.
function StageBadge({ status, tier, historical, reviewPaymentPending }: { status: StageStatus; tier: string; historical?: boolean; reviewPaymentPending?: boolean }) {
  const t = useT();
  const map: Record<StageStatus, { labelKey: TKey; className: string }> = {
    active:         { labelKey: 'project.stages.badgeActive', className: 'border border-state-complete text-state-complete bg-state-complete/5' },
    pending_review: {
      labelKey: 'project.stages.badgeYourApproval',
      className: 'border border-brand-border-grey text-brand-mid-grey',
    },
    complete:       { labelKey: 'project.review.approved', className: 'bg-brand-green text-white' },
    locked:         { labelKey: 'project.stages.badgeLocked',   className: 'text-brand-mid-grey' },
  };
  const { labelKey, className } = map[status];
  const label = historical ? 'project.costing.completedBeforeTracking' : reviewPaymentPending ? 'project.receiptFlow.reviewedPaymentBadge' : labelKey;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide',
        className,
      )}
    >
      {t(label)}
    </span>
  );
}

// ── Approve button ─────────────────────────────────────────

function ApproveButton({
  tier,
  stageNumber,
  onApprove,
  loading,
}: {
  tier: string;
  stageNumber: number;
  onApprove: () => void;
  loading: boolean;
}) {
  const t = useT();
  const label = t('project.stages.approveStage', { n: stageNumber });

  return (
    <button
      type="button"
      onClick={onApprove}
      disabled={loading}
      className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-brand-green text-white text-sm font-semibold py-3 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {label}
    </button>
  );
}

// ── Stage detail (substages + actions) ────────────────────

interface StageDetailProps {
  clientPresentation?: boolean;
  projectName: string;
  evidenceFirst?: boolean;
  stage: ProjectStageRow;
  substages: ProjectSubstageRow[];
  tier: string;
  userId: string;
  isContractor?: boolean;
  canConfirmPayments: boolean;
  hasPrimaryContractor: boolean;
  canApprove: boolean;
  canUploadEvidence: boolean;
  projectId: string;
  /** The incoming tranche on THIS stage, if one is owed (175). */
  payment?: StagePayment;
  /** Open contractor payment requests on this stage (including ones created before the Homeowner joined). */
  paymentRequests?: SubstagePaymentRequest[];
  canAct: boolean;
  workAllowed: boolean;
  paymentEnabled: boolean;
  paymentBlockedReason: string;
  isFinalStage: boolean;
  onPaymentChanged: () => void | Promise<void>;
  onMarkSubstageComplete: (substageId: string) => Promise<void>;
  onEvidenceUploaded: (substageId: string, urls: string[]) => void;
  onApproveStage: (stageId: string, stageNumber: number) => Promise<void>;
  renderEvidenceUpload: (props: {
    substageId: string;
    existingUrls: string[];
    onUploadComplete: (urls: string[]) => void;
  }) => React.ReactNode;
}

function scrollToStageReceipt(stageId: string) {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(`stage-payment-form-${stageId}`) ?? document.getElementById(`stage-payment-${stageId}`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const input = document.getElementById(`receipt-amount-${stageId}`) as HTMLInputElement | null;
  if (input) window.setTimeout(() => input.focus({ preventScroll: true }), 260);
}

function summarizeStagePayment(
  stage: Pick<ProjectStageRow, 'milestone_amount' | 'payment_milestone_usd' | 'pre_existing'>,
  payment: StagePayment | undefined,
  code: string,
  fxRate: number,
) {
  if (stage.pre_existing || !payment) return null;
  const scheduled = stage.milestone_amount ?? (stage.payment_milestone_usd != null ? stage.payment_milestone_usd * fxRate : null);
  if (scheduled != null && scheduled <= 0 && !payment.receipts?.length && !payment.receiptPath) return null;
  const balance = stageReceiptBalance(payment, code, fxRate, stage.milestone_amount);
  const due = stage.milestone_amount ?? payment.amount * fxRate;
  const excessConfirmed = stageReceiptExcess(balance, due);
  const excessTotal = stageReceiptTotalExcess(balance, due);
  const excessNow = excessConfirmed != null && excessConfirmed > 0 ? excessConfirmed : (excessTotal != null && excessTotal > 0 ? excessTotal : 0);
  const settled = payment.state === 'funded' || payment.state === 'reconciled';
  const fullyPaid = settled && (balance.remaining === 0 || (balance.received == null && !payment.receipts?.length));
  return { balance, excessNow, settled, fullyPaid, due };
}

function StageDetail({
  clientPresentation = false, projectName, evidenceFirst = false,
  stage,
  substages,
  tier,
  userId,
  isContractor,
  canConfirmPayments,
  hasPrimaryContractor,
  canApprove,
  canUploadEvidence,
  projectId,
  payment,
  paymentRequests = [],
  canAct, workAllowed, paymentEnabled, paymentBlockedReason,
  isFinalStage,
  onPaymentChanged,
  onMarkSubstageComplete,
  onEvidenceUploaded,
  onApproveStage,
  renderEvidenceUpload,
}: StageDetailProps) {
  const { stageLabel, substageLabel } = useStageLabels();
  // The milestone in the project's currency (9 Nov 2026) — project-money-context.tsx.
  const t = useT();
  const { lang } = useLanguage();
  const currency = useProjectMoneyContext();
  const code = currency?.code ?? 'USD';
  const fxRate = currency?.budgetRate ?? currency?.rate ?? 1;
  const formatMoney = (value: number | null | undefined) => value == null
    ? t('project.receiptFlow.amountUnknown')
    : `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: currencyFractionDigits(code) }).format(value)} ${code}`;
  const paymentSummary = summarizeStagePayment(stage, payment, code, fxRate);
  const openStageRequests = paymentRequests.filter(r => r.stage_id === stage.id && r.status === 'open');
  const formatRequestAmount = (amount: number | null, iso: string | null) => {
    if (amount == null || !Number.isFinite(amount)) return '';
    return `${amount.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: currencyFractionDigits(iso) })} ${iso ?? ''}`.trim();
  };
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving]     = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const approvalBusy = useRef(false);
  const scope = `${projectId}:${stage.id}`;
  const liveScope = useRef<string | null>(scope);
  liveScope.current = scope;
  useEffect(() => () => { if (liveScope.current === scope) liveScope.current = null; }, [scope]);

  // A stage paid by part opens its parts one at a time (18 Nov).
  const paidByPart = !!stage.paid_by_part;
  const parts = useSubstagePayments(stage.id, paidByPart, payment);
  const approvalsRemaining = substages.filter(sub => sub.status !== 'complete').length;
  const allSubstagesReady = approvalsRemaining === 0;

  // Funded through Groundwork, not merely 'nothing outstanding'. A pre-existing stage
  // reads 'paid' on the legacy projection because its milestone is 0 (103), and must not
  // unlock anything on that basis. Such a stage is `complete`, so these gates are already
  // unreachable; saying it here means a future status change cannot quietly open them.
  const stagePaid = workAllowed;

  const showApproveButton =
    canApprove &&
    canAct &&
    !stage.review_payment_pending &&
    (stage.status === 'active' || stage.status === 'pending_review') &&
    allSubstagesReady &&
    stagePaid;
  const paymentPending = payment?.state === 'expected' || payment?.state === 'receipt_submitted';
  // Not gated on `stagePaid`: a contractor-created stage counts as ready for work before it
  // is paid, so with no payment record it rendered no payment section and no message.
  const missingPayment = hasPrimaryContractor && canAct && !payment
    && (stage.payment_milestone_usd == null || stage.payment_milestone_usd > 0);
  const canUploadReceiptNow = clientPresentation && !isContractor && canApprove && hasPrimaryContractor
    && !!payment && paymentEnabled && (!paymentSummary?.settled || (paymentSummary?.balance.remaining ?? 0) > 0)
    && (!paidByPart || !!parts?.next_payable);

  async function handleApprove() {
    if (approvalBusy.current) return;
    approvalBusy.current = true;
    setApprovalError(null);
    setApproving(true);
    try {
      await onApproveStage(stage.id, stage.stage_number);
      if (liveScope.current === scope) setConfirmOpen(false);
    } catch {
      if (liveScope.current === scope) setApprovalError(t('project.stages.approvalFailed'));
    } finally {
      approvalBusy.current = false;
      if (liveScope.current === scope) setApproving(false);
    }
  }

  return (
    <motion.div
      id={`project-stage-${stage.id}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {/* Detail header */}
      <div className={cn('mb-4 flex items-start justify-between gap-3', clientPresentation && 'flex-col gap-4 pb-3 sm:flex-row sm:gap-5')}>
        <div>
          <p className="text-[11px] font-medium text-brand-mid-grey mb-0.5">
            {t('project.stages.stageN', { n: stage.stage_number })}
          </p>
          <h2 className={clientPresentation ? 'text-xl font-bold tracking-tight text-brand-near-black sm:text-2xl' : 'text-sm font-semibold text-brand-near-black leading-snug'}>
            {stageLabel(stage)}
          </h2>
          {clientPresentation && <div className="mt-3 flex items-center gap-2 text-xs font-medium text-brand-mid-grey"><span className={cn('size-1.5 shrink-0 rounded-full', stage.status === 'complete' || stage.review_payment_pending ? 'bg-brand-green' : 'bg-brand-mid-grey')} aria-hidden />{t(stage.status === 'complete' || stage.review_payment_pending ? 'project.clientUi.workApproved' : stage.status === 'locked' ? 'project.stages.badgeLocked' : 'project.clientUi.workInProgress')}</div>}
        </div>
        <div className={cn('mt-0.5', clientPresentation ? 'min-w-0 rounded-lg bg-brand-off-white px-4 py-3 sm:max-w-[45%]' : 'flex shrink-0 items-center gap-2')}>
          {clientPresentation && <p className="mb-1 text-xs text-brand-mid-grey">{t('project.clientUi.stageBudget')}</p>}
          <span className={clientPresentation ? 'break-words font-mono text-base font-semibold text-brand-near-black' : 'text-xs text-brand-mid-grey tabular-nums whitespace-nowrap'}>
            <MoneyValue usd={stage.payment_milestone_usd} amount={stage.milestone_amount} />{' '}
            <span className="text-[10px]">({formatShare(stage.budget_pct)})</span>
          </span>
          {!clientPresentation && <StageBadge status={stage.status} tier={tier} historical={stage.pre_existing === true} reviewPaymentPending={stage.review_payment_pending} />}
        </div>
      </div>

      {/* Stage payment action & compact summary bar (Homeowner view) */}
      {clientPresentation && !isContractor && paymentSummary && (hasPrimaryContractor || !!payment?.receipts?.length || !!payment?.receiptPath) && (
        <div
          data-client-stage-payment-bar
          data-clarity-mask="true"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-border-grey bg-brand-off-white/70 px-4 py-3 dark:border-[#2c2c2c] dark:bg-[#141414]"
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div>
              <span className="text-brand-mid-grey">{t('project.clientUi.paidLabel')}: </span>
              <span className={cn('font-mono font-semibold tabular-nums', (paymentSummary.balance.received ?? 0) > 0 ? 'text-brand-green dark:text-[#86efac]' : 'text-brand-near-black dark:text-white')}>
                {formatMoney(paymentSummary.balance.received)}
              </span>
            </div>
            <div>
              <span className="text-brand-mid-grey">{t('project.clientUi.leftLabel')}: </span>
              <span className="font-mono font-semibold tabular-nums text-brand-near-black dark:text-white">
                {formatMoney(paymentSummary.balance.remaining)}
              </span>
            </div>
            {paymentSummary.balance.pending != null && paymentSummary.balance.pending > 0 && (
              <div>
                <span className="text-brand-mid-grey">{t('project.clientUi.pendingLabel')}: </span>
                <span className="font-mono font-semibold tabular-nums text-state-held">
                  {formatMoney(paymentSummary.balance.pending)}
                </span>
              </div>
            )}
            {paymentSummary.excessNow > 0 && (
              <span
                data-stage-summary-excess
                className="inline-flex items-center gap-1 rounded-full border border-state-held/40 bg-state-held/12 px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-state-held"
              >
                {t('project.clientUi.excessLabel')}: +{formatMoney(paymentSummary.excessNow)}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {canUploadReceiptNow ? (
              <button
                type="button"
                data-action="stage-upload-receipt"
                onClick={() => scrollToStageReceipt(stage.id)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-green px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-green-hover"
              >
                <Receipt className="size-3.5" aria-hidden />
                {t('project.clientUi.uploadReceipt')}
              </button>
            ) : paymentSummary.fullyPaid ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-green/10 px-2.5 py-1 text-xs font-semibold text-brand-green dark:text-[#86efac]">
                <Check className="size-3.5" aria-hidden />
                {t('project.clientUi.paidInFull')}
              </span>
            ) : !paymentEnabled && !paymentSummary.settled ? (
              <span className="text-[11px] text-brand-mid-grey">{paymentBlockedReason}</span>
            ) : null}
          </div>
        </div>
      )}

      {!isContractor && openStageRequests.length > 0 && (
        <div role="status" data-client-payment-requests className="mb-4 space-y-2 rounded-xl border border-state-held/40 bg-state-held/10 p-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-brand-near-black dark:text-white">{t('project.clientUi.paymentRequestedTitle')}</p>
            {canUploadReceiptNow && (
              <button
                type="button"
                onClick={() => scrollToStageReceipt(stage.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-green-hover"
              >
                <Receipt className="size-3" aria-hidden />
                {t('project.clientUi.uploadReceipt')}
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {openStageRequests.map(req => {
              const sub = req.substage_id ? substages.find(s => s.id === req.substage_id) : undefined;
              const formatted = formatRequestAmount(req.amount, req.currency);
              return (
                <li key={req.id} className="flex flex-wrap items-baseline justify-between gap-2 text-brand-near-black dark:text-white">
                  <span className="min-w-0">
                    {sub && <span className="font-semibold">{substageLabel(sub)}</span>}
                    {req.note && <span className="text-brand-mid-grey">{sub ? ' · ' : ''}{req.note}</span>}
                  </span>
                  {formatted && (
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-state-held">
                      {t('project.clientUi.paymentRequestedAmount', { amount: formatted })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {stage.status === 'locked' ? (
        <>
          <p className="text-sm text-brand-mid-grey">
            {t(!hasPrimaryContractor ? 'project.contractorConnection.paymentBlocked' : !canAct ? 'project.stages.lockedBody'
              : missingPayment ? 'project.stages.paymentDetailsMissing'
              : paymentPending ? 'project.stages.paymentBeforeWork' : 'project.stages.stageReady')}
          </p>
        </>
      ) : (
        <>
          {!canAct && stage.status !== 'complete' && <p className="mb-3 text-sm text-brand-mid-grey">{t('project.stages.lockedBody')}</p>}

          {clientPresentation && <h3 className="mb-4 text-sm font-semibold text-brand-near-black">{t('project.clientUi.contractorUpdates')}</h3>}
          {clientPresentation && allSubstagesReady && <div className="mb-4"><EvidenceThumbs paths={[...new Set(substages.flatMap(sub => sub.evidence_urls))]} size="review" /></div>}
          <div className={clientPresentation ? 'space-y-3' : 'divide-y divide-brand-border-grey/60'}>
            {substages.map(sub => {
              const subPart = paidByPart ? parts?.parts?.find(p => p.id === sub.id) : undefined;
              const subRequest = openStageRequests.find(r => r.substage_id === sub.id);
              const subCanUploadReceipt = canUploadReceiptNow && (!paidByPart || !!subPart?.payable);
              const remainingAfterPending = paymentSummary?.balance.remaining != null
                ? Math.max(0, Math.round((paymentSummary.balance.remaining - (paymentSummary.balance.pending ?? 0)) * 1e6) / 1e6)
                : null;
              const requestedAmt = subRequest ? formatRequestAmount(subRequest.amount, subRequest.currency) : '';
              return (
                <SubstageRow
                  key={sub.id}
                  substage={sub}
                  tier={tier}
                  userId={userId}
                  isStageActive={canAct && (stage.status === 'active' || stage.status === 'pending_review')}
                  stagePaid={stagePaid}
                  compactEvidence={clientPresentation && allSubstagesReady}
                  canUploadEvidence={canUploadEvidence && canAct && (workAllowed || (paidByPart && !!parts?.parts?.some(part => part.work_ready && part.status !== 'complete')))
                    && partWorkReady(parts, paidByPart, sub.id)}
                  approvalContext={clientPresentation ? {
                    projectName, stageName: `${t('project.stages.stageN', { n: stage.stage_number })} · ${stageLabel(stage)}`,
                    lastUpdate: approvalsRemaining === 1,
                    description: t(approvalsRemaining === 1 ? evidenceFirst && (stage.payment_milestone_usd ?? 0) > 0 ? 'project.clientUi.reviewedStageNext' : 'project.clientUi.fundedStageNext' : 'project.clientUi.approveUpdateBody'),
                  } : undefined}
                  receiptAction={subCanUploadReceipt ? {
                    projectId,
                    stageId: stage.id,
                    splitByPart: paidByPart,
                    initialAmount: subRequest?.amount != null ? String(subRequest.amount) : subPart?.remaining ? String(subPart.remaining) : '',
                    initialCurrency: subRequest?.currency ?? (paidByPart ? (parts?.currency ?? code) : code),
                    remainingDue: subPart ? Number(subPart.remaining) : remainingAfterPending,
                    requestedLabel: requestedAmt ? t('project.clientUi.paymentRequestedAmount', { amount: requestedAmt }) : null,
                    onUploaded: onPaymentChanged,
                  } : undefined}
                  onMarkComplete={canApprove ? onMarkSubstageComplete : undefined}
                  onEvidenceUploaded={onEvidenceUploaded}
                  renderEvidenceUpload={renderEvidenceUpload}
                />
              );
            })}
          </div>

          {showApproveButton && (
            <ApproveButton
              tier={tier}
              stageNumber={stage.stage_number}
              onApprove={() => { setApprovalError(null); setConfirmOpen(true); }}
              loading={approving}
            />
          )}

          {canApprove && canAct && stagePaid && approvalsRemaining > 0 && (
            <p role="status" className="mt-3 text-xs text-brand-mid-grey leading-relaxed">
              {t('project.stages.approvalsRemaining', { count: approvalsRemaining })}
            </p>
          )}
        </>
      )}

      {!stage.pre_existing && hasPrimaryContractor && (stage.payment_milestone_usd ?? 0) > 0 && <StageBreakdownPanel
        stageId={stage.id} stageName={`${t('project.stages.stageN', { n: stage.stage_number })} · ${stageLabel(stage)}`}
        projectName={projectName ?? ''} clientPresentation={clientPresentation} onChanged={onPaymentChanged}
      />}

      {!stage.pre_existing && payment && (hasPrimaryContractor || !!payment.receipts?.length || !!payment.receiptPath) && <StagePaymentGate
        projectId={projectId} stageId={stage.id} stageNumber={stage.stage_number} payment={payment}
        isContractor={!!isContractor} readOnly={!hasPrimaryContractor || (isContractor ? !canConfirmPayments : !canApprove)} canUpload={paymentEnabled}
        blockedReason={paymentBlockedReason} scheduledAmount={stage.milestone_amount} onChanged={onPaymentChanged}
        workReviewed={stage.review_payment_pending}
        clientPresentation={clientPresentation} parts={parts}
      />}

      {missingPayment && (
        <p role="status" className="mt-3 text-xs text-brand-mid-grey">
          {t('project.stages.paymentDetailsMissing')}{' '}
          <button type="button" className="font-semibold underline" onClick={() => {
            void Promise.resolve(onPaymentChanged()).catch(() => {});
          }}>{t('project.stages.refreshProject')}</button>
        </p>
      )}

      <ConfirmModal
        open={confirmOpen}
        variant={clientPresentation ? 'client' : 'default'}
        eyebrow={clientPresentation ? `${projectName} · ${stageLabel(stage)}` : undefined}
        title={t('project.stages.confirmApproveTitle')}
        description={t(isFinalStage ? 'project.stages.confirmFinalApproveBody' : 'project.stages.confirmApproveBody')}
        confirmLabel={t('project.stages.confirmApproveCta')}
        cancelLabel={t('common.cancel')}
        error={approvalError}
        loading={approving}
        onConfirm={handleApprove}
        onCancel={() => { if (!approvalBusy.current) setConfirmOpen(false); }}
      />
    </motion.div>
  );
}

// ── StageTracker ──────────────────────────────────────────

export interface StageTrackerProps {
  clientPresentation?: boolean;
  hasPrimaryContractor?: boolean;
  canConfirmPayments?: boolean;
  /** Only an assigned project contractor may upload or remove construction evidence. */
  canUploadEvidence?: boolean;
  stages: ProjectStageRow[];
  substages: ProjectSubstageRow[];
  tier: string;
  userId: string;
  isContractor?: boolean;
  canApprove: boolean;
  projectId: string;
  projectName: string;
  projectCountry: string;
  projectCity: string | null;
  ownerName: string;
  /** Incoming tranches keyed by stage id (175). */
  payments?: Map<string, StagePayment>;
  /** Open contractor payment requests across stages (19 Nov). */
  paymentRequests?: SubstagePaymentRequest[];
  onPaymentChanged: () => void | Promise<void>;
  onMarkSubstageComplete: (substageId: string) => Promise<ApproveStageResult | undefined>;
  onEvidenceUploaded: (substageId: string, urls: string[]) => void;
  onApproveStage: (stageId: string, stageNumber: number) => Promise<ApproveStageResult | undefined>;
  renderEvidenceUpload: (props: {
    substageId: string;
    existingUrls: string[];
    onUploadComplete: (urls: string[]) => void;
  }) => React.ReactNode;
  workflowOrigin?: 'client' | 'contractor';
  projectPaused?: boolean;
  projectArchived?: boolean;
}

/**
 * Two-word label for the pipeline node, which is 56px wide.
 *
 * Takes the TRANSLATED stage label, not the English `name` column — the pipeline
 * used to read "Structure &" / "Electrical &" in French too, because it truncated
 * the untranslated database value.
 *
 * Trailing conjunctions are dropped rather than shown: "Structure & Walls" cut to
 * two words leaves "Structure &", which reads as a typo. "Structure" alone is
 * unambiguous at this size, and the full name is on the panel below.
 */
const DANGLING = /[\s&/,–—-]+$|\s+(and|et|&)$/i;

function shortLabel(label: string): string {
  const words = label.split(/\s+/);
  let short = words.length <= 2 ? label : words.slice(0, 2).join(' ');
  short = short.replace(DANGLING, '').replace(DANGLING, '');
  return short.length > 13 ? short.slice(0, 12) + '…' : short;
}

export function StageTracker({
  clientPresentation = false,
  hasPrimaryContractor = false,
  stages, workflowOrigin = 'client', projectPaused = false, projectArchived = false, canUploadEvidence = false,
  substages,
  tier,
  userId,
  isContractor,
  canConfirmPayments = !!isContractor,
  canApprove,
  projectId,
  payments,
  paymentRequests,
  onPaymentChanged,
  projectName,
  projectCountry,
  projectCity,
  ownerName,
  onMarkSubstageComplete,
  onEvidenceUploaded,
  onApproveStage,
  renderEvidenceUpload,
}: StageTrackerProps) {
  const t = useT();
  const { lang } = useLanguage();
  const { stageLabel } = useStageLabels();
  const currency = useProjectMoneyContext();
  const code = currency?.code ?? 'USD';
  const fxRate = currency?.budgetRate ?? currency?.rate ?? 1;
  const formatMoney = (value: number | null | undefined) => value == null
    ? t('project.receiptFlow.amountUnknown')
    : `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: currencyFractionDigits(code) }).format(value)} ${code}`;
  const [pendingReceiptScroll, setPendingReceiptScroll] = useState<string | null>(null);

  // Only an actual, unrevoked issued PDF offers a certificate action.
  const [issued, setIssued] = useState<{ projectId: string; rows: Map<string, IssuedCertificate> }>({ projectId, rows: new Map() });
  useEffect(() => {
    let active = true;
    void fetchProjectCertificates(projectId, { strict: true }).then(rows => { if (active) setIssued({ projectId, rows }); })
      .catch(() => { if (active) setIssued({ projectId, rows: new Map() }); });
    return () => { active = false; };
  }, [projectId, stages]);
  const [selection, setSelection] = useState<{ projectId: string; stageId: string | null; follow: boolean }>({
    projectId, stageId: null, follow: true,
  });
  const [nextAction,setNextAction]=useState<{projectId:string;id:string;number:number}|null>(null);
  const [handoff, setHandoff] = useState<ApproveStageResult | null>(null);
  const navigation = useRef({ projectId, version: 0, mounted: true });
  if (navigation.current.projectId !== projectId) {
    navigation.current = { projectId, version: navigation.current.version + 1, mounted: true };
  }
  useEffect(() => {
    navigation.current.mounted = true;
    return () => { if (navigation.current.projectId === projectId) navigation.current.mounted = false; };
  }, [projectId]);
  useEffect(() => {
    if (handoff?.projectId === projectId && projectReflectsApproval(stages, handoff)) setHandoff(null);
  }, [handoff, stages, projectId]);
  const [certificate, setCertificate] = useState<{ projectId: string; name: string; url: string } | null>(null);

  // The approval response is authoritative even if the refresh is still arriving.
  // Release this local handoff as soon as the saved completed row reaches the page.
  const orderedStages = projectStagesAfterApproval(stages, handoff?.projectId === projectId ? handoff : null);
  const currentStage = currentProjectStage(orderedStages);
  const fallback = currentStage ?? orderedStages[orderedStages.length - 1];
  const selectedStage = selection.projectId === projectId && !selection.follow
    ? orderedStages.find(stage => stage.id === selection.stageId) ?? fallback : fallback;
  const selectedNum = selectedStage?.stage_number;
  const clientStageNav = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = clientStageNav.current;
    if (!clientPresentation || !nav) return;
    const revealSelection = () => {
      if (nav.scrollWidth <= nav.clientWidth) return;
      const selected = nav.querySelector<HTMLButtonElement>('[aria-current="step"]');
      if (!selected) return;
      const bounds = nav.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      nav.scrollLeft += item.left - bounds.left - (nav.clientWidth - item.width) / 2;
    };
    revealSelection();
    window.addEventListener('resize', revealSelection);
    return () => window.removeEventListener('resize', revealSelection);
  }, [clientPresentation, projectId, selectedStage?.id]);
  const stageParams = new URLSearchParams(typeof window === 'undefined' ? '' : window.location?.search ?? '');
  const requestedStage = stageParams.get('stage_id') ?? stageParams.get('stage');
  const appliedLink=useRef('');
  const observedStage=useRef<{projectId:string;id:string|null}>({projectId,id:null});
  useEffect(()=>{if(!requestedStage){appliedLink.current='';return;}const key=projectId+':'+requestedStage;if(appliedLink.current===key)return;const target=orderedStages.find(stage=>stage.id===requestedStage||String(stage.stage_number)===requestedStage);if(target){appliedLink.current=key;navigation.current.version++;setSelection({projectId,stageId:target.id,follow:false});}},[projectId,requestedStage,stages]);
  useEffect(()=>{const old=observedStage.current;if(old.projectId===projectId&&old.id&&currentStage?.id&&old.id!==currentStage.id&&selection.follow){setSelection({projectId,stageId:old.id,follow:false});setNextAction({projectId,id:currentStage.id,number:currentStage.stage_number});}observedStage.current={projectId,id:currentStage?.id??null};},[projectId,currentStage?.id,selection.follow]);
  const completedCount = orderedStages.filter(s => s.status === 'complete').length;

  function captureNavigation() {
    return { projectId, version: navigation.current.version };
  }
  function followApproval(result: ApproveStageResult | undefined, captured: ReturnType<typeof captureNavigation>) {
    if (!result || result.projectId !== captured.projectId || captured.projectId !== navigation.current.projectId
        || captured.version !== navigation.current.version || !navigation.current.mounted) return;
    setHandoff(result);
    if(result.nextStageId&&result.nextStageId!==result.stageId){setSelection({projectId:captured.projectId,stageId:result.stageId,follow:false});setNextAction({projectId:captured.projectId,id:result.nextStageId,number:result.nextStageNumber??0});}else setSelection({ projectId: captured.projectId, stageId: result.stageId, follow: true });
  }
  async function handleStageApproval(stageId: string, stageNumber: number) {
    const captured = captureNavigation();
    const result = await onApproveStage(stageId, stageNumber);
    followApproval(result, captured);
  }
  async function handleSubstageApproval(substageId: string) {
    const captured = captureNavigation();
    const result = await onMarkSubstageComplete(substageId);
    followApproval(result, captured);
  }

  const detail = selectedStage ? (
    <StageDetail
                clientPresentation={clientPresentation}
                projectName={projectName}
                evidenceFirst={stageStartsWithEvidence(selectedStage, orderedStages, workflowOrigin)}
                key={selectedStage.id}
                stage={selectedStage}
                substages={substages.filter(sub => sub.stage_id === selectedStage.id)}
                tier={tier}
                userId={userId}
                isContractor={isContractor}
                canConfirmPayments={canConfirmPayments}
                hasPrimaryContractor={hasPrimaryContractor}
                canApprove={canApprove}
                canUploadEvidence={canUploadEvidence}
                projectId={projectId}
                payment={payments?.get(selectedStage.id)}
                paymentRequests={paymentRequests}
                canAct={!projectPaused && canActOnProjectStage(selectedStage, orderedStages)}
                workAllowed={!projectPaused && stageWorkReady(selectedStage, orderedStages, payments?.get(selectedStage.id), workflowOrigin)}
                paymentEnabled={hasPrimaryContractor && !projectArchived && (!projectPaused||selectedStage.status==='complete') && canSubmitStageReceipt(selectedStage, orderedStages, workflowOrigin)}
                paymentBlockedReason={t(!hasPrimaryContractor ? 'project.contractorConnection.paymentBlocked' : projectPaused ? 'project.receiptFlow.paused' : stageStartsWithEvidence(selectedStage, orderedStages, workflowOrigin) ? isContractor ? 'project.receiptFlow.evidenceFirstContractor' : 'project.receiptFlow.evidenceFirst' : isContractor ? 'project.receiptFlow.waitForUpdatesContractor' : 'project.receiptFlow.waitForUpdates')}
                isFinalStage={selectedStage.id === orderedStages[orderedStages.length - 1]?.id}
                onPaymentChanged={onPaymentChanged}
                onMarkSubstageComplete={handleSubstageApproval}
                onEvidenceUploaded={onEvidenceUploaded}
                onApproveStage={handleStageApproval}
                renderEvidenceUpload={renderEvidenceUpload}
              />
  ) : null;

  const nextStageNotice = nextAction?.projectId === projectId && (
    <div role="status" className="rounded-xl border border-brand-green p-4 text-sm">
      <p>{t('project.receiptFlow.nextStageReady')}</p>
      <button type="button" onClick={() => { navigation.current.version++; setSelection({ projectId, stageId: nextAction.id, follow: true }); setNextAction(null); }} className="mt-3 min-h-11 rounded-lg bg-brand-green px-4 py-2.5 font-semibold text-white">
        {t('project.receiptFlow.openStage', { n: nextAction.number })}
      </button>
    </div>
  );

  useEffect(() => {
    if (!pendingReceiptScroll || selectedStage?.id !== pendingReceiptScroll) return;
    const id = window.setTimeout(() => {
      scrollToStageReceipt(pendingReceiptScroll);
      setPendingReceiptScroll(null);
    }, 120);
    return () => window.clearTimeout(id);
  }, [pendingReceiptScroll, selectedStage?.id]);

  if (clientPresentation) return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[16.5rem_minmax(0,1fr)] xl:items-start">
      <aside className="min-w-0 overflow-hidden rounded-xl border border-brand-border-grey bg-white xl:sticky xl:top-5">
        <div className="border-b border-brand-border-grey px-4 py-4">
          <h2 className="text-sm font-bold text-brand-near-black">{t('project.clientUi.stagesTitle')}</h2>
          <p className="mt-1 text-xs text-brand-mid-grey">{t('project.stages.completeCount', { done: completedCount, total: stages.length })}</p>
        </div>
        <nav ref={clientStageNav} aria-label={t('project.clientUi.stagesTitle')} className="flex gap-1 overflow-x-auto p-2 xl:block xl:space-y-1 xl:overflow-visible">
          {orderedStages.map(stage => {
            const stagePay = payments?.get(stage.id);
            const railSummary = !isContractor ? summarizeStagePayment(stage, stagePay, code, fxRate) : null;
            const stageCanUpload = !isContractor && canApprove && hasPrimaryContractor && !projectArchived
              && (!projectPaused || stage.status === 'complete')
              && canSubmitStageReceipt(stage, orderedStages, workflowOrigin)
              && !!railSummary && (!railSummary.settled || (railSummary.balance.remaining ?? 0) > 0);
            return (
              <div key={stage.id} className="min-w-52 shrink-0 xl:min-w-0">
                <button type="button" aria-current={selectedStage?.id === stage.id ? 'step' : undefined}
                  onClick={() => { navigation.current.version++; setSelection({ projectId, stageId: stage.id, follow: stage.id === currentStage?.id }); }}
                  className={cn('flex min-h-20 w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-green', selectedStage?.id === stage.id ? 'bg-brand-green/8' : 'hover:bg-brand-off-white')}>
                  <span className="mt-0.5 shrink-0">{stage.status === 'locked' ? <span className="flex size-9 items-center justify-center rounded-full bg-brand-off-white"><Lock className="size-4 text-brand-mid-grey" aria-hidden /></span> : <StageCircle status={stage.status} current={stage.id === currentStage?.id} number={stage.stage_number} selected={selectedStage?.id === stage.id} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold leading-relaxed text-brand-near-black">{stage.stage_number}. {stageLabel(stage)}</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-brand-mid-grey">
                      {t(stage.pre_existing ? 'project.costing.completedBeforeTracking' : stage.status === 'complete' ? 'common.complete' : stage.review_payment_pending ? 'project.receiptFlow.reviewedPaymentBadge' : stage.status === 'locked' ? 'project.stages.badgeLocked' : 'project.stages.badgeActive')}
                    </span>
                    <span className="mt-1 block break-words font-mono text-[11px] leading-relaxed text-brand-mid-grey"><MoneyValue usd={stage.payment_milestone_usd} amount={stage.milestone_amount} /></span>
                    {railSummary && (
                      <span data-rail-stage-payment data-clarity-mask="true" className="mt-1.5 block space-y-0.5 border-t border-brand-border-grey/70 pt-1.5 text-[10px] leading-snug">
                        {railSummary.fullyPaid ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-brand-green dark:text-[#86efac]">
                            <Check className="size-2.5" aria-hidden />{t('project.clientUi.paidInFull')}
                          </span>
                        ) : (
                          <>
                            <span className="block text-brand-mid-grey">
                              {t('project.clientUi.paidLabel')}: <span className="font-mono font-medium text-brand-near-black dark:text-white">{formatMoney(railSummary.balance.received)}</span>
                            </span>
                            <span className="block text-brand-mid-grey">
                              {t('project.clientUi.leftLabel')}: <span className="font-mono font-medium text-brand-near-black dark:text-white">{formatMoney(railSummary.balance.remaining)}</span>
                            </span>
                          </>
                        )}
                        {railSummary.excessNow > 0 && (
                          <span className="inline-block rounded-full bg-state-held/12 px-1.5 py-px font-mono font-semibold text-state-held">
                            {t('project.clientUi.excessLabel')}: +{formatMoney(railSummary.excessNow)}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
                {stageCanUpload && (
                  <div className="mb-1.5 pl-14 pr-3">
                    <button
                      type="button"
                      data-action="rail-upload-receipt"
                      onClick={() => {
                        navigation.current.version++;
                        setSelection({ projectId, stageId: stage.id, follow: stage.id === currentStage?.id });
                        if (selectedStage?.id === stage.id) scrollToStageReceipt(stage.id);
                        else setPendingReceiptScroll(stage.id);
                      }}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-green px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-green-hover"
                    >
                      <Receipt className="size-3" aria-hidden />
                      {t('project.clientUi.uploadReceipt')}
                    </button>
                  </div>
                )}
                {issued.projectId === projectId && issued.rows.get(stage.id)?.pdfUrl && <button type="button"
                  onClick={() => setCertificate({ projectId, name: `${stageLabel(stage)}.pdf`, url: issued.rows.get(stage.id)!.pdfUrl! })}
                  className="mb-2 inline-flex min-h-9 items-center gap-1 px-3 text-xs text-brand-green underline dark:text-[#b4d8bf]"><Download className="size-3" aria-hidden />{t('project.stages.certificate')}</button>}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 space-y-4">
        {nextStageNotice}
        <div className="min-w-0 rounded-xl border border-brand-border-grey bg-white p-4 sm:p-6">
          <AnimatePresence mode="wait" initial={false}>{detail}</AnimatePresence>
        </div>
      </div>
      {certificate?.projectId === projectId && <DocumentViewer name={certificate.name} url={certificate.url} onClose={() => setCertificate(null)} />}
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-brand-near-black">{t('project.stages.pipeline')}</p>
        {stages.length > 0 && (
          <span className="text-xs text-brand-mid-grey tabular-nums">
            {t('project.stages.completeCount', { done: completedCount, total: stages.length })}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-brand-border-grey overflow-hidden">
        {/* Horizontal pipeline row */}
        <div className="overflow-x-auto border-b border-brand-border-grey bg-brand-off-white/40 px-4 pt-4 pb-3">
          <div className="flex items-start min-w-max">
            {orderedStages.map((stage, i) => (
              <div key={stage.id} className="flex items-start">
                {/* Connector line */}
                {i > 0 && (
                  <div className="flex items-center shrink-0 w-5 mt-4">
                    <div className="h-px w-full bg-brand-border-grey" />
                  </div>
                )}

                {/* Stage node + optional cert button */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => {
                      navigation.current.version++;
                      setSelection({ projectId, stageId: stage.id, follow: stage.id === currentStage?.id });
                    }}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg px-2 py-1 transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-1',
                      'hover:bg-white/70',
                    )}
                  >
                    <StageCircle
                      status={stage.status}
                      current={stage.id === currentStage?.id}
                      number={stage.stage_number}
                      selected={selectedNum === stage.stage_number}
                    />
                    <span
                      className={cn(
                        'text-[9px] leading-tight text-center w-14',
                        selectedNum === stage.stage_number
                          ? 'text-brand-near-black font-semibold'
                          : 'text-brand-mid-grey',
                      )}
                    >
                      {shortLabel(stageLabel(stage))}
                    </span>
                  </button>

                  {issued.projectId === projectId && issued.rows.get(stage.id)?.pdfUrl && (
                    <button
                      type="button"
                      onClick={() => setCertificate({ projectId, name: `${stageLabel(stage)}.pdf`, url: issued.rows.get(stage.id)!.pdfUrl! })}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors mt-0.5"
                    >
                      <Download className="size-3" /> {t('project.stages.certificate')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {nextAction?.projectId===projectId&&<div role="status" className="mx-5 mt-4 rounded-xl border border-brand-green p-4 text-sm"><p>{t('project.receiptFlow.nextStageReady')}</p><button type="button" onClick={()=>{navigation.current.version++;setSelection({projectId,stageId:nextAction.id,follow:true});setNextAction(null);}} className="mt-3 rounded-xl bg-brand-green px-4 py-2 font-semibold text-white">{t('project.receiptFlow.openStage',{n:nextAction.number})}</button></div>}
        {/* Selected stage detail */}
        <div className="px-5 py-5">
          <AnimatePresence mode="wait" initial={false}>
            {detail}
          </AnimatePresence>
        </div>
      </div>

      {certificate?.projectId === projectId && <DocumentViewer name={certificate.name} url={certificate.url} onClose={() => setCertificate(null)} />}

    </div>
  );
}
