import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { StageMarker } from './StageMarker';
import { SubstageRow } from './SubstageRow';
import type { ProjectStageRow, ProjectSubstageRow, StageStatus } from '@/types/project';
import { MoneyValue } from './MoneyValue';
import { DocumentViewer } from './DocumentViewer';
import { fetchProjectCertificates, type IssuedCertificate } from '@/lib/supabase/certificates';
import { formatShare } from '@/lib/budget/stage-shares';
import { useT, type TKey } from '@/lib/i18n';
import { StagePaymentGate } from '@/components/project/StagePaymentGate';
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
  stage: ProjectStageRow;
  substages: ProjectSubstageRow[];
  tier: string;
  userId: string;
  isContractor?: boolean;
  canApprove: boolean;
  canUploadEvidence: boolean;
  projectId: string;
  /** The incoming tranche on THIS stage, if one is owed (175). */
  payment?: StagePayment;
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

function StageDetail({
  stage,
  substages,
  tier,
  userId,
  isContractor,
  canApprove,
  canUploadEvidence,
  projectId,
  payment,
  canAct, workAllowed, paymentEnabled, paymentBlockedReason,
  isFinalStage,
  onPaymentChanged,
  onMarkSubstageComplete,
  onEvidenceUploaded,
  onApproveStage,
  renderEvidenceUpload,
}: StageDetailProps) {
  const { stageLabel } = useStageLabels();
  // The milestone in the project's currency (9 Nov 2026) — project-money-context.tsx.
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving]     = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const approvalBusy = useRef(false);
  const scope = `${projectId}:${stage.id}`;
  const liveScope = useRef<string | null>(scope);
  liveScope.current = scope;
  useEffect(() => () => { if (liveScope.current === scope) liveScope.current = null; }, [scope]);

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
  const missingPayment = canAct && !stagePaid && !payment
    && (stage.payment_milestone_usd == null || stage.payment_milestone_usd > 0);

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
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {/* Detail header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[11px] font-medium text-brand-mid-grey mb-0.5">
            {t('project.stages.stageN', { n: stage.stage_number })}
          </p>
          <p className="text-sm font-semibold text-brand-near-black leading-snug">
            {stageLabel(stage)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <span className="text-xs text-brand-mid-grey tabular-nums whitespace-nowrap">
            <MoneyValue usd={stage.payment_milestone_usd} amount={stage.milestone_amount} />{' '}
            <span className="text-[10px]">({formatShare(stage.budget_pct)})</span>
          </span>
          <StageBadge status={stage.status} tier={tier} historical={stage.pre_existing === true} reviewPaymentPending={stage.review_payment_pending} />
        </div>
      </div>

      {stage.status === 'locked' ? (
        <>
          <p className="text-sm text-brand-mid-grey">
            {t(!canAct ? 'project.stages.lockedBody'
              : missingPayment ? 'project.stages.paymentDetailsMissing'
              : paymentPending ? 'project.stages.paymentBeforeWork' : 'project.stages.stageReady')}
          </p>
          {/*
            A locked stage is exactly where the money conversation belongs. The client
            has just approved the stage before it, so this one is shut for one reason
            and one only — it has not been paid for — and the thing to do about that
            is the thing to show here. Renders nothing when nothing is owed (175).
          */}

        </>
      ) : (
        <>
          {!canAct && stage.status !== 'complete' && <p className="mb-3 text-sm text-brand-mid-grey">{t('project.stages.lockedBody')}</p>}

          <div className="divide-y divide-brand-border-grey/60">
            {substages.map(sub => (
              <SubstageRow
                key={sub.id}
                substage={sub}
                tier={tier}
                userId={userId}
                isStageActive={canAct && (stage.status === 'active' || stage.status === 'pending_review')}
                stagePaid={stagePaid}
                canUploadEvidence={canUploadEvidence && canAct && workAllowed}
                onMarkComplete={canApprove ? onMarkSubstageComplete : undefined}
                onEvidenceUploaded={onEvidenceUploaded}
                renderEvidenceUpload={renderEvidenceUpload}
              />
            ))}
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

      {!stage.pre_existing && payment && <StagePaymentGate
        projectId={projectId} stageId={stage.id} stageNumber={stage.stage_number} payment={payment}
        isContractor={!!isContractor} readOnly={!isContractor && !canApprove} canUpload={paymentEnabled}
        blockedReason={paymentBlockedReason} scheduledAmount={stage.milestone_amount} onChanged={onPaymentChanged}
        workReviewed={stage.review_payment_pending}
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
        title={t('project.stages.confirmApproveTitle')}
        description={t(isFinalStage ? 'project.stages.confirmFinalApproveBody' : 'project.stages.confirmApproveBody')}
        confirmLabel={t('project.stages.confirmApproveCta')}
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
  stages, workflowOrigin = 'client', projectPaused = false, projectArchived = false, canUploadEvidence = false,
  substages,
  tier,
  userId,
  isContractor,
  canApprove,
  projectId,
  payments,
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
  const { stageLabel } = useStageLabels();

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
  const requestedStage=typeof window==='undefined'?null:new URLSearchParams(window.location?.search??'').get('stage');
  const appliedLink=useRef('');
  const observedStage=useRef<{projectId:string;id:string|null}>({projectId,id:null});
  useEffect(()=>{if(!requestedStage){appliedLink.current='';return;}const key=projectId+':'+requestedStage;if(appliedLink.current===key)return;const target=orderedStages.find(stage=>String(stage.stage_number)===requestedStage);if(target){appliedLink.current=key;navigation.current.version++;setSelection({projectId,stageId:target.id,follow:false});}},[projectId,requestedStage,stages]);
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
            {selectedStage && (
              <StageDetail
                key={selectedStage.id}
                stage={selectedStage}
                substages={substages.filter(sub => sub.stage_id === selectedStage.id)}
                tier={tier}
                userId={userId}
                isContractor={isContractor}
                canApprove={canApprove}
                canUploadEvidence={canUploadEvidence}
                projectId={projectId}
                payment={payments?.get(selectedStage.id)}
                canAct={!projectPaused && canActOnProjectStage(selectedStage, orderedStages)}
                workAllowed={!projectPaused && stageWorkReady(selectedStage, orderedStages, payments?.get(selectedStage.id), workflowOrigin)}
                paymentEnabled={!projectArchived && (!projectPaused||selectedStage.status==='complete') && canSubmitStageReceipt(selectedStage, orderedStages, workflowOrigin)}
                paymentBlockedReason={t(projectPaused ? 'project.receiptFlow.paused' : stageStartsWithEvidence(selectedStage, orderedStages, workflowOrigin) ? isContractor ? 'project.receiptFlow.evidenceFirstContractor' : 'project.receiptFlow.evidenceFirst' : isContractor ? 'project.receiptFlow.waitForUpdatesContractor' : 'project.receiptFlow.waitForUpdates')}
                isFinalStage={selectedStage.id === orderedStages[orderedStages.length - 1]?.id}
                onPaymentChanged={onPaymentChanged}
                onMarkSubstageComplete={handleSubstageApproval}
                onEvidenceUploaded={onEvidenceUploaded}
                onApproveStage={handleStageApproval}
                renderEvidenceUpload={renderEvidenceUpload}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {certificate?.projectId === projectId && <DocumentViewer name={certificate.name} url={certificate.url} onClose={() => setCertificate(null)} />}

    </div>
  );
}
