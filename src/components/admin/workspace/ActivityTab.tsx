import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import { domainStateOf, workspaceHref } from '@/lib/admin/workspace-params';
import { actionLabel } from '@/lib/admin/action-labels';
import { DomainNote } from './DomainNote';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDateTime, formatRelative } from '@/lib/format';
import { formatUSDFull } from '@/lib/budget';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// Activity tab (05 §8): `project_audit_log` for this project, newest first, whole.
//
// A projection of `ws.activity` and nothing else — the loader already resolved actor and
// person names and decided which tab each entity belongs to. No second source, no
// client-side reconstruction; the Overview's "last 5" is this list sliced. Amounts and
// stage numbers come from the row's `details`, written by the same definer function that
// made the change, so they are the facts as recorded.
// =========================================================

const ENTITY_LABEL: Record<string, TKey> = {
  project_stage:      'admin.workspace.activity.entity.project_stage',
  stage_verification: 'admin.workspace.activity.entity.stage_verification',
  site_update:        'admin.workspace.activity.entity.site_update',
  payment:            'admin.workspace.activity.entity.payment',
  conversation:       'admin.workspace.activity.entity.conversation',
  decision:           'admin.workspace.activity.entity.decision',
  contractor_invite:  'admin.workspace.activity.entity.contractor_invite',
  project_verifier:   'admin.workspace.activity.entity.project_verifier',
  support_ticket:     'admin.workspace.activity.entity.support_ticket',
};

export function ActivityTab({ loaded }: { loaded: LoadedWorkspace }) {
  const t = useT();
  const ws = loaded.workspace;
  const state = domainStateOf(ws, loaded.errors, 'activity', ws.activity.length);

  if (state === 'unavailable' || state === 'error') {
    return <div className="p-6 sm:p-8"><DomainNote state={state} reason={loaded.errors.activity} /></div>;
  }
  if (state === 'empty') {
    return <div className="p-6 sm:p-8"><EmptyState title={t('admin.workspace.overview.activityEmpty')} description={t('admin.workspace.activity.emptyBody')} /></div>;
  }

  return (
    <div className="p-5 sm:p-6 2xl:p-8">
      <ol className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        {ws.activity.map(a => {
          const d = a.details;
          const amount = typeof d.amount === 'number' ? formatUSDFull(d.amount) : null;
          const stageNo = typeof d.stage_number === 'number' ? d.stage_number : null;
          const entityKey = a.entityType ? ENTITY_LABEL[a.entityType] : null;
          const chip = entityKey ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-brand-border-grey px-1.5 py-0.5 text-[10px] font-medium text-brand-mid-grey dark:border-[#2c2c2c]">
              {t(entityKey)}{stageNo != null && ` ${stageNo}`}
              {a.tab && <ChevronRight className="size-3" />}
            </span>
          ) : null;
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-brand-near-black dark:text-white">
                  <span className="font-medium">{a.actorName || t('admin.workspace.header.unknownAccount')}</span> {actionLabel(a.action, t)}
                  {a.personName && <span className="text-brand-mid-grey"> · {a.personName}</span>}
                  {amount && <span className="tabular-nums text-brand-mid-grey"> · {amount}</span>}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-brand-mid-grey">
                  {chip}
                  <span title={formatDateTime(a.createdAt)}>{formatRelative(a.createdAt)}</span>
                </span>
              </span>
            </>
          );
          const cls = 'flex items-start gap-3 border-b border-brand-border-grey px-5 py-3 last:border-b-0 dark:border-[#2c2c2c]';
          return (
            <li key={a.id}>
              {a.tab ? (
                <Link to={workspaceHref(ws.project.id, { tab: a.tab, stageId: a.tab === 'stages' ? a.stageId : undefined })}
                  className={`${cls} transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]`}>
                  {body}
                </Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
