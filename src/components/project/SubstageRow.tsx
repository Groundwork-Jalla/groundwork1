import { useState } from 'react';
import { Check, Lock, Clock, Camera, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ProjectSubstageRow, SubstageStatus } from '@/types/project';

// ── Status icon ───────────────────────────────────────────

function StatusIcon({ status, hasEvidence }: { status: SubstageStatus; hasEvidence: boolean }) {
  if (status === 'complete') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-near-black">
        <Check className="size-2.5 text-white" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === 'pending_review') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-amber-400 bg-amber-50">
        <Clock className="size-2.5 text-amber-500" />
      </span>
    );
  }
  if (status === 'locked') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-brand-border-grey">
        <Lock className="size-2 text-brand-border-grey" />
      </span>
    );
  }
  if (hasEvidence) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-brand-near-black">
        <Camera className="size-2.5 text-brand-near-black" />
      </span>
    );
  }
  // pending / in_progress
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <span className="absolute size-4 rounded-full border border-brand-near-black opacity-30 animate-ping" />
      <span className="relative size-2.5 rounded-full border-2 border-brand-near-black" />
    </span>
  );
}

// ── Evidence thumbnails (inline, compact) ─────────────────

function EvidencePills({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
      {urls.map((url, i) => {
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-brand-off-white border border-brand-border-grey px-2 py-0.5 text-[10px] text-brand-mid-grey"
          >
            <Camera className="size-2.5 shrink-0" />
            {isImage ? `Photo ${i + 1}` : `File ${i + 1}`}
          </span>
        );
      })}
    </div>
  );
}

// ── Substage row ──────────────────────────────────────────

interface SubstageRowProps {
  substage: ProjectSubstageRow;
  tier: string;
  userId: string;
  isStageActive: boolean;
  onMarkComplete: (substageId: string) => Promise<void>;
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
  onMarkComplete,
  onEvidenceUploaded,
  renderEvidenceUpload,
}: SubstageRowProps) {
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasEvidence = substage.evidence_urls.length > 0;
  const isLocked    = substage.status === 'locked';
  const isComplete  = substage.status === 'complete';
  const isPendingReview = substage.status === 'pending_review';
  const canMarkComplete = hasEvidence && !isComplete && !isPendingReview && isStageActive;

  async function handleMarkComplete() {
    setError(null);
    setMarking(true);
    try {
      await onMarkComplete(substage.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update.');
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
            {substage.name}
          </span>

          {/* Status chips */}
          {isPendingReview && (
            <span className="shrink-0 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-px text-[9px] font-medium text-amber-600 whitespace-nowrap">
              Awaiting review
            </span>
          )}
          {tier !== 'starter' && tier !== 'pro' && isComplete && substage.approved_by && (
            <span className="shrink-0 text-[9px] text-brand-mid-grey whitespace-nowrap">
              Verified
            </span>
          )}
        </div>

        {/* Evidence pills */}
        <EvidencePills urls={substage.evidence_urls} />

        {/* Evidence upload (active, non-complete substages) */}
        <AnimatePresence>
          {isStageActive && !isComplete && !isPendingReview && (
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
                {tier === 'starter'
                  ? 'Mark complete'
                  : 'Mark ready for review'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <p className="mt-1.5 text-[11px] text-red-500">{error}</p>
        )}
      </div>
    </div>
  );
}
