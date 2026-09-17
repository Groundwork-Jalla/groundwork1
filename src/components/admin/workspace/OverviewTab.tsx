import { Link } from 'react-router';
import type { Workspace, WorkspaceDomain } from '@/lib/admin/workspace';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import { domainStateOf, selectedStage, workspaceHref, type DomainState } from '@/lib/admin/workspace-params';
import { actionLabel } from '@/lib/admin/action-labels';
import { BLOCKER_LABEL, LIFECYCLE_META } from '@/lib/admin/lifecycle-badge';
import { Card, CardEmpty } from '@/components/admin/overview/Card';
import { StageLadder } from './StageLadder';
import { SelectedStagePanel } from './SelectedStagePanel';
import { StageLifecycleDot } from './StageLifecycleBadge';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDate, formatRelative } from '@/lib/format';
import { formatUSDFull } from '@/lib/budget';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The workspace's Overview tab (05 §6): "what is happening with this project right now?"
//
// Not the admin dashboard. That page asks "what needs me across the fleet"; this one
// asks about ONE project, so every section reads off the one assembled Workspace:
//
//   ladder · selected stage · blockers · money · progress · last five activity rows
//
// Three column stacks, like the dashboard, so no card is stretched to match a neighbour.
// Every list is a preview with its "See all" into the tab that owns it; the Overview
// never re-derives what the loader assembled and never invents a number for a domain
// that could not be read — `domainState()` tells apart empty, not applied, and failed.
// =========================================================

const OVERVIEW_ROWS = 5;

