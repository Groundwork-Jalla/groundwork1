import { PauseCircle } from 'lucide-react';
import type { StageLifecycle } from '@/lib/lifecycle/stage';
import { badgeModel } from '@/lib/admin/lifecycle-badge';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// StageLifecycleBadge — one derived lifecycle, rendered (05 §7).
//
//   StageView.lifecycle  →  badgeModel()  →  dot · word · (blocker) · [on hold]
//
// The component contains no decisions. Which word, which accent and which blocker are
// settled in `lib/admin/lifecycle-badge.ts` from the `{ state, blockers }` that
// `stageLifecycle()` produced; this file only puts the result on screen. It never reads a
// stage row, a verification or the ledger, so it cannot disagree with the Action Center
// about what a stage is.
//
// Same treatment as `StatusBadge`: a 6px dot and the word in the state's colour, no
// tinted pill. Used in the workspace header, the Overview ladder, the Stages tab and
// (Phase 7) the queues, at two sizes.
// =========================================================

export function StageLifecycleBadge({ lifecycle, size = 'default', showBlocker = true, className }: {
  lifecycle: StageLifecycle;
  size?: 'default' | 'small';
  /** Name the primary blocker after the state ("Approved · awaiting funding"). */
  showBlocker?: boolean;
  className?: string;
}) {
  const t = useT();
  const m = badgeModel(lifecycle);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        size === 'small' ? 'text-[11px]' : 'text-xs',
        m.emphasis ? 'font-semibold' : 'font-medium',
        m.text,
        className,
      )}
      data-lifecycle={m.state}
      title={m.known ? undefined : m.state}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', m.dot)} />
      {t(m.labelKey)}
      {showBlocker && m.blockerKey && (
        <span className="font-normal text-brand-mid-grey">· {t(m.blockerKey)}</span>
      )}
      {m.onHold && (
        // The project's hold, overlaid on every stage: the same mark whatever the state.
        <span className="inline-flex items-center gap-1 font-normal text-state-held" title={t('admin.lifecycle.blocker.on_hold')}>
          <PauseCircle className="size-3" aria-hidden="true" />
          {t('admin.lifecycle.blocker.on_hold')}
        </span>
      )}
    </span>
  );
}

/** The dot alone — for the ladder's ten chips and dense rows. */
export function StageLifecycleDot({ lifecycle, className }: { lifecycle: StageLifecycle; className?: string }) {
  const m = badgeModel(lifecycle);
  return <span aria-hidden="true" data-lifecycle={m.state} className={cn('size-1.5 shrink-0 rounded-full', m.dot, className)} />;
}
