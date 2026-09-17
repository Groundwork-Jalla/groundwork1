import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { loadWorkspace, type LoadedWorkspace } from '@/lib/supabase/workspace';
import { BUILT_TABS, WORKSPACE_TABS, parseWorkspaceParams, workspaceHref, type WorkspaceTab } from '@/lib/admin/workspace-params';
import { WorkspaceHeader } from '@/components/admin/workspace/WorkspaceHeader';
import { OverviewTab } from '@/components/admin/workspace/OverviewTab';
import { ActivityTab } from '@/components/admin/workspace/ActivityTab';
import { SiteUpdatesTab } from '@/components/admin/workspace/SiteUpdatesTab';
import { DocumentsTab } from '@/components/admin/workspace/DocumentsTab';
import { FinancialsTab } from '@/components/admin/workspace/FinancialsTab';
import { StagesTab } from '@/components/admin/workspace/StagesTab';
import { ConversationsTab } from '@/components/admin/workspace/ConversationsTab';
import { EmptyState } from '@/components/ui/EmptyState';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/projects/:id — the Project Workspace (05 §5).
//
// One route. The tab, the selected stage and the selected conversation are search
// params, so a queue row, an Action Center item or a shared link can open exactly the
// right place, and a reload lands where it left off. No nested routes.
//
// The loader is the only data boundary: `loadWorkspace(id)` once, then every component
// reads the assembled model. A project that does not exist — or that RLS will not show
// this admin — renders the honest not-found state; nothing is invented in its place.
//
// Built so far: Overview (step 4); Activity, Site Updates, Documents (5a); Financials (5b.1); Stages (5b.2); Conversations (5b.3). The
// other tabs are navigation targets that say so (BUILT_TABS), never blank pages and
// never dead links.
// =========================================================

const TAB_LABEL: Record<WorkspaceTab, TKey> = {
  overview:        'admin.workspace.tabs.overview',
  stages:          'admin.workspace.tabs.stages',
  financials:      'admin.workspace.tabs.financials',
  'site-updates':  'admin.workspace.tabs.site-updates',
  documents:       'admin.workspace.tabs.documents',
  conversations:   'admin.workspace.tabs.conversations',
  activity:        'admin.workspace.tabs.activity',
  team:            'admin.workspace.tabs.team',
};

export default function AdminProjectWorkspace() {
  const t = useT();
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { tab, stageId, conversationId } = parseWorkspaceParams(params);

  const [loaded, setLoaded]   = useState<LoadedWorkspace | null | undefined>(undefined);   // undefined = loading
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);

  // `generation` bumps after an act (a ledger confirmation, later an approval) so the
  // whole model is re-read from the database — the only place the truth changed.
  const [generation, setGeneration] = useState(0);
  const reload = () => setGeneration(g => g + 1);

  useEffect(() => {
    let alive = true;
    if (generation === 0) setLoaded(undefined);
    setError(null);
    loadWorkspace(id)
      .then(r => { if (alive) setLoaded(r); })
      .catch(e => { if (alive) { setError(errorMessage(e, t('admin.workspace.loadFailed'))); setLoaded(null); } });
    return () => { alive = false; };
  }, [id, t, generation]);

  if (loaded === undefined) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p role="alert" className="text-sm text-state-alert">{error}</p>
        <Link to="/admin/projects" className="mt-4 inline-block text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
          ← {t('admin.workspace.back')}
        </Link>
      </div>
    );
  }

  if (loaded === null) {
    return (
      <div className="p-8">
        <EmptyState
          title={t('admin.workspace.notFound')}
          description={t('admin.workspace.notFoundBody')}
          action={
            <Link to="/admin/projects" className="rounded-xl border border-brand-border-grey px-4 py-2 text-xs font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
              ← {t('admin.workspace.back')}
            </Link>
          }
        />
      </div>
    );
  }

  const ws = loaded.workspace;

  return (
    <div className="flex min-h-full flex-col">
      {/* A header act (assign verifier) is a write like any other: re-read, then render. */}
      <WorkspaceHeader ws={ws} onNotice={n => { setNotice(n); reload(); }} />

      {/* Tabs: a scrollable strip; the active tab is the URL's. */}
      <nav aria-label={t('admin.workspace.tabs.overview')}
        className="flex gap-1 overflow-x-auto border-b border-brand-border-grey bg-white px-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] sm:px-4 2xl:px-6">
        {WORKSPACE_TABS.map(name => {
          const active = name === tab;
          return (
            <Link
              key={name}
              to={workspaceHref(ws.project.id, { tab: name, stageId })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
                active
                  ? 'border-brand-near-black text-brand-near-black dark:border-white dark:text-white'
                  : 'border-transparent text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
              )}
            >
              {t(TAB_LABEL[name])}
            </Link>
          );
        })}
      </nav>

      {notice && (
        <p className="mx-5 mt-4 rounded-lg border border-brand-border-grey bg-brand-off-white px-4 py-2.5 text-xs text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1a1a1a] dark:text-white sm:mx-6">
          {notice}
        </p>
      )}

      {tab === 'overview' ? (
        <OverviewTab loaded={loaded} stageId={stageId} />
      ) : tab === 'activity' ? (
        <ActivityTab loaded={loaded} />
      ) : tab === 'site-updates' ? (
        <SiteUpdatesTab loaded={loaded} />
      ) : tab === 'documents' ? (
        <DocumentsTab loaded={loaded} />
      ) : tab === 'financials' ? (
        <FinancialsTab loaded={loaded} onChanged={reload} />
      ) : tab === 'stages' ? (
        <StagesTab loaded={loaded} stageId={stageId} onChanged={reload} />
      ) : tab === 'conversations' ? (
        <ConversationsTab loaded={loaded} conversationId={conversationId} onChanged={reload} />
      ) : BUILT_TABS.includes(tab) ? null : (
        <div className="p-8">
          <EmptyState title={t(TAB_LABEL[tab])} description={t('admin.workspace.tabNotBuilt')} />
        </div>
      )}
    </div>
  );
}
