import { Check } from 'lucide-react';
import type { ProjectStageRow } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { cn } from '@/lib/utils';

// =========================================================
// The spine of the contractor surface: a build's stages, left to right.
//
// Approved 29 Oct 2026. One shape, used on the dashboard, the project list and the
// top of every project tab, because it is also the shape the CLIENT sees — a phone
// call about progress then starts from a shared picture rather than two different
// pictures of the same build.
//
// It renders whatever stages it is handed. Ten is the usual seed, but a project with
// a different count (a partner's half-built job, a bungalow) gets its own count and
// no gaps: nothing here hard-codes 10.
//
// There is no "needs action" list anywhere in this surface. The open dot IS the work.
// A second list of the same truth would be free to disagree with it.
// =========================================================

/** Where a stage sits relative to the one being worked. Drives nothing but colour. */
type Position = 'done' | 'now' | 'todo';

function positionOf(stage: ProjectStageRow, currentNumber: number | null): Position {
  // `pre_existing` is complete too — work finished before the build joined Groundwork
  // (see tracking.ts). It carries no payment and no certificate, but on the spine it
  // is behind you, which is all this component says.
  if (stage.status === 'complete') return 'done';
  if (currentNumber !== null && stage.stage_number === currentNumber) return 'now';
  if (currentNumber !== null && stage.stage_number < currentNumber) return 'done';
  return 'todo';
}

/**
 * The stage a contractor is standing in: the active one, else the one waiting on a
 * verifier. Mirrors `activeOf()` in contractor-work.ts — a build with neither (all
 * complete, or not started) simply has no lit dot.
 */
export function currentStageNumber(stages: ProjectStageRow[]): number | null {
  const current = stages.find(s => s.status === 'active')
               ?? stages.find(s => s.status === 'pending_review');
  return current?.stage_number ?? null;
}

export function StagePipeline({ stages, labels = false, size = 'sm', className }: {
  stages: ProjectStageRow[];
  /** Name each stage under its dot. Only where there is room — never on a phone. */
  labels?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { stageLabel } = useStageLabels();
  const current = currentStageNumber(stages);

  // A project whose stages have not been seeded yet has nothing to draw. An empty
  // strip of grey dots would claim a shape this build does not have.
  if (stages.length === 0) return null;

  const dot = size === 'md' ? 'size-5 text-[10px]' : 'size-[18px] text-[9px]';
  const railTop = size === 'md' ? 'top-[9px]' : 'top-2';

  return (
    <ol className={cn('flex min-w-0', className)}
        aria-label={`Stage ${current ?? '–'} of ${stages.length}`}>
      {stages.map((stage, i) => {
        const at = positionOf(stage, current);
        const name = stageLabel(stage);
        return (
          <li key={stage.id} className="relative min-w-0 flex-1 text-center"
              aria-current={at === 'now' ? 'step' : undefined}>
            {/* The rail into this dot from the one before it. */}
            {i > 0 && (
              <span aria-hidden className={cn(
                'absolute -left-1/2 h-0.5 w-full', railTop,
                at === 'todo' ? 'bg-brand-border-grey dark:bg-[#2c2c2c]' : 'bg-state-complete',
              )} />
            )}
            <span className={cn(
              'relative z-[1] mx-auto flex items-center justify-center rounded-full border-2 font-mono font-semibold tabular-nums',
              dot,
              at === 'done' && 'border-state-complete bg-state-complete text-white',
              at === 'now'  && 'border-state-complete bg-white text-state-complete ring-[3px] ring-state-complete/15 dark:bg-[#1e1e1e]',
              at === 'todo' && 'border-brand-border-grey bg-white text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]',
            )}>
              {at === 'done'
                ? <Check className="size-2.5 stroke-[3]" aria-hidden />
                : stage.stage_number}
            </span>
            {labels && (
              <span className={cn(
                'mt-1.5 block break-words px-px text-[9px] leading-tight',
                at === 'now'
                  ? 'font-semibold text-brand-near-black dark:text-white'
                  : 'text-brand-mid-grey',
              )}>
                {name}
              </span>
            )}
            {/* The dots alone are decoration to a screen reader; the names are not. */}
            {!labels && <span className="sr-only">{name}</span>}
          </li>
        );
      })}
    </ol>
  );
}
