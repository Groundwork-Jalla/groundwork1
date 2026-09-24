import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, FolderOpen, Image, Loader2, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchAssignedProjects, fetchRework, fetchMyPayments,
  type AssignedProject, type ReworkItem, type ContractorPayment,
} from '@/lib/supabase/contractor-work';
import { useStageLabels } from '@/lib/stage-labels';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The contractor's dashboard.
//
// Answers, in order: what am I assigned to, what is being asked of me now, which stage is
// live, and what payment state names me. Every number is derived from rows this
// contractor can actually read — there are no illustrative figures here, and a metric
// that cannot be computed honestly is not shown at all.
//
// Three states are kept apart deliberately, because collapsing them is a lie:
//   · unavailable — the source could not be read (older deployment, RLS refusal)
//   · empty       — read fine, nothing there
//   · zero        — a real count that happens to be 0
// =========================================================

export default function ContractorDashboard() {
  const t = useT();
  const { user } = useAuth();
  const { stageLabel } = useStageLabels();

  const [projects, setProjects] = useState<AssignedProject[] | null>(null);
  const [rework, setRework] = useState<ReworkItem[]>([]);
  const [payments, setPayments] = useState<{ rows: ContractorPayment[]; available: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const assigned = await fetchAssignedProjects();
        if (!alive) return;
        setProjects(assigned);
        const [r, p] = await Promise.all([fetchRework(assigned), fetchMyPayments()]);
        if (!alive) return;
        setRework(r);
        setPayments(p);
      } catch {
        if (alive) { setProjects([]); setError(t('contractor.loadFailed')); }
      }
    })();
    return () => { alive = false; };
  }, [t]);

  const firstName = ((user?.user_metadata?.full_name as string | undefined) ?? '').split(' ')[0];

  const activeStages = useMemo(
    () => (projects ?? []).filter(a => a.activeStage !== null).length,
    [projects],
  );

  if (projects === null) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          {t('contractor.dashboard.title')}
        </h1>
        <p className="mt-1 text-sm text-brand-mid-grey">
          {firstName
            ? t('contractor.dashboard.greeting', { name: firstName })
            : t('contractor.dashboard.subtitle')}
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm text-brand-near-black dark:bg-[#1e1e1e] dark:text-white">
          {error}
        </p>
      )}

      {/* ── KPIs. Only what the data supports. ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<FolderOpen className="size-4" />} label={t('contractor.kpi.assigned')} value={projects.length} />
        <Kpi icon={<Image className="size-4" />}      label={t('contractor.kpi.activeStages')} value={activeStages} />
        <Kpi icon={<AlertTriangle className="size-4" />} label={t('contractor.kpi.needsAction')} value={rework.length}
             tone={rework.length > 0 ? 'alert' : undefined} />
        {/* Payment visibility is beneficiary-scoped (090). When the ledger cannot be read
            the card says so rather than showing a 0 that would read as "nothing owed". */}
        <Kpi icon={<Wallet className="size-4" />} label={t('contractor.kpi.payments')}
             value={payments === null ? null : payments.available ? payments.rows.length : null}
             unavailable={payments !== null && !payments.available}
             hint={t('contractor.kpi.paymentsHint')} />
      </div>

      {/* ── Needs action: real reviewer findings, nothing invented ─────────────────── */}
      <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
          {t('contractor.needsAction.title')}
        </h2>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('contractor.needsAction.subtitle')}</p>

        {rework.length === 0 ? (
          <p className="py-6 text-sm text-brand-mid-grey">{t('contractor.needsAction.empty')}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {rework.map(item => (
              <li key={item.stageId}
                  className="rounded-xl border border-state-held/40 bg-state-held/10 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-near-black dark:text-white">
                    {t('contractor.needsAction.stage', { n: item.stageNumber })} · {item.stageName}
                  </p>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-state-held">
                    {t(item.decision === 'rejected'
                      ? 'contractor.decision.rejected'
                      : 'contractor.decision.needsMoreEvidence')}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-brand-mid-grey">{item.projectName}</p>
                {item.findings && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-brand-near-black dark:text-white">
                    {item.findings}
                  </p>
                )}
                <Link to={`/work/projects/${item.projectId}`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-near-black underline underline-offset-4 dark:text-white">
                  {t('contractor.needsAction.open')} <ArrowRight className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── My projects ───────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
            {t('contractor.projects.title')}
          </h2>
          {projects.length > 0 && (
            <Link to="/work/projects" className="text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
              {t('common.viewAll')} →
            </Link>
          )}
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-brand-border-grey px-4 py-10 text-center">
            <p className="text-sm font-medium text-brand-near-black dark:text-white">
              {t('contractor.projects.emptyTitle')}
            </p>
            <p className="mt-1 text-xs text-brand-mid-grey">{t('contractor.projects.emptyBody')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.slice(0, 5).map(a => (
              <li key={a.project.id}>
                <ProjectRow assigned={a} stageLabel={stageLabel} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────────

function Kpi({ icon, label, value, hint, tone, unavailable }: {
  icon: React.ReactNode; label: string; value: number | null;
  hint?: string; tone?: 'alert'; unavailable?: boolean;
}) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <div className="flex items-center gap-2 text-brand-mid-grey">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums',
        tone === 'alert' ? 'text-state-held' : 'text-brand-near-black dark:text-white')}>
        {/* A dash, not a zero: "could not read" and "none" are different facts. */}
        {unavailable || value === null ? '—' : value}
      </p>
      {unavailable
        ? <p className="mt-0.5 text-[11px] text-brand-mid-grey">{t('contractor.kpi.unavailable')}</p>
        : hint && <p className="mt-0.5 text-[11px] text-brand-mid-grey">{hint}</p>}
    </div>
  );
}

function ProjectRow({ assigned, stageLabel }: {
  assigned: AssignedProject;
  stageLabel: (s: { stage_key: string | null; name: string }) => string;
}) {
  const t = useT();
  const { project, activeStage, completedStages, totalStages } = assigned;
  const pct = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;

  return (
    <Link to={`/work/projects/${project.id}`}
          className="flex flex-wrap items-center gap-4 rounded-xl border border-brand-border-grey px-4 py-3 transition-colors hover:bg-brand-off-white dark:border-[#2c2c2c] dark:hover:bg-[#2c2c2c]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-brand-near-black dark:text-white">{project.name}</p>
        <p className="truncate text-xs text-brand-mid-grey">
          {[project.city, project.country].filter(Boolean).join(', ')}
        </p>
      </div>

      <div className="min-w-[180px]">
        <p className="text-xs text-brand-mid-grey">
          {totalStages > 0
            ? t('contractor.projects.stageOf', { n: completedStages, total: totalStages })
            : t('contractor.projects.noStages')}
        </p>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-brand-off-white dark:bg-[#2c2c2c]">
          <div className="h-full rounded-full bg-brand-near-black dark:bg-white" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <span className="shrink-0 rounded-full bg-brand-off-white px-2.5 py-1 text-[11px] font-medium text-brand-near-black dark:bg-[#2c2c2c] dark:text-white">
        {activeStage ? stageLabel(activeStage) : t('contractor.projects.nothingActive')}
      </span>
    </Link>
  );
}
