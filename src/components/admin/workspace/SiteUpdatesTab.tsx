import { Link } from 'react-router';
import { Camera } from 'lucide-react';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import { domainStateOf, workspaceHref } from '@/lib/admin/workspace-params';
import { DomainNote } from './DomainNote';
import { EvidenceList } from './EvidenceList';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useT } from '@/lib/i18n';

// =========================================================
// Site Updates tab (05 §6): the chronological feed of `site_updates` (088), newest first.
//
// Every entry is a record a member wrote through `submit_site_update()` — author, stage,
// substage, description, the files it added. Read-only for staff by decision (13 Sep:
// no admin "submit on behalf"); the client page already lets an admin submit as
// themselves. Files open through the existing signed-URL reader, working for staff
// since 092. Empty means empty: nothing is manufactured to fill the feed.
// =========================================================

export function SiteUpdatesTab({ loaded }: { loaded: LoadedWorkspace }) {
  const t = useT();
  const { stageLabel, substageLabel } = useStageLabels();
  const ws = loaded.workspace;
  const state = domainStateOf(ws, loaded.errors, 'siteUpdates', ws.siteUpdates.length);

  if (state === 'unavailable' || state === 'error') {
    return <div className="p-6 sm:p-8"><DomainNote state={state} reason={loaded.errors.siteUpdates} /></div>;
  }
  if (state === 'empty') {
    return (
      <div className="p-6 sm:p-8">
        <EmptyState icon={<Camera className="size-8" />} title={t('admin.workspace.siteUpdates.empty')} description={t('admin.workspace.siteUpdates.emptyBody')} />
      </div>
    );
  }

  const stageOf = (id: string) => ws.stages.find(s => s.stage.id === id);
  const who = (id: string) => {
    const hit = ws.team.owner?.id === id ? ws.team.owner
      : ws.team.contractors.find(c => c.contractor_user_id === id) ? { name: ws.team.contractors.find(c => c.contractor_user_id === id)!.name }
      : ws.team.verifiers.find(v => v.userId === id);
    return hit ? (hit.name || ('email' in hit ? hit.email : '')) : '';
  };

  return (
    <div className="p-5 sm:p-6 2xl:p-8">
      <ol className="flex flex-col gap-4">
        {ws.siteUpdates.map(u => {
          const view = stageOf(u.stageId);
          const sub = view?.substages.find(s => s.id === u.substageId) ?? null;
          return (
            <li key={u.id} className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
                <p className="text-sm font-semibold text-brand-near-black dark:text-white">
                  {who(u.submittedBy) || t('admin.workspace.header.unknownAccount')}
                  <span className="font-normal text-brand-mid-grey"> · <span title={formatDateTime(u.submittedAt)}>{formatRelative(u.submittedAt)}</span></span>
                </p>
                {view && (
                  <Link to={workspaceHref(ws.project.id, { tab: 'overview', stageId: view.stage.id })}
                    className="text-xs text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
                    {t('admin.workspace.stage.eyebrow', { n: view.stage.stage_number })} · {stageLabel(view.stage)}{sub && ` · ${substageLabel(sub)}`}
                  </Link>
                )}
              </div>
              <div className="px-5 py-4">
                {u.description
                  ? <p className="whitespace-pre-wrap text-sm text-brand-near-black dark:text-white">{u.description}</p>
                  : <p className="text-xs text-brand-mid-grey">{t('admin.workspace.siteUpdates.noDescription')}</p>}
                {u.evidencePaths.length > 0 && <div className="mt-3"><EvidenceList paths={u.evidencePaths} /></div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
