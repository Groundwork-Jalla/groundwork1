import { Link } from 'react-router';
import type { StageView } from '@/lib/admin/workspace';
import { workspaceHref } from '@/lib/admin/workspace-params';
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

export function StageLadder({ projectId, stages, selectedId }: {
  projectId: string;
  stages: StageView[];
  selectedId: string | null;
}) {
  const { stageLabel } = useStageLabels();
  return (
    <ol className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
      {stages.map(view => {
        const active = view.stage.id === selectedId;
        return (
          <li key={view.stage.id}>
            <Link
              to={workspaceHref(projectId, { tab: 'overview', stageId: view.stage.id })}
              replace
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex items-center gap-3 px-5 py-2.5 transition-colors',
                active
                  ? 'bg-brand-off-white dark:bg-[#252525]'
                  : 'hover:bg-brand-off-white dark:hover:bg-[#252525]',
              )}
            >
              <span className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums',
                active
                  ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
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
