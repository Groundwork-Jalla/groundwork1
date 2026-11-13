import { useT } from '@/lib/i18n';

export function CommunicationRunStatus({run}:{run:{started_at:string;status:string}|null}) {
  const t=useT();
  const stale=!!run&&Date.now()-Date.parse(run.started_at)>15*60_000;
  return <div className="my-4 text-xs text-brand-mid-grey">
    <p>{run?`${t('communications.lastRun')}: ${new Date(run.started_at).toLocaleString()} · ${run.status}`:t('communications.noRuns')}</p>
    {run?.status==='failed'&&<p role="alert" className="mt-2 text-sm text-state-alert">{t('communications.runFailed')}</p>}
    {stale&&<p role="alert" className="mt-2 text-sm text-state-alert">{t('communications.runStale')}</p>}
  </div>;
}
