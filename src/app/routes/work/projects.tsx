import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2 } from 'lucide-react';
import { fetchAssignedProjects, type AssignedProject } from '@/lib/supabase/contractor-work';
import { useStageLabels } from '@/lib/stage-labels';
import { useT } from '@/lib/i18n';

// Every project this contractor is assigned to. The list is RLS-bounded — see
// contractor-work.ts; nothing is filtered in the browser.
export default function ContractorProjects() {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const [projects, setProjects] = useState<AssignedProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAssignedProjects()
      .then(p => { if (alive) setProjects(p); })
      .catch(() => { if (alive) { setProjects([]); setError(t('contractor.loadFailed')); } });
    return () => { alive = false; };
  }, [t]);

  if (projects === null) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

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
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map(a => {
            const pct = a.totalStages > 0 ? Math.round((a.completedStages / a.totalStages) * 100) : 0;
            return (
              <li key={a.project.id}>
                <Link to={`/work/projects/${a.project.id}`}
                      className="flex h-full flex-col rounded-2xl border border-brand-border-grey bg-white p-4 transition-colors hover:bg-brand-off-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:bg-[#2c2c2c]">
                  <p className="text-sm font-semibold text-brand-near-black dark:text-white">{a.project.name}</p>
                  <p className="mt-0.5 text-xs text-brand-mid-grey">
                    {[a.project.city, a.project.country].filter(Boolean).join(', ')}
                  </p>
                  <p className="mt-3 text-xs text-brand-mid-grey">
                    {a.activeStage ? stageLabel(a.activeStage) : t('contractor.projects.nothingActive')}
                  </p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-off-white dark:bg-[#2c2c2c]">
                    <div className="h-full rounded-full bg-brand-near-black dark:bg-white" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-brand-mid-grey">
                    {a.totalStages > 0
                      ? t('contractor.projects.stageOf', { n: a.completedStages, total: a.totalStages })
                      : t('contractor.projects.noStages')}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
