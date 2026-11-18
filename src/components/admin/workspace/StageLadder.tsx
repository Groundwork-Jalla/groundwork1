import { Link } from 'react-router';
import type { StageView } from '@/lib/admin/workspace';
import { workspaceHref, type WorkspaceTab } from '@/lib/admin/workspace-params';
import { StageLifecycleBadge } from './StageLifecycleBadge';
import { useStageLabels } from '@/lib/stage-labels';
import { cn } from '@/lib/utils';

// =========================================================
// The stage ladder (05 §6 Overview): every stage in order, each with its derived state.
//
// Selecting a stage is a link — `?tab=overview&stage=<id>` — so the selection is in the
// URL, shareable, and survives a reload (05 §5). No component state, no nested route.
//
// Each row's badge receives `view.lifecycle` exactly as the loader assembled it. Nothing
// here reads `payment_status` or decides a state; the ladder is the lifecycle, listed.
// =========================================================

export function StageLadder({ projectId, stages, selectedId, tab = 'overview' }: {
  projectId: string;
  stages: StageView[];
  selectedId: string | null;
  /** The tab a row selects within — the Overview by default, the Stages tab on itself. */
  tab?: WorkspaceTab;
}) {
  const { stageLabel } = useStageLabels();
  return (
    <ol className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
      {stages.map(view => {
        const active = view.stage.id === selectedId;
        return (
          <li key={view.stage.id}>
            <Link
              to={workspaceHref(projectId, { tab, stageId: view.stage.id })}
              replace
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex items-center gap-3 px-5 py-2.5 transition-colors',
                active
                  ? 'bg-[#f3f6f4] shadow-[inset_3px_0_0_var(--color-brand-green)] dark:bg-[#1c2620]'
                  : 'hover:bg-brand-off-white dark:hover:bg-[#252525]',
              )}
            >
              <span className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums',
                active
                  ? 'border-2 border-brand-green text-brand-green dark:border-state-complete dark:text-state-complete'
                  : view.stage.status === 'complete'
                    ? 'border-brand-green bg-brand-green text-white dark:border-state-complete dark:bg-state-complete'
                    : 'border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]',
              )}>
                {view.stage.stage_number}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm', active ? 'font-semibold text-brand-near-black dark:text-white' : 'font-medium text-brand-near-black dark:text-white')}>
                  {stageLabel(view.stage)}
                </span>
                <StageLifecycleBadge lifecycle={view.lifecycle} size="small" className="mt-0.5" />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
