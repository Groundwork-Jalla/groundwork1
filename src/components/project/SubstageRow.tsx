import { useState } from 'react';
import { Check, Lock, Clock, Camera, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { EvidenceLightbox } from '@/components/project/EvidenceLightbox';
import { Button } from '@/components/ui/button';
import type { ProjectSubstageRow, SubstageStatus } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { errorMessage } from '@/lib/errors';

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
      <span className={cn(box, 'border-brand-near-black bg-brand-near-black')}>
        <Check className="size-2.5 text-white" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === 'pending_review') {
    return (
      <span className={cn(box, 'border-state-held bg-brand-off-white')}>
        <Clock className="size-2.5 text-state-held" />
      </span>
    );
  }
  if (status === 'locked') {
    return <span className={cn(box, 'border-brand-border-grey')}><Lock className="size-2 text-brand-border-grey" /></span>;
  }
  if (hasEvidence) {
    return <span className={cn(box, 'border-brand-near-black')}><Camera className="size-2.5 text-brand-near-black" /></span>;
  }
  // pending / in_progress — an empty box, pulsing so the next action is findable.
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <span className="absolute size-4 rounded border-[1.5px] border-brand-near-black opacity-30 animate-ping" />
      <span className={cn(box, 'relative border-brand-border-grey')} />
    </span>
  );
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
function EvidencePills({ urls }: { urls: string[] }) {
  const t = useT();
  const [at, setAt] = useState<number | null>(null);
  if (urls.length === 0) return null;

  // One viewer for the whole substage, so the arrows and a swipe move between the
  // photographs of THIS piece of work — which is the set somebody is actually looking
  // through. Opening file 3 starts there rather than at the beginning.
  const items = urls.map((url, i) => ({
    path: url,
    label: /\.(jpg|jpeg|png|gif|webp)$/i.test(url)
      ? t('project.stages.photoN', { n: i + 1 })
      : t('project.stages.fileN', { n: i + 1 }),
  }));

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
        {items.map((item, i) => (
          <button
            key={item.path}
            type="button"
            onClick={() => setAt(i)}
            title={t('project.stages.openEvidence', { name: item.label })}
            className="inline-flex items-center gap-1 rounded-full bg-brand-off-white border border-brand-border-grey px-2 py-0.5 text-[10px] text-brand-mid-grey transition-colors hover:border-brand-near-black hover:text-brand-near-black dark:bg-[#2c2c2c] dark:border-[#444] dark:hover:text-white"
          >
            <Camera className="size-2.5 shrink-0" />
            {item.label}
          </button>
        ))}
      </div>
      {at !== null && (
        <EvidenceLightbox items={items} index={at} onIndex={setAt} onClose={() => setAt(null)} />
      )}
    </>
  );
}

// ── Substage row ──────────────────────────────────────────

interface SubstageRowProps {
  substage: ProjectSubstageRow;
  tier: string;
  userId: string;
  isStageActive: boolean;
  stagePaid?: boolean;
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
  onMarkComplete,
  onEvidenceUploaded,
  renderEvidenceUpload,
}: SubstageRowProps) {
  const { substageLabel } = useStageLabels();
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasEvidence = substage.evidence_urls.length > 0;
  const isLocked    = substage.status === 'locked';
  const t           = useT();
  const isComplete  = substage.status === 'complete';
  const isPendingReview = substage.status === 'pending_review';
  const canMarkComplete = !!onMarkComplete && hasEvidence && !isComplete && !isPendingReview && isStageActive;

  async function handleMarkComplete() {
    setError(null);
    setMarking(true);
    try {
      await onMarkComplete!(substage.id);
    } catch (err) {
      setError(errorMessage(err, t('project.stages.updateFailed')));
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className={cn(
      'flex items-start gap-3 py-2.5 group',
      isLocked && 'opacity-50',
    )}>
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={substage.status} hasEvidence={hasEvidence} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className={cn(
            'text-xs leading-snug',
            isComplete
              ? 'line-through text-brand-mid-grey'
              : isLocked
                ? 'text-brand-mid-grey'
                : 'text-brand-near-black font-medium',
          )}>
            {substageLabel(substage)}
          </span>

          {/* Status chips */}
          {isPendingReview && (
            <span className="shrink-0 inline-flex items-center rounded-full border border-state-held/30 bg-brand-off-white px-2 py-px text-[9px] font-medium text-state-held whitespace-nowrap">
              {t('project.stages.awaitingReview')}
            </span>
          )}
          {tier !== 'starter' && tier !== 'pro' && isComplete && substage.approved_by && (
            <span className="shrink-0 text-[9px] text-brand-mid-grey whitespace-nowrap">
              {t('project.stages.verified')}
            </span>
          )}
        </div>

        {/* Evidence pills */}
        <EvidencePills urls={substage.evidence_urls} />

        {/* Evidence upload (active, non-complete substages, paid) */}
        <AnimatePresence>
          {isStageActive && !isComplete && !isPendingReview && stagePaid && (
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
                onClick={handleMarkComplete}
                disabled={marking}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-near-black px-3 py-1.5 text-[11px] font-semibold text-brand-near-black hover:bg-brand-near-black hover:text-white transition-colors disabled:opacity-50"
              >
                {marking ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" strokeWidth={3} />
                )}
                {/* What the button does depends on who checks the work.
                    On `jalla_verify` / `jalla_management` an independent verifier looks
                    at it, so "ready for review" is literally true. On `self_verify`
                    nobody else reviews it — the client is signing off their own
                    evidence — and calling that "ready for review" implies a reviewer who
                    does not exist. `starter` keeps its plainer wording. */}
                {tier === 'starter'      ? t('project.stages.markComplete')
                 : tier === 'self_verify' ? t('project.stages.approveEvidence')
                 : t('project.stages.markReady')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <p className="mt-1.5 text-[11px] text-state-alert">{error}</p>
        )}
      </div>
    </div>
  );
}
