import { useRef, useState } from 'react';
import { Check, Lock, Clock, Camera, Loader2, Receipt } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { EvidenceThumbs } from '@/components/project/EvidenceThumbs';
import { InlineReceiptUploader } from '@/components/project/InlineReceiptUploader';
import type { ProjectSubstageRow, SubstageStatus } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { errorMessage } from '@/lib/errors';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

// ── Status icon ───────────────────────────────────────────

// Rounded SQUARE, not a circle — Design B's check-marks are checkboxes, and a
// checkbox reads as "this is a thing that gets ticked off" in a way a status dot
// does not. The distinct states are kept: a lock and an awaiting-review clock say
// more than an empty box, and the camera marks evidence uploaded but not yet
// submitted, which is the state a contractor most often needs to see.
function StatusIcon({ status, hasEvidence }: { status: SubstageStatus; hasEvidence: boolean }) {
  const box = 'flex size-4 shrink-0 items-center justify-center rounded border-[1.5px]';

  if (status === 'complete') {
    return (
      <span className={cn(box, 'border-brand-green bg-brand-green')}>
        <Check className="size-2.5 text-white" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === 'pending_review') {
    return (
      <span className={cn(box, 'border-brand-near-black bg-brand-off-white')}>
        <Clock className="size-2.5 text-brand-near-black" />
      </span>
    );
  }
  if (status === 'locked') {
    return <span className={cn(box, 'border-brand-border-grey')}><Lock className="size-2 text-brand-border-grey" /></span>;
  }
  if (hasEvidence) {
    return <span className={cn(box, 'border-brand-near-black')}><Camera className="size-2.5 text-brand-near-black" /></span>;
  }
  // No evidence yet: keep the cue quiet until there is something to review.
  return <span className={cn(box, 'border-brand-border-grey')} />;
}

// ── Evidence thumbnails (inline, compact) ─────────────────

/**
 * The evidence on a substage, openable.
 *
 * These were `<span>`s — the client could see that seven photographs existed and could
 * not look at one of them, which is most of the point of evidence. Reported directly:
 * "the evidence here in each stage and substage should also be clickable for the client
 * to see."
 *
 * The `evidence` bucket is private and has no public path, so each file is signed on
 * demand and the link lasts an hour. Signed on click rather than on render: a stage with
 * twenty photographs would otherwise mint twenty capabilities nobody opens.
 */
/**
 * The evidence on a substage.
 *
 * Was a row of "Photo 1 · File 2 · Photo 3" pills, which carried no information:
 * nobody is looking for photo 4, they are looking for the one with the rebar in it.
 * Tiles answer that without a click.
 */
function EvidencePills({ urls, review = false }: { urls: string[]; review?: boolean }) {
  return <EvidenceThumbs paths={urls} size={review ? 'review' : 'compact'} />;
}

// ── Substage row ──────────────────────────────────────────

interface SubstageReceiptAction {
  projectId: string;
  stageId: string;
  splitByPart: boolean;
  initialAmount?: string;
  initialCurrency?: string;
  remainingDue?: number | null;
  requestedLabel?: string | null;
  onUploaded: () => void | Promise<void>;
}

interface SubstageRowProps {
  substage: ProjectSubstageRow;
  tier: string;
  userId: string;
  isStageActive: boolean;
  stagePaid?: boolean;
  /** Project assignment permission, independent of the client's approval permission. */
  canUploadEvidence?: boolean;
  approvalContext?: { projectName: string; stageName: string; description: string; lastUpdate: boolean };
  /** Inline per-substage receipt upload action for Homeowners (mirrors contractor's right-side buttons). */
  receiptAction?: SubstageReceiptAction;
  compactEvidence?: boolean;
  onMarkComplete?: (substageId: string) => Promise<void>;
  onEvidenceUploaded: (substageId: string, urls: string[]) => void;
  /** Render the EvidenceUpload component lazily — passed as a render prop to avoid circular deps */
  renderEvidenceUpload: (props: {
    substageId: string;
    existingUrls: string[];
    onUploadComplete: (urls: string[]) => void;
  }) => React.ReactNode;
}

export function SubstageRow({
  substage,
  tier,
  userId,
  isStageActive,
  stagePaid = true,
  canUploadEvidence = false,
  approvalContext,
  receiptAction,
  compactEvidence = false,
  onMarkComplete,
  onEvidenceUploaded,
  renderEvidenceUpload,
}: SubstageRowProps) {
  const { substageLabel } = useStageLabels();
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markingRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const clientPresentation = !!approvalContext;

  const hasEvidence = substage.evidence_urls.length > 0;
  const isLocked    = substage.status === 'locked';
  const t           = useT();
  const isComplete  = substage.status === 'complete';
  const isPendingReview = substage.status === 'pending_review';
  const canMarkComplete = !!onMarkComplete && hasEvidence && !isComplete && !isLocked && isStageActive && stagePaid;

  async function handleMarkComplete() {
    if (markingRef.current) return;
    markingRef.current = true;
    setError(null);
    setMarking(true);
    try {
      await onMarkComplete!(substage.id);
      setConfirmOpen(false);
    } catch (err) {
      setError(errorMessage(err, t('project.stages.updateFailed')));
    } finally {
      markingRef.current = false;
      setMarking(false);
    }
  }

  return (
    <div id={`substage-${substage.id}`} className={cn(
      clientPresentation ? compactEvidence ? 'group flex min-w-0 items-start gap-3 rounded-lg border border-brand-border-grey bg-white p-3' : 'group flex min-w-0 items-start gap-3 rounded-xl border border-brand-border-grey bg-white p-4 sm:p-5' : 'flex items-start gap-3 py-2.5 group',
      isLocked && 'opacity-50',
    )}>
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={substage.status} hasEvidence={hasEvidence} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className={cn(
              clientPresentation ? 'text-sm font-semibold leading-relaxed' : 'text-xs leading-snug',
              isComplete
                ? clientPresentation ? 'text-brand-near-black' : 'line-through text-brand-mid-grey'
                : isLocked
                  ? 'text-brand-mid-grey'
                  : 'text-brand-near-black font-medium',
            )}>
              {substageLabel(substage)}
            </span>
            {receiptAction?.requestedLabel && (
              <span className="mt-1 block">
                <span className="inline-block rounded-full bg-state-held/12 px-2 py-0.5 text-[11px] font-semibold text-state-held">
                  {receiptAction.requestedLabel}
                </span>
              </span>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {/* Status chips */}
            {isPendingReview && (
              <span className="shrink-0 inline-flex items-center rounded-full border border-brand-border-grey bg-brand-off-white px-2 py-px text-[9px] font-medium text-brand-near-black whitespace-nowrap">
                {t('project.stages.badgeYourApproval')}
              </span>
            )}
            {isComplete && substage.approved_by && (
              <span className="shrink-0 text-[9px] text-brand-mid-grey whitespace-nowrap">
                {t('project.stages.approved')}
              </span>
            )}
            {receiptAction && !isComplete && !isLocked && (
              <button
                type="button"
                data-action="substage-upload-receipt"
                aria-expanded={receiptOpen}
                onClick={() => setReceiptOpen(open => !open)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-green-hover"
              >
                <Receipt className="size-3.5" aria-hidden />
                {t('project.clientUi.uploadReceipt')}
              </button>
            )}
          </div>
        </div>

        {receiptAction && receiptOpen && !isComplete && !isLocked && (
          <InlineReceiptUploader
            projectId={receiptAction.projectId}
            stageId={receiptAction.stageId}
            substageId={substage.id}
            substageName={substageLabel(substage)}
            splitByPart={receiptAction.splitByPart}
            initialAmount={receiptAction.initialAmount}
            initialCurrency={receiptAction.initialCurrency}
            remainingDue={receiptAction.remainingDue}
            onUploaded={async () => {
              setReceiptOpen(false);
              await receiptAction.onUploaded();
            }}
            onCancel={() => setReceiptOpen(false)}
          />
        )}

        {!hasEvidence && !isComplete && !isLocked && <p className="mt-1 text-xs text-brand-mid-grey">{t('project.review.updatesWillAppear')}</p>}
        {/* Evidence pills */}
        {!compactEvidence && <EvidencePills urls={substage.evidence_urls} review={clientPresentation} />}

        {/* Evidence upload (active, non-complete substages, paid) */}
        <AnimatePresence>
          {canUploadEvidence && isStageActive && !isComplete && !isPendingReview && stagePaid && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden"
            >
              {renderEvidenceUpload({
                substageId: substage.id,
                existingUrls: substage.evidence_urls,
                onUploadComplete: (urls) => onEvidenceUploaded(substage.id, urls),
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mark Complete button */}
        <AnimatePresence>
          {canMarkComplete && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-2"
            >
              <button
                type="button"
                onClick={approvalContext ? () => { setError(null); setConfirmOpen(true); } : handleMarkComplete}
                disabled={marking}
                className={cn('inline-flex items-center gap-1.5 rounded-lg border border-brand-green bg-brand-green font-semibold text-white transition-colors hover:bg-brand-green-hover disabled:opacity-50', clientPresentation ? 'min-h-11 px-4 py-2.5 text-xs' : 'px-3 py-1.5 text-[11px]')}
              >
                {marking ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" strokeWidth={3} />
                )}
                {t('project.stages.approveEvidence')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <p className="mt-1.5 text-[11px] text-state-alert">{error}</p>
        )}
      </div>
      {approvalContext && <ConfirmModal open={confirmOpen} variant="client" title={t('project.clientUi.approveUpdate')}
        eyebrow={`${approvalContext.projectName} · ${approvalContext.stageName}`} description={approvalContext.description}
        confirmLabel={t('project.clientUi.confirmApproval')} cancelLabel={t('common.cancel')}
        error={error} loading={marking} onConfirm={() => { if (canMarkComplete) return handleMarkComplete(); }}
        onCancel={() => { if (!markingRef.current) setConfirmOpen(false); }}>
        <div className="space-y-3">
          <EvidenceThumbs paths={substage.evidence_urls.slice(0, 3)} size="review" />
          <h3 className="text-base font-semibold text-brand-near-black">{substageLabel(substage)}</h3>
        </div>
      </ConfirmModal>}
    </div>
  );
}
