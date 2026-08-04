import { lazy, Suspense, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Download, Loader2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { SubstageRow } from './SubstageRow';
import type { ProjectStageRow, ProjectSubstageRow, StageStatus } from '@/types/project';
import { formatUSD } from '@/lib/budget';
import { useT, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';

// Lazy-loaded so the certificate HTML is not bundled into the main chunk
const StageCertificateModal = lazy(() =>
  import('./StageCertificateModal').then(m => ({ default: m.StageCertificateModal })),
);

// ── Stage circle (horizontal pipeline) ───────────────────

function StageCircle({
  status,
  number,
  selected,
}: {
  status: StageStatus;
  number: number;
  selected: boolean;
}) {
  const ring = selected
    ? 'ring-2 ring-offset-2 ring-brand-near-black'
    : '';

  if (status === 'complete') {
    return (
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-near-black transition-all',
          ring,
        )}
      >
        <Check className="size-3.5 text-white" strokeWidth={3} />
      </span>
    );
  }

  if (status === 'active' || status === 'pending_review') {
    return (
      <span
        className={cn(
          'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-near-black transition-all',
          ring,
        )}
      >
        <span className="absolute size-8 rounded-full bg-brand-near-black opacity-25 animate-ping" />
        <span className="relative text-[11px] font-bold text-white tabular-nums">{number}</span>
      </span>
    );
  }

  // locked
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-brand-border-grey bg-white transition-all',
        selected && 'border-brand-near-black ring-2 ring-offset-2 ring-brand-near-black',
      )}
    >
      <span className="text-[11px] font-medium text-brand-border-grey tabular-nums">{number}</span>
    </span>
  );
}

// ── Stage badge ────────────────────────────────────────────

function StageBadge({ status }: { status: StageStatus }) {
  const t = useT();
  const map: Record<StageStatus, { labelKey: TKey; className: string }> = {
    active:         { labelKey: 'project.stages.badgeActive',   className: 'bg-brand-near-black text-white' },
    pending_review: { labelKey: 'project.stages.badgeReview',   className: 'border border-brand-border-grey text-brand-mid-grey' },
    complete:       { labelKey: 'project.stages.badgeComplete', className: 'bg-brand-off-white border border-brand-border-grey text-brand-mid-grey' },
    locked:         { labelKey: 'project.stages.badgeLocked',   className: 'text-brand-mid-grey' },
  };
  const { labelKey, className } = map[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide',
        className,
      )}
    >
      {t(labelKey)}
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
  const label =
    tier === 'self_verify' || tier === 'starter'
      ? t('project.stages.approveStage', { n: stageNumber })
      : t('project.stages.requestVerify');

  return (
    <button
      type="button"
      onClick={onApprove}
      disabled={loading}
      className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold py-3 hover:bg-black transition-colors disabled:opacity-50"
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
  onMarkSubstageComplete,
  onEvidenceUploaded,
  onApproveStage,
  renderEvidenceUpload,
}: StageDetailProps) {
  const { stageLabel } = useStageLabels();
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving]     = useState(false);

  const allSubstagesReady =
    substages.length > 0 &&
    substages.every(sub =>
      tier === 'self_verify' || tier === 'starter'
        ? sub.status === 'complete'
        : sub.status === 'pending_review' || sub.status === 'complete',
    );

  const stagePaid = stage.payment_status === 'paid';

  const showApproveButton =
    !isContractor &&
    stage.status === 'active' &&
    allSubstagesReady &&
    stagePaid &&
    tier !== 'jalla_management' &&
    tier !== 'enterprise';

  async function handleApprove() {
    setApproving(true);
    try {
      await onApproveStage(stage.id, stage.stage_number);
    } finally {
      setApproving(false);
      setConfirmOpen(false);
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
            {formatUSD(stage.payment_milestone_usd ?? 0)}{' '}
            <span className="text-[10px]">({stage.budget_pct}%)</span>
          </span>
          <StageBadge status={stage.status} />
        </div>
      </div>

      {stage.status === 'locked' ? (
        <p className="text-sm text-brand-mid-grey">
          {t('project.stages.lockedBody')}
        </p>
      ) : (
        <>
          <div className="divide-y divide-brand-border-grey/60">
            {substages.map(sub => (
              <SubstageRow
                key={sub.id}
                substage={sub}
                tier={tier}
                userId={userId}
                isStageActive={stage.status === 'active'}
                stagePaid={stagePaid}
                onMarkComplete={isContractor ? undefined : onMarkSubstageComplete}
                onEvidenceUploaded={onEvidenceUploaded}
                renderEvidenceUpload={renderEvidenceUpload}
              />
            ))}
          </div>

          {stage.status === 'active' && !stagePaid && !isContractor && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 px-3 py-2.5">
              <Lock className="size-3.5 shrink-0 text-amber-500 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-snug">
                Payment required before uploading evidence or approving this stage. Record payment in the{' '}
                <span className="font-semibold">Payments</span> tab.
              </p>
            </div>
          )}

          {showApproveButton && (
            <ApproveButton
              tier={tier}
              stageNumber={stage.stage_number}
              onApprove={() => setConfirmOpen(true)}
              loading={approving}
            />
          )}

          {(tier === 'jalla_management' || tier === 'enterprise') &&
            stage.status === 'active' && (
              <p className="mt-3 text-xs text-brand-mid-grey leading-relaxed">
                {t('project.stages.managedNote')}
              </p>
            )}
        </>
      )}

      <ConfirmModal
        open={confirmOpen}
        title={
          tier === 'self_verify' || tier === 'starter'
            ? t('project.stages.confirmApproveTitle')
            : t('project.stages.confirmVerifyTitle')
        }
        description={
          tier === 'self_verify' || tier === 'starter'
            ? t('project.stages.confirmApproveBody')
            : t('project.stages.confirmVerifyBody')
        }
        confirmLabel={
          tier === 'self_verify' || tier === 'starter'
            ? t('project.stages.confirmApproveCta')
            : t('project.stages.confirmVerifyCta')
        }
        loading={approving}
        onConfirm={handleApprove}
        onCancel={() => setConfirmOpen(false)}
      />
    </motion.div>
  );
}