export function OverviewTab({ loaded, stageId }: { loaded: LoadedWorkspace; stageId: string | null }) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const ws = loaded.workspace;
  const p = ws.project;
  const selected = selectedStage(ws, stageId);
  const state = (d: WorkspaceDomain, n: number) => domainStateOf(ws, loaded.errors, d, n);

  // Progress from the stage rows themselves: how many are complete, and the planned
  // window when the stages carry dates. Nothing estimated.
  const done = ws.stages.filter(s => s.stage.status === 'complete').length;
  const starts = ws.stages.map(s => s.stage.planned_start).filter((x): x is string => !!x).sort();
  const ends   = ws.stages.map(s => s.stage.planned_end).filter((x): x is string => !!x).sort();
  const fin = ws.financials;
  const ledgerState = state('ledger', fin.payments.length);
  const activityState = state('activity', ws.activity.length);

  return (
    <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] 2xl:p-8">
      {/* ── Left stack: the ladder, then progress ──────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-5">
        <Card titleKey="admin.workspace.overview.ladder" subtitleKey="admin.workspace.overview.ladderSub" viewAllTo={workspaceHref(p.id, { tab: 'stages' })}>
          {ws.stages.length === 0
            ? <CardEmpty messageKey="admin.workspace.overview.noSchedule" />
            : <StageLadder projectId={p.id} stages={ws.stages} selectedId={selected?.stage.id ?? null} />}
        </Card>

        <Card titleKey="admin.workspace.overview.schedule">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">
              {t('admin.workspace.overview.progress', { done, total: ws.stages.length })}
            </p>
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-brand-light-grey">
              <span className="block h-full rounded-full bg-brand-near-black dark:bg-white"
                style={{ width: `${ws.stages.length ? Math.round((done / ws.stages.length) * 100) : 0}%` }} />
            </span>
            <p className="mt-2 text-xs text-brand-mid-grey">
              {starts.length && ends.length
                ? t('admin.workspace.overview.plannedWindow', { from: formatDate(starts[0]), to: formatDate(ends[ends.length - 1]) })
                : t('admin.workspace.overview.noSchedule')}
            </p>
          </div>
        </Card>
      </div>

      {/* ── Right stack: what this stage needs · what blocks · money · activity ──── */}
      <div className="flex min-w-0 flex-col gap-5">
        <Card titleKey="admin.workspace.overview.selected" subtitleKey="admin.workspace.overview.selectedSub">
          {!selected
            ? <CardEmpty messageKey="admin.workspace.overview.noSchedule" />
            : <SelectedStagePanel projectId={p.id} view={selected} people={peopleOf(ws)} ledgerAvailable={ws.available.ledger} />}
        </Card>

        <Card titleKey="admin.workspace.overview.blockers" subtitleKey="admin.workspace.overview.blockersSub">
          {ws.openBlockers.length === 0 ? (
            <CardEmpty messageKey="admin.workspace.overview.blockersEmpty" />
          ) : (
            <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {ws.openBlockers.map(b => {
                const view = ws.stages.find(s => s.stage.id === b.stageId);
                return (
                  <li key={`${b.stageId}:${b.blocker}`}>
                    <Link to={workspaceHref(p.id, { tab: 'overview', stageId: b.stageId })} replace
                      className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]">
                      {view && <StageLifecycleDot lifecycle={view.lifecycle} />}
                      <span className="min-w-0 flex-1">
                        {/* The blocker strings are written as suffixes ("· awaiting funding"); as a
                            row title the first letter is capitalised in CSS, not with a second string. */}
                        <span className="block truncate text-sm font-medium text-brand-near-black first-letter:uppercase dark:text-white">
                          {t(BLOCKER_LABEL[b.blocker])}
                        </span>
                        <span className="block truncate text-[11px] text-brand-mid-grey">
                          {t('admin.workspace.stage.eyebrow', { n: b.stageNumber })}{view && ` · ${stageLabel(view.stage)}`} · {t(LIFECYCLE_META[b.state].labelKey)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card titleKey="admin.workspace.overview.financial" subtitleKey="admin.workspace.overview.financialSub" viewAllTo={workspaceHref(p.id, { tab: 'financials' })}>
          {ledgerState === 'unavailable' || ledgerState === 'error' ? (
            <DomainNote state={ledgerState} reason={loaded.errors.ledger} />
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-3">
              <Money label={t('admin.workspace.overview.budget')}     value={fin.budgetUsd} />
              <Money label={t('admin.workspace.overview.funded')}     value={fin.funded} />
              <Money label={t('admin.workspace.overview.available')}  value={fin.availableFunds} emphasis />
              <Money label={t('admin.workspace.overview.authorised')} value={fin.authorised} />
              <Money label={t('admin.workspace.overview.inFlight')}   value={fin.inFlight} />
              <Money label={t('admin.workspace.overview.disbursed')}  value={fin.disbursed} />
            </dl>
          )}
        </Card>

        <Card titleKey="admin.workspace.overview.activity" viewAllTo={workspaceHref(p.id, { tab: 'activity' })}>
          {activityState === 'unavailable' || activityState === 'error' ? (
            <DomainNote state={activityState} reason={loaded.errors.activity} />
          ) : activityState === 'empty' ? (
            <CardEmpty messageKey="admin.workspace.overview.activityEmpty" />
          ) : (
            <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {ws.activity.slice(0, OVERVIEW_ROWS).map(a => {
                const row = (
                  <>
                    <span className="min-w-0 flex-1 text-xs leading-snug text-brand-near-black dark:text-white">
                      <span className="font-medium">{a.actorName || t('admin.workspace.header.unknownAccount')}</span> {actionLabel(a.action, t)}
                      {a.personName && <span className="text-brand-mid-grey"> · {a.personName}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-brand-mid-grey">{formatRelative(a.createdAt)}</span>
                  </>
                );
                const cls = 'flex items-baseline gap-3 px-5 py-2.5';
                return (
                  <li key={a.id}>
                    {a.tab ? (
                      <Link to={workspaceHref(p.id, { tab: a.tab, stageId: a.tab === 'stages' ? (a.stageId ?? undefined) : undefined })}
                        className={cn(cls, 'transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]')}>
                        {row}
                      </Link>
                    ) : (
                      <div className={cls}>{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** The people lookup the loader used — rebuilt from what it resolved, for the stage panel's names. */
function peopleOf(ws: Workspace) {
  const m = new Map<string, { name: string; email: string }>();
  if (ws.team.owner) m.set(ws.team.owner.id, { name: ws.team.owner.name, email: ws.team.owner.email });
  for (const c of ws.team.contractors) if (c.contractor_user_id) m.set(c.contractor_user_id, { name: c.name, email: c.email });
  for (const v of ws.team.verifiers) m.set(v.userId, { name: v.name, email: v.email });
  for (const a of ws.activity) {
    if (a.actorId && a.actorName && !m.has(a.actorId)) m.set(a.actorId, { name: a.actorName, email: '' });
    if (a.personId && a.personName && !m.has(a.personId)) m.set(a.personId, { name: a.personName, email: '' });
  }
  return m;
}

function Money({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-brand-mid-grey">{label}</dt>
      <dd className={cn('mt-0.5 truncate tabular-nums text-brand-near-black dark:text-white', emphasis ? 'text-base font-bold' : 'text-sm font-semibold')}>
        {formatUSDFull(value)}
      </dd>
    </div>
  );
}

/** The honest sentence for a domain that is not "empty": not applied, or failed to read. */
function DomainNote({ state, reason }: { state: DomainState; reason?: string }) {
  const t = useT();
  const key: TKey = state === 'error' ? 'admin.workspace.overview.domain.error' : 'admin.workspace.overview.domain.unavailable';
  return <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t(key, { reason: reason ?? '' })}</p>;
}
