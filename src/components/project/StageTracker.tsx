import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { SubstageRow } from './SubstageRow';
import type { ProjectStageRow, ProjectSubstageRow, StageStatus } from '@/types/project';
import { formatUSD } from '@/lib/budget';

// ── Stage dot ─────────────────────────────────────────────

function StageDot({ status }: { status: StageStatus }) {
  if (status === 'complete') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-near-black z-10">
        <Check className="size-3 text-white" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'active' || status === 'pending_review') {
    return (
      <span className="relative flex size-6 shrink-0 items-center justify-center z-10">
        <span className="absolute size-6 rounded-full bg-brand-near-black opacity-20 animate-ping" />
        <span className="relative size-4 rounded-full bg-brand-near-black" />
      </span>
    );
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-brand-border-grey bg-white z-10" />
  );
}

// ── Stage status badge ────────────────────────────────────

function StageBadge({ status }: { status: StageStatus }) {
  const map: Record<StageStatus, { label: string; className: string }> = {
    active:         { label: 'Active',     className: 'bg-brand-near-black text-white' },
    pending_review: { label: 'In Review',  className: 'border border-brand-border-grey text-brand-mid-grey' },
    complete:       { label: 'Complete',   className: 'bg-brand-off-white border border-brand-border-grey text-brand-mid-grey' },
    locked:         { label: 'Locked',     className: 'text-brand-mid-grey' },
  };
  const { label, className } = map[status];
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide',
      className,
    )}>
      {label}
    </span>
  );
}

// ── Approve stage button (tier-aware) ─────────────────────

interface ApproveButtonProps {
  tier: string;
  stageNumber: number;
  onApprove: () => void;
  loading: boolean;
}