// ── StageTracker ──────────────────────────────────────────

export interface StageTrackerProps {
  stages: ProjectStageRow[];
  substages: ProjectSubstageRow[];
  tier: string;
  userId: string;
  isContractor?: boolean;
  projectName: string;
  projectCountry: string;
  projectCity: string | null;
  ownerName: string;
  onMarkSubstageComplete: (substageId: string) => Promise<void>;
  onEvidenceUploaded: (substageId: string, urls: string[]) => void;
  onApproveStage: (stageId: string, stageNumber: number) => Promise<void>;
  renderEvidenceUpload: (props: {
    substageId: string;
    existingUrls: string[];
    onUploadComplete: (urls: string[]) => void;
  }) => React.ReactNode;
}

function shortLabel(name: string): string {
  const words = name.split(/\s+/);
  const label = words.length <= 2 ? name : words.slice(0, 2).join(' ');
  return label.length > 13 ? label.slice(0, 12) + '…' : label;
}

export function StageTracker({
  stages,
  substages,
  tier,
  userId,
  isContractor,
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
  const activeStage = stages.find(
    s => s.status === 'active' || s.status === 'pending_review',
  );
  const [selectedNum, setSelectedNum] = useState<number>(
    activeStage?.stage_number ?? stages[0]?.stage_number ?? 1,
  );
  const [certStage, setCertStage] = useState<ProjectStageRow | null>(null);

  const selectedStage = stages.find(s => s.stage_number === selectedNum);
  const completedCount = stages.filter(s => s.status === 'complete').length;

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
            {stages.map((stage, i) => (
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
                    onClick={() => setSelectedNum(stage.stage_number)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg px-2 py-1 transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-1',
                      'hover:bg-white/70',
                    )}
                  >
                    <StageCircle
                      status={stage.status}
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
                      {shortLabel(stage.name)}
                    </span>
                  </button>

                  {stage.status === 'complete' && (
                    <button
                      type="button"
                      onClick={() => setCertStage(stage)}
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
                onMarkSubstageComplete={onMarkSubstageComplete}
                onEvidenceUploaded={onEvidenceUploaded}
                onApproveStage={onApproveStage}
                renderEvidenceUpload={renderEvidenceUpload}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Stage certificate modal */}
      <AnimatePresence>
        {certStage && (
          <Suspense fallback={null}>
            <StageCertificateModal
              stage={certStage}
              project={{
                name: projectName,
                country: projectCountry,
                city: projectCity,
                tier,
              }}
              ownerName={ownerName}
              onClose={() => setCertStage(null)}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  );
}
