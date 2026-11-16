import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, UserRoundPlus } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ProjectTeamAccess } from '@/lib/supabase/project-team';
import { requestProjectContractor } from '@/lib/supabase/support';

/** Connect a payee before asking a client for payment. An invitation alone is not acceptance. */
export function ProjectContractorConnection({ projectId, access, onRequested, dashboard = false }: {
  projectId: string; access: ProjectTeamAccess; onRequested: () => void | Promise<void>; dashboard?: boolean;
}) {
  const t = useT();
  const current = useRef<string | null>(projectId); current.current = projectId;
  useEffect(() => () => { if (current.current === projectId) current.current = null; }, [projectId]);
  const inFlight = useRef<string | null>(null);
  const [request, setRequest] = useState<{ projectId: string; state: 'busy' | 'sent' | 'failed' } | null>(null);
  const state = request?.projectId === projectId ? request.state : null;
  if (!access.primaryClient || access.hasPrimaryContractor) return null;
  const requested = state === 'sent' || access.contractorRequestStatus === 'open' || access.contractorRequestStatus === 'in_progress';
  async function askJalla() {
    if (requested || inFlight.current === projectId) return;
    const id = projectId;
    inFlight.current = id; setRequest({ projectId: id, state: 'busy' });
    try {
      await requestProjectContractor(id);
      if (current.current !== id) return;
      setRequest({ projectId: id, state: 'sent' });
      // Saving the request succeeds independently of a subsequent screen refresh.
      void Promise.resolve(onRequested()).catch(() => {});
    } catch {
      if (current.current === id) setRequest({ projectId: id, state: 'failed' });
    } finally { if (inFlight.current === id) inFlight.current = null; }
  }
  return <section aria-label={t('project.contractorConnection.title')} className={cn('min-w-0 rounded-xl p-5 sm:p-6', dashboard
    ? 'flex flex-col justify-between gap-5 bg-brand-green text-white'
    : 'border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]')}>
    <div>
      <p className={cn('flex items-center gap-2 text-sm font-semibold', dashboard ? 'text-white/85' : 'text-brand-green dark:text-white')}><UserRoundPlus className="size-4" aria-hidden />{t('dashboard.architecture.nextStep')}</p>
      <h3 className="mt-2 text-xl font-bold leading-snug sm:text-2xl">{t('project.contractorConnection.title')}</h3>
      <p className={cn('mt-3 text-sm leading-relaxed', dashboard ? 'text-white/85' : 'text-brand-mid-grey')}>{t('project.contractorConnection.body')}</p>
      {access.hasPendingContractor && <p role="status" className="mt-3 text-sm">{t('project.contractorConnection.pending')}</p>}
      {requested && <p role="status" className="mt-3 text-sm">{t('project.contractorConnection.requested')}</p>}
      {state === 'failed' && <p role="alert" className={cn('mt-3 text-sm', !dashboard && 'text-state-alert')}>{t('project.contractorConnection.failed')}</p>}
    </div>
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Link to={`/projects/${projectId}?tab=team&invite=contractor`} className={cn('inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-center text-sm font-semibold', dashboard
        ? 'w-full bg-white text-brand-green hover:bg-[#f2f1ee]'
        : 'bg-brand-green text-white hover:bg-brand-green-hover')}>
        {t(access.hasPendingContractor ? 'project.contractorConnection.viewInvitation' : 'project.contractorConnection.invite')}
      </Link>
      {!requested && <button type="button" disabled={state === 'busy'} onClick={() => void askJalla()} className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-center text-sm font-semibold disabled:opacity-60', dashboard
        ? 'w-full border-white/60 text-white hover:bg-white/10'
        : 'border-brand-border-grey text-brand-green hover:bg-brand-off-white dark:text-white dark:hover:bg-white/5')}>
        {state === 'busy' && <Loader2 className="size-4 animate-spin" aria-hidden />}{t(state === 'busy' ? 'project.contractorConnection.requesting' : 'project.contractorConnection.find')}
      </button>}
    </div>
  </section>;
}
