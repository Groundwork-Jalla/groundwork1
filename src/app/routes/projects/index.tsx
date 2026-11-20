import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  MapPin, Building2, ChevronRight, HardHat, Eye, Layers, CheckCircle2, Wallet,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchParticipantProjects } from '@/lib/supabase/participant-projects';
import { projectBudget } from '@/lib/budget';
import { useProjectMoney } from '@/lib/budget/use-project-money';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import type { ProjectRow } from '@/types/project';
import { useDomainLabels } from '@/lib/domain-labels';
import { cn } from '@/lib/utils';

const TOTAL_STAGES = 10;

const STATUS_META: Record<string, { labelKey: TKey; dot: string; badge: string }> = {
  active: {
    labelKey: 'common.active',
    dot: 'bg-brand-green dark:bg-[#4e9e78]',
    badge: 'bg-brand-green/10 text-brand-green border border-brand-green/25 dark:bg-brand-green/20 dark:text-[#86efac]',
  },
  on_hold: {
    labelKey: 'common.onHold',
    dot: 'bg-state-held',
    badge: 'bg-state-held/10 text-state-held border border-state-held/30',
  },
  completed: {
    labelKey: 'common.complete',
    dot: 'bg-brand-mid-grey',
    badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey dark:bg-[#242424] dark:border-[#2c2c2c]',
  },
  archived: {
    labelKey: 'common.archived',
    dot: 'bg-brand-border-grey',
    badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey dark:bg-[#242424] dark:border-[#2c2c2c]',
  },
};

function completedStages(p: ProjectRow) {
  return p.status === 'completed' ? TOTAL_STAGES : Math.max(0, Math.min(TOTAL_STAGES, p.current_stage - 1));
}

/** 10-segment stage rail matching the calm project overview & contractor cards. */
function StageSegments({ done, isComplete }: { done: number; isComplete: boolean }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: TOTAL_STAGES }, (_, idx) => {
        const filled = idx < done;
        const current = !isComplete && idx === done;
        return (
          <span
            key={idx}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              filled
                ? 'bg-brand-green dark:bg-[#4e9e78]'
                : current
                  ? 'bg-brand-green/35 dark:bg-[#4e9e78]/40'
                  : 'bg-brand-light-grey dark:bg-[#2c2c2c]',
            )}
          />
        );
      })}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-brand-border-grey bg-white p-5 animate-pulse dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <div className="flex justify-between">
        <div className="h-5 w-16 rounded-full bg-brand-light-grey dark:bg-[#282828]" />
        <div className="h-4 w-12 rounded bg-brand-light-grey dark:bg-[#282828]" />
      </div>
      <div className="h-5 w-2/3 rounded bg-brand-light-grey dark:bg-[#282828]" />
      <div className="h-3 w-1/2 rounded bg-brand-light-grey dark:bg-[#282828]" />
      <div className="mt-2 flex gap-1">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-1.5 flex-1 rounded-full bg-brand-light-grey dark:bg-[#282828]" />
        ))}
      </div>
      <div className="mt-2 h-8 w-1/2 rounded bg-brand-light-grey dark:bg-[#282828]" />
    </div>
  );
}

