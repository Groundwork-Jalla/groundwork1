import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { fetchProjectStages, fetchProjectSubstages } from '@/lib/supabase/projects';
import { fetchProjectTeamAccess } from '@/lib/supabase/project-team';
import { fetchStagePaymentsStrict } from '@/lib/supabase/verifications';
import { clientDashboardAction, type ClientDashboardAction } from '@/lib/projects/client-dashboard-action';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

export function ClientProjectNextAction({ project, stages }: { project: ProjectRow; stages: ProjectStageRow[] }) {
  const t = useT();
  const [read, setRead] = useState<{ projectId: string; action: ClientDashboardAction | null; failed: boolean }>({ projectId: project.id, action: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const [updates, payments, access, latestStages] = await Promise.all([fetchProjectSubstages(project.id), fetchStagePaymentsStrict(project.id), fetchProjectTeamAccess(project.id), fetchProjectStages(project.id)]);
        if (live && generation === request) setRead({ projectId: project.id, action: clientDashboardAction(project, latestStages, updates, payments, access.primaryClient), failed: false });
      } catch { if (live && generation === request) setRead({ projectId: project.id, action: { kind: 'view' }, failed: true }); }
    };
    setRead({ projectId: project.id, action: null, failed: false });
    void refresh();
    const channel = supabase.channel(`client-home-action:${project.id}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_substages', filter: `project_id=eq.${project.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_stages', filter: `project_id=eq.${project.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_payment_receipts', filter: `project_id=eq.${project.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `project_id=eq.${project.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_viewers', filter: `project_id=eq.${project.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_invites', filter: `project_id=eq.${project.id}` }, refresh)
      .subscribe();
    window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener('focus', refresh); void supabase.removeChannel(channel); };
  }, [project, stages, attempt]);
  const current = read.projectId === project.id ? read : null;
  const action = current?.action;
  if (!action) return <div role="status" className="flex min-h-48 items-center rounded-xl bg-brand-green p-5 text-sm text-white">{t('common.loading')}</div>;
  const href = `/projects/${project.id}${action.stageNumber ? `?tab=stages&stage=${action.stageNumber}` : ''}`;
  return <section className="flex min-w-0 flex-col justify-between gap-5 rounded-xl bg-brand-green p-5 text-white sm:p-6" aria-label={t('dashboard.architecture.nextStep')}>
    <div className="min-w-0">
      <p className="text-sm font-semibold text-white/85">{t('dashboard.architecture.nextStep')}</p>
      <h3 className="mt-2 text-xl font-bold leading-snug tracking-tight text-white sm:text-2xl">{t(`dashboard.architecture.actions.${action.kind}.title`)}</h3>
      <p className="mt-3 text-sm leading-relaxed text-white/85">{t(`dashboard.architecture.actions.${action.kind}.body`)}</p>
      {current.failed && <p role="status" className="mt-3 text-xs leading-relaxed text-white/85">{t('dashboard.architecture.actionUnavailable')}{' '}<button type="button" onClick={() => setAttempt(value => value + 1)} className="font-semibold underline underline-offset-4">{t('common.retry')}</button></p>}
    </div>
    <Link to={href} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#ffffff] px-4 py-3 text-center text-sm font-semibold text-brand-green transition-colors hover:bg-[#f2f1ee] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white dark:bg-[#f0f0f0] dark:text-[#1f4d36] dark:hover:bg-[#e4e3df]">
      {t(`dashboard.architecture.actions.${action.kind}.button`)}<ArrowUpRight className="size-4" aria-hidden />
    </Link>
  </section>;
}
