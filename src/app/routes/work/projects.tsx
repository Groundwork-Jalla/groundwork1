import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2 } from 'lucide-react';
import { fetchAssignedProjects, type AssignedProject } from '@/lib/supabase/contractor-work';
import { StagePipeline, currentStageNumber } from '@/components/contractor/StagePipeline';
import { useProjectMoney } from '@/lib/budget/use-project-money';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Every build this contractor is on.
//
// Redesigned 29 Oct 2026. One row per build, and the row leads with the stage
// pipeline rather than a percentage bar: "47% done" tells a contractor nothing they
// can act on, whereas the lit dot is the stage they are standing in.
//
// The list is RLS-bounded — see contractor-work.ts. The filters below narrow what is
// already theirs; nothing here is access control.
// =========================================================

type Filter = 'all' | 'inProgress' | 'awaiting' | 'handedOver';

/** A build with every stage complete. Needs at least one stage to mean anything. */
function isHandedOver(a: AssignedProject): boolean {
  return a.totalStages > 0 && a.completedStages === a.totalStages;
}

function matches(a: AssignedProject, filter: Filter): boolean {
  switch (filter) {
    case 'inProgress':  return a.activeStage !== null;
    case 'awaiting':    return a.stages.some(s => s.status === 'pending_review');
    case 'handedOver':  return isHandedOver(a);
    default:            return true;
  }
}

export default function ContractorProjects() {
  const t = useT();
  const [projects, setProjects] = useState<AssignedProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let alive = true;
    fetchAssignedProjects()
      .then(p => { if (alive) setProjects(p); })
      .catch(() => { if (alive) { setProjects([]); setError(t('contractor.loadFailed')); } });
    return () => { alive = false; };
  }, [t]);

  const counts = useMemo(() => {
    const rows = projects ?? [];
    return {
      all:         rows.length,
      inProgress:  rows.filter(a => matches(a, 'inProgress')).length,
      awaiting:    rows.filter(a => matches(a, 'awaiting')).length,
      handedOver:  rows.filter(a => matches(a, 'handedOver')).length,
    };
  }, [projects]);

  if (projects === null) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

  const visible = projects.filter(a => matches(a, filter));

  const FILTERS: { id: Filter; label: string; n: number }[] = [
    { id: 'all',        label: t('contractor.projects.filterAll'),        n: counts.all },
    { id: 'inProgress', label: t('contractor.projects.filterInProgress'), n: counts.inProgress },
    // "Awaiting verification" is hidden until the feature ships (30 Oct 2026). The
    // filter and its `matches()` arm stay, so restoring it is this one line.
    { id: 'handedOver', label: t('contractor.projects.filterHandedOver'), n: counts.handedOver },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          {t('contractor.projects.title')}
        </h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('contractor.projects.subtitle')}</p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm dark:bg-[#1e1e1e]">
          {error}
        </p>
      )}

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-14 text-center">
          <p className="text-sm font-medium text-brand-near-black dark:text-white">
            {t('contractor.projects.emptyTitle')}
          </p>
          <p className="mt-1 text-xs text-brand-mid-grey">{t('contractor.projects.emptyBody')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === f.id
                    ? 'border-brand-near-black bg-brand-near-black font-semibold text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                    : 'border-brand-border-grey bg-white text-brand-mid-grey hover:text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:text-white',
                )}
              >
                {f.label}
                <span className={cn('ml-1.5 font-mono text-[10px] tabular-nums',
                  filter === f.id ? 'opacity-60' : 'text-brand-mid-grey')}>
                  {f.n}
                </span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-brand-mid-grey">
              {t('contractor.projects.noneInFilter')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {visible.map(a => <li key={a.project.id}><ProjectRow assigned={a} /></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ProjectRow({ assigned }: { assigned: AssignedProject }) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const money = useProjectMoney(assigned.project.country);
  const { project, stages, activeStage } = assigned;

  const current = currentStageNumber(stages);
  const awaiting = stages.some(s => s.status === 'pending_review');

  // What releases on the stage being worked. Null — not 0 — when there is no open
  // stage or the stage carries no milestone, because "0 XAF" and "nothing is due
  // yet" are different statements and only one of them is true here.
  const due = money.pair(activeStage?.payment_milestone_usd ?? null);

  // `awaiting` is deliberately not a state a row may show while verification is
  // hidden: it would name a step the contractor cannot see or act on.
  const state = isHandedOver(assigned)
    ? { label: t('contractor.projects.handedOver'),    tone: 'complete' as const }
    : current === null
      ? { label: t('contractor.projects.notStarted'),  tone: 'locked' as const }
      : { label: stageLabel(activeStage!),             tone: 'active' as const };

  return (
    <Link
      to={`/work/projects/${project.id}`}
      className="block rounded-2xl border border-brand-border-grey bg-white px-4 pb-3.5 pt-3 transition-colors hover:border-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 truncate text-sm font-semibold text-brand-near-black dark:text-white">
          {project.name}
          <span className="ml-2 text-xs font-normal text-brand-mid-grey">
            {[project.city, project.country].filter(Boolean).join(' · ')}
          </span>
        </p>
        <p className={cn('flex shrink-0 items-center gap-1.5 text-xs font-semibold',
          state.tone === 'complete' && 'text-state-complete',
          state.tone === 'locked'   && 'text-brand-mid-grey',
          state.tone === 'active'   && 'text-brand-near-black dark:text-white',
        )}>
          <span aria-hidden className={cn('size-1.5 rounded-full',
            state.tone === 'complete' && 'bg-state-complete',
            state.tone === 'locked'   && 'bg-brand-border-grey',
            state.tone === 'active'   && 'bg-brand-near-black dark:bg-white',
          )} />
          {state.label}
        </p>
      </div>

      <StagePipeline stages={stages} className="mb-3" />

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-t border-brand-border-grey pt-2.5 dark:border-[#2c2c2c]">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Column label={t('contractor.projects.colStage')}>
            {current !== null && activeStage
              ? t('contractor.projects.stageNumber', { n: current, name: stageLabel(activeStage) })
              : assigned.totalStages > 0
                ? t('contractor.projects.stageOf', { n: assigned.completedStages, total: assigned.totalStages })
                : t('contractor.projects.noStages')}
          </Column>
          <Column label={t('contractor.projects.colActivity')}>
            {formatDate(project.updated_at)}
          </Column>
        </div>

        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-mid-grey">
            {t('contractor.projects.colNextRelease')}
          </p>
          {due ? (
            <>
              <p className="font-mono text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">
                {due.local}
              </p>
              {due.usd && <p className="font-mono text-[11px] text-brand-mid-grey">≈ {due.usd}</p>}
            </>
          ) : (
            <p className="text-xs text-brand-mid-grey">{t('contractor.projects.nothingDue')}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

function Column({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-mid-grey">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-brand-near-black dark:text-white">{children}</p>
    </div>
  );
}