function ApproveButton({ tier, stageNumber, onApprove, loading }: ApproveButtonProps) {
  if (tier === 'enterprise_custom' || tier === 'jalla_management' || tier === 'enterprise') {
    return (
      <p className="mt-3 text-xs text-brand-mid-grey leading-relaxed">
        This stage is managed by Jalla. Progress will be updated by your project manager.
      </p>
    );
  }

  const label = (tier === 'self_verify' || tier === 'starter')
    ? `Approve Stage ${stageNumber}`
    : `Request Verification`;

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

// ── Stage row ─────────────────────────────────────────────

interface StageRowProps {
  stage: ProjectStageRow;
  substages: ProjectSubstageRow[];
  isLast: boolean;
  isOpen: boolean;
  onToggle: () => void;
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

function StageRow({
  stage, substages, isLast, isOpen, onToggle,
  tier, userId, isContractor,
  onMarkSubstageComplete, onEvidenceUploaded, onApproveStage,
  renderEvidenceUpload,
}: StageRowProps) {
  const [confirmOpen, setConfirmOpen]     = useState(false);
  const [approving,   setApproving]       = useState(false);

  const isInteractive = stage.status !== 'locked';

  const allSubstagesReady = substages.length > 0 && substages.every(sub =>
    (tier === 'self_verify' || tier === 'starter')
      ? sub.status === 'complete'
      : sub.status === 'pending_review' || sub.status === 'complete',
  );

  const showApproveButton =
    !isContractor &&
    stage.status === 'active' &&
    allSubstagesReady &&
    tier !== 'enterprise_custom' &&
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
    <div className="relative flex gap-4">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-3 top-6 bottom-0 w-px bg-brand-border-grey" />
      )}

      <div className="relative z-10 mt-1 shrink-0">
        <StageDot status={stage.status} />
      </div>

      <div className="flex-1 pb-5 min-w-0">
        {/* Stage header */}
        <button
          type="button"
          disabled={!isInteractive}
          onClick={onToggle}
          className={cn(
            'w-full text-left flex items-start justify-between gap-3',
            isInteractive ? 'cursor-pointer' : 'cursor-default',
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'text-[11px] font-medium',
                stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black',
              )}>
                Stage {stage.stage_number}
              </span>
              <StageBadge status={stage.status} />
            </div>
            <p className={cn(
              'text-sm font-semibold mt-0.5 leading-snug',
              stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black',
            )}>
              {stage.name}
            </p>
          </div>

          <div className="flex items-center gap-2 mt-0.5 shrink-0">
            <span className="text-xs text-brand-mid-grey tabular-nums whitespace-nowrap">
              {formatUSD(stage.payment_milestone_usd ?? 0)}&nbsp;
              <span className="text-[10px]">({stage.budget_pct}%)</span>
            </span>
            {isInteractive && (
              <ChevronDown className={cn(
                'size-4 text-brand-mid-grey transition-transform duration-200 shrink-0',
                isOpen ? 'rotate-180' : '',
              )} />
            )}
          </div>
        </button>

        {/* Substage list + approve */}
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3 pl-1 divide-y divide-brand-border-grey/60">
                {substages.map(sub => (
                  <SubstageRow
                    key={sub.id}
                    substage={sub}
                    tier={tier}
                    userId={userId}
                    isStageActive={stage.status === 'active'}
                    onMarkComplete={isContractor ? undefined : onMarkSubstageComplete}
                    onEvidenceUploaded={onEvidenceUploaded}
                    renderEvidenceUpload={renderEvidenceUpload}
                  />
                ))}
              </div>

              {showApproveButton && (
                <ApproveButton
                  tier={tier}
                  stageNumber={stage.stage_number}
                  onApprove={() => setConfirmOpen(true)}
                  loading={approving}
                />
              )}

              {(tier === 'enterprise_custom' || tier === 'jalla_management' || tier === 'enterprise') && stage.status === 'active' && (
                <p className="mt-3 text-xs text-brand-mid-grey leading-relaxed">
                  This stage is managed by Jalla. Progress will be updated by your project manager.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={(tier === 'self_verify' || tier === 'starter') ? 'Approve this stage?' : 'Request verification?'}
        description={
          (tier === 'self_verify' || tier === 'starter')
            ? 'This will mark the stage complete, release the milestone payment, and unlock the next stage.'
            : 'This will submit all your evidence for Jalla review. You\'ll be notified once approved or if changes are needed.'
        }
        confirmLabel={(tier === 'self_verify' || tier === 'starter') ? 'Approve Stage' : 'Submit for Review'}
        loading={approving}
        onConfirm={handleApprove}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

// ── StageTracker ──────────────────────────────────────────

interface StageTrackerProps {
  stages: ProjectStageRow[];
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

export function StageTracker({
  stages, substages, tier, userId, isContractor,
  onMarkSubstageComplete, onEvidenceUploaded, onApproveStage,
  renderEvidenceUpload,
}: StageTrackerProps) {
  const activeStage = stages.find(s => s.status === 'active');
  const [openStage, setOpenStage] = useState<number | null>(activeStage?.stage_number ?? null);

  const completedCount = stages.filter(s => s.status === 'complete').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-brand-near-black">Construction Pipeline</p>
        {stages.length > 0 && (
          <span className="text-xs text-brand-mid-grey tabular-nums">
            {completedCount} / {stages.length} complete
          </span>
        )}
      </div>

      <div className="rounded-xl border border-brand-border-grey px-5 py-6 overflow-x-auto">
        <div className="min-w-[280px]">
          {stages.map((stage, i) => (
            <StageRow
              key={stage.id}
              stage={stage}
              substages={substages.filter(sub => sub.stage_id === stage.id)}
              isLast={i === stages.length - 1}
              isOpen={openStage === stage.stage_number}
              onToggle={() => setOpenStage(prev =>
                prev === stage.stage_number ? null : stage.stage_number,
              )}
              tier={tier}
              userId={userId}
              isContractor={isContractor}
              onMarkSubstageComplete={onMarkSubstageComplete}
              onEvidenceUploaded={onEvidenceUploaded}
              onApproveStage={onApproveStage}
              renderEvidenceUpload={renderEvidenceUpload}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