function ProjectCard({ project, shared, assigned }: { project: ProjectRow; shared: boolean; assigned: boolean }) {
  const labels = useDomainLabels();
  const t = useT();
  const money = useProjectMoney(project);
  const status = STATUS_META[project.status] ?? STATUS_META.active;
  const done = completedStages(project);
  const pct = Math.round((done / TOTAL_STAGES) * 100);
  const loc = [project.city, labels.country(project.country)].filter(Boolean).join(', ');
  // budget_usd is null until the owner confirms one in Step 11; projectBudget falls
  // back to the engine estimate so the card shows a figure rather than an em dash.
  const budget = projectBudget(project).total;
  const pair = money.pair(budget, project.budget_amount);

  return (
    <Link
      to={`${assigned ? '/work/projects' : '/projects'}/${project.id}`}
      className="group flex h-full flex-col rounded-2xl border border-brand-border-grey bg-white p-5 transition-all duration-200 hover:border-brand-green/60 hover:shadow-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:border-[#4e9e78]/60"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold', status.badge)}>
          <span className={cn('size-1.5 rounded-full', status.dot)} />
          {t(status.labelKey)}
        </span>
        {shared && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-border-grey bg-brand-off-white px-2.5 py-0.5 text-[10px] font-semibold text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#141414]">
            <Eye className="size-3" aria-hidden="true" />
            {t('dashboard.shared.badge')}
          </span>
        )}
      </div>

      <h3 className="mb-1 truncate text-base font-bold leading-snug text-brand-near-black dark:text-white">
        {project.name}
      </h3>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-brand-mid-grey">
        <span className="flex items-center gap-1">
          <Building2 className="size-3 shrink-0" aria-hidden="true" />
          {labels.buildingType(project.building_type)}
        </span>
        {loc && (
          <>
            <span className="text-brand-border-grey dark:text-[#3a3a3a]">·</span>
            <span className="flex items-center gap-1">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              {loc}
            </span>
          </>
        )}
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-brand-mid-grey">
          <span>{t('projects.stageOf', { done, total: TOTAL_STAGES })}</span>
          <span className="font-mono font-semibold tabular-nums text-brand-near-black dark:text-white">{pct}%</span>
        </div>
        <StageSegments done={done} isComplete={project.status === 'completed'} />
      </div>

      <div className="mt-auto flex items-end justify-between border-t border-brand-border-grey/70 pt-3.5 dark:border-[#2c2c2c]">
        <div data-clarity-mask="true" className="min-w-0">
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-mid-grey">
            {t('projects.estBudget')}
          </p>
          <p className="truncate font-mono text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">
            {budget > 0 ? money.local(budget, project.budget_amount) : '—'}
          </p>
          {pair?.usd && (
            <p className="font-mono text-[11px] tabular-nums text-brand-mid-grey">
              ≈ {pair.usd}
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-green transition-colors group-hover:text-brand-green-hover dark:text-[#86efac]">
          {t('common.open')}
          <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

const FILTERS: { id: string; labelKey: TKey }[] = [
  { id: 'all',       labelKey: 'projects.filters.all'       },
  { id: 'active',    labelKey: 'projects.filters.active'    },
  { id: 'on_hold',   labelKey: 'projects.filters.onHold'    },
  { id: 'completed', labelKey: 'projects.filters.completed' },
];

export default function ProjectsIndex() {
  const { user, isContractor } = useAuth();
  const { t, tPlural, lang } = useLanguage();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sharedIds, setSharedIds] = useState<Set<string>>(() => new Set());
  const [assignedIds, setAssignedIds] = useState<Set<string>>(() => new Set());
  const [ownedCount, setOwnedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter);

  const summary = useMemo(() => {
    const activeCount = projects.filter(p => p.status === 'active').length;
    const stagesDone = projects.reduce((sum, p) => sum + completedStages(p), 0);
    const stagesTotal = projects.length * TOTAL_STAGES;
    const totalUsd = projects.reduce((sum, p) => sum + Math.max(0, projectBudget(p).total || 0), 0);
    return { activeCount, stagesDone, stagesTotal, totalUsd };
  }, [projects]);

  useEffect(() => {
    if (!user) return;
    let live = true;

    setLoading(true);
    setLoadFailed(false);
    const loader = fetchParticipantProjects(user.id, true);

    loader
      .then(({ all, shared, owned, assigned, loadFailed: failed }) => {
        if (!live) return;
        setProjects(all);
        setSharedIds(new Set(shared.map(p => p.id)));
        setOwnedCount(owned.length);
        setAssignedIds(new Set(assigned.map(p => p.id)));
        setLoadFailed(!!failed);
      })
      .catch(() => { if (live) setLoadFailed(true); })
      .finally(() => { if (live) setLoading(false); });

    return () => { live = false; };
  }, [user, isContractor, loadAttempt]);

  const viewerOnly = !isContractor && !loading && ownedCount === 0 && projects.length > 0;
  const formattedUsdTotal = useMemo(() => {
    if (summary.totalUsd <= 0) return '—';
    return `$${Math.round(summary.totalUsd).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}`;
  }, [summary.totalUsd, lang]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 pb-24 sm:px-6 md:pb-8">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-brand-near-black dark:text-white">
            {t('projects.title')}
          </h1>
          {!loading && (
            <p className="mt-0.5 text-xs text-brand-mid-grey">
              {tPlural('projects.count', projects.length)}
            </p>
          )}
        </div>
        {!isContractor && !viewerOnly && (
          <Link
            to="/projects/new"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-hover"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('projects.newBuild')}
          </Link>
        )}
      </div>

      {/* Calm summary strip */}
      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green dark:bg-brand-green/20 dark:text-[#86efac]">
              <Layers className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-brand-mid-grey">{t('projects.filters.active')}</p>
              <p className="font-mono text-lg font-bold tabular-nums text-brand-near-black dark:text-white">
                {summary.activeCount}
                <span className="ml-1 text-xs font-normal text-brand-mid-grey">/ {projects.length}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green dark:bg-brand-green/20 dark:text-[#86efac]">
              <CheckCircle2 className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-brand-mid-grey">{t('projects.filters.completed')}</p>
              <p className="font-mono text-lg font-bold tabular-nums text-brand-near-black dark:text-white">
                {summary.stagesDone}
                <span className="ml-1 text-xs font-normal text-brand-mid-grey">/ {summary.stagesTotal}</span>
              </p>
            </div>
          </div>

          <div data-clarity-mask="true" className="flex items-center gap-3 rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green dark:bg-brand-green/20 dark:text-[#86efac]">
              <Wallet className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-brand-mid-grey">{t('projects.estBudget')}</p>
              <p className="truncate font-mono text-lg font-bold tabular-nums text-brand-near-black dark:text-white">
                {formattedUsdTotal}
              </p>
            </div>
          </div>
        </div>
      )}

      {loadFailed && (
        <div role="alert" className="rounded-xl border border-brand-border-grey bg-white p-4 text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <p>{t('projects.loadFailed')}</p>
          <button
            type="button"
            onClick={() => setLoadAttempt(n => n + 1)}
            className="mt-2 font-semibold text-brand-green underline underline-offset-4 dark:text-[#86efac]"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Filters */}
      {!loading && projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
                filter === f.id
                  ? 'bg-brand-green font-semibold text-white'
                  : 'border border-brand-border-grey bg-white text-brand-mid-grey hover:border-brand-green hover:text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:text-white',
              )}
            >
              {t(f.labelKey)}
              {f.id !== 'all' && (
                <span className="ml-1.5 font-mono text-[10px] opacity-70">
                  {projects.filter(p => p.status === f.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : loadFailed && filtered.length === 0 ? null : filtered.length === 0 ? (
        filter !== 'all' ? (
          <div className="rounded-2xl border border-dashed border-brand-border-grey p-8 text-center dark:border-[#2c2c2c]">
            <p className="text-sm text-brand-mid-grey">
              {t(filter === 'on_hold' ? 'project.review.noOnHold' : filter === 'completed' ? 'project.review.noCompleted' : 'project.review.noActive')}
            </p>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="mt-3 text-sm font-semibold text-brand-green underline dark:text-[#86efac]"
            >
              {t('common.viewAll')}
            </button>
          </div>
        ) : isContractor ? (
          <div className="rounded-2xl border border-dashed border-brand-border-grey p-6 text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
            {t('projects.empty.contractor')}
          </div>
        ) : (
          <Link
            to="/projects/new"
            className="group flex flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-brand-border-grey bg-white/60 p-12 text-center transition-all hover:border-brand-green hover:bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]/60 dark:hover:border-[#4e9e78] dark:hover:bg-[#1e1e1e]"
          >
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
              className="flex size-16 items-center justify-center rounded-full bg-brand-off-white transition-colors group-hover:bg-brand-green dark:bg-[#141414]"
            >
              <HardHat className="size-8 text-brand-mid-grey transition-colors group-hover:text-white" />
            </motion.div>
            <div>
              <p className="mb-1 text-base font-semibold text-brand-near-black dark:text-white">
                {t('projects.empty.title')}
              </p>
              <p className="mx-auto max-w-xs text-sm leading-relaxed text-brand-mid-grey">
                {t('projects.empty.body')}
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-white transition-colors group-hover:bg-brand-green-hover">
              <Plus className="size-4" aria-hidden="true" />
              {t('projects.empty.cta')}
            </span>
          </Link>
        )
      ) : (
        <AnimatePresence>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <ProjectCard project={p} shared={sharedIds.has(p.id)} assigned={assignedIds.has(p.id)} />
              </motion.div>
            ))}
            {!isContractor && !viewerOnly && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: filtered.length * 0.05 }}>
                <Link
                  to="/projects/new"
                  className="group flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand-border-grey bg-white/50 p-8 transition-all hover:border-brand-green hover:bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]/50 dark:hover:border-[#4e9e78] dark:hover:bg-[#1e1e1e]"
                >
                  <span className="flex size-10 items-center justify-center rounded-full bg-brand-light-grey transition-colors group-hover:bg-brand-green dark:bg-[#282828]">
                    <Plus className="size-4 text-brand-near-black transition-colors group-hover:text-white dark:text-white" />
                  </span>
                  <span className="text-sm font-medium text-brand-mid-grey transition-colors group-hover:text-brand-green dark:group-hover:text-[#86efac]">
                    {t('projects.newBuild')}
                  </span>
                </Link>
              </motion.div>
            )}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
