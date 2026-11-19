import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { groupActivityByActor } from '@/lib/admin/activity-groups';
import { loadAdminOverview, type AdminOverviewData } from '@/lib/supabase/admin-overview';
import { loadActionCenter, type ActionCenterData } from '@/lib/supabase/action-center';
import { OverviewHero } from '@/components/admin/OverviewHero';
import { Card, CardEmpty, Kpi } from '@/components/admin/overview/Card';
import { AttentionList } from '@/components/admin/overview/AttentionList';
import {
  ApplicationsFunnel, ContractorDistribution, TicketList, OVERVIEW_ROWS,
} from '@/components/admin/overview/Blocks';
import { ProjectsMap } from '@/components/admin/overview/ProjectsMap';
import { KPI_LINKS, SEE_ALL_LINKS } from '@/lib/admin/overview-links';
import { actionLabel } from '@/lib/admin/action-labels';
import type { Priority } from '@/lib/admin/action-center';
import { workspaceHref } from '@/lib/admin/workspace-params';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The operations command centre.
//
// Composition is the 18 Nov 2026 redesign (docs/mockups/2026-11-18-admin-screens/
// overview-desktop.png): what needs me first — a hero carrying the Action Center's counts
// by priority, beside today's date and the integration's health — then the eight metrics
// in two named bands (Building · People & growth), then "Needs your attention" wide beside
// recent activity, then map · funnel · trades, then support · GoHighLevel · inspections.
// Every card, link, empty and partial state of the 14 Sep layout is still here, and the
// 14 Sep rule still holds: rows are `items-start`, so no card is stretched to a neighbour.
//
// A KPI IS A DATASET, NOT A SHORTCUT (Favour, 14 Sep 2026). Clicking "Projects at risk —
// 3" lands on exactly those three, because the destination filters with the same call
// this page counted with. The destinations live in lib/admin/overview-links.ts, and a
// test opens each destination's route file to prove the parameter is actually read —
// a URL that looks filtered but shows everything is the same lie as a fake number.
//
// EVERY VALUE COMES FROM A QUERY — `loadAdminOverview()` and `loadActionCenter()`, both
// over real Supabase/GoHighLevel rows. No seeded numbers, no map pins (projects record a
// country and city, never coordinates), no inspections (no entity), no trend arrows (no
// stored baseline), no "Live" badge. A source that cannot be read shows "—", never a 0
// that means "we could not look".
//
// EVERY LIST IS A PREVIEW: at most five rows, then "See all" into the real module, which
// keeps the full dataset, its filters and its pagination.
// =========================================================

/** TEMPORARY (Phase 5): the Workspace route does not exist yet, so a project opens the
 *  client-facing page in a new tab, as the projects list does today. When
 *  `/admin/projects/:id` ships this becomes that link and the flag goes. */
/**
 * The dashboard's ONE spacing token. Every gap on this page — between the KPI cards,
 * between the columns, between the cards inside a column, and between the body and the
 * rail — is this value, so the page has a single vertical and horizontal rhythm instead
 * of four arbitrary margins that happened to look right once.
 */
const DASHBOARD_GAP = 'gap-4';

/** The Workspace route shipped (Phase 5 step 4); a project opens there, in-app. The flag
 *  stays as the one switch the Action Center reads, so its deep links agree with these. */
const WORKSPACE_READY = true;
const projectLink = (id: string) => workspaceHref(id);

export default function AdminOverview() {
  const t = useT();
  const { user } = useAuth();
  const [now] = useState(() => new Date());
  const [data, setData]       = useState<AdminOverviewData | null>(null);
  const [actions, setActions] = useState<ActionCenterData | null>(null);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadAdminOverview(now)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(errorMessage(e, t('common.somethingWrong'))); });
    loadActionCenter(now, WORKSPACE_READY)
      .then(a => { if (alive) setActions(a); })
      .catch(() => { /* one card; its failure must not blank the page */ });
    return () => { alive = false; };
  }, [t, now]);

  const projects = data?.projects ?? [];
  // The SAME call /admin/projects filters by. One definition of "at risk", not two.
  const atRisk = projects.filter(p => p.health.band === 'at_risk').length;
  const unavailable = actions
    ? Object.entries(actions.available).filter(([, ok]) => !ok).map(([k]) => k)
    : [];
  // The hero's chips and the attention bar are the Action Center's items, counted — the
  // same list the card below previews and /admin/action-center shows in full.
  const counts = actions ? countByPriority(actions.items) : null;
  const crm = data?.crm.status;
  const configured = crm
    ? [crm.apiToken && crm.locationId, crm.conversationProvider, crm.inboundSecret, crm.stageMapValid].filter(Boolean).length
    : 0;

  return (
    <div className={cn('flex flex-col p-5 sm:p-6 2xl:p-8', DASHBOARD_GAP)}>
      {/* ── What needs me, first ─────────────────────────────────────────────────── */}
      <div className={cn('grid xl:grid-cols-[minmax(0,1fr)_22.5rem]', DASHBOARD_GAP)}>
        <OverviewHero name={firstName(data?.viewerName, user)} now={now} counts={counts} actionTo={SEE_ALL_LINKS.attention} />

        <section className="flex flex-col justify-between gap-4 rounded-2xl border border-brand-border-grey bg-white px-5 py-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div>
            <p className="text-xs text-brand-mid-grey">{t('admin.hero.today')}</p>
            <p className="mt-0.5 text-xl font-extrabold tracking-tight text-brand-near-black dark:text-white">
              {new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(now)}
            </p>
          </div>
          <div>
            <Link to={SEE_ALL_LINKS.crm} className="text-xs text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
              {t('admin.ghl.title')}
            </Link>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!data ? (
                <StatusTag tone="mute">{t('common.loading')}</StatusTag>
              ) : !crm ? (
                <StatusTag tone="mute">{t('admin.ghl.unavailable')}</StatusTag>
              ) : (
                <>
                  <StatusTag tone={configured === 4 ? 'ok' : 'warn'}>{t('admin.ghl.summary', { ok: configured, total: 4 })}</StatusTag>
                  <StatusTag tone="mute">{t('admin.ghl.outboxTag', { n: data.crm.backlog })}</StatusTag>
                  <StatusTag tone={data.crm.failures > 0 ? 'alert' : 'ok'}>{t('admin.ghl.failuresTag', { n: data.crm.failures })}</StatusTag>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm text-state-alert dark:bg-[#1a1a1a]">
          {error}
        </p>
      )}

      {data && !data.activityAvailable && (
        <p className="flex items-start gap-2 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-xs text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1a1a1a] dark:text-white">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-state-held" />
          {t('admin.ops.activityMissing')}
        </p>
      )}

      {/* ── Eight metrics in two named bands. Every one is still a filtered dataset:
          the card opens exactly what it counted (lib/admin/overview-links.ts). ───── */}
      <div className="flex flex-col gap-2.5">
        <KpiBand titleKey="admin.hero.bandBuilding">
          <Kpi layout="row" labelKey="admin.kpiRow.totalProjects"  value={data ? projects.length : null}             to={KPI_LINKS.totalProjects}  subtitle={t('admin.kpiRow.totalProjectsSub')} />
          <Kpi layout="row" labelKey="admin.kpiRow.atRisk"         value={data ? atRisk : null}                      to={KPI_LINKS.atRisk}         subtitle={t('admin.kpiRow.atRiskSub')}       accent="alert" />
          <Kpi layout="row" labelKey="admin.kpiRow.pendingReviews" value={data?.backlog.pendingReviews ?? null}      to={KPI_LINKS.pendingReviews} subtitle={t('admin.kpiRow.pendingReviewsSub')} accent="held" />
          <Kpi layout="row" labelKey="admin.kpiRow.pendingBudgets" value={data?.backlog.pendingBudgets ?? null}      to={KPI_LINKS.pendingBudgets} subtitle={t('admin.kpiRow.pendingBudgetsSub')} accent="held" />
        </KpiBand>
        <KpiBand titleKey="admin.hero.bandPeople">
          <Kpi layout="row" labelKey="admin.kpiRow.needsReply"     value={data ? data.needsReply : null}              to={KPI_LINKS.conversations}  subtitle={t('admin.kpiRow.needsReplySub')}    accent="held" />
          <Kpi layout="row" labelKey="admin.kpiRow.applications"   value={data?.backlog.pendingApplications ?? null} to={KPI_LINKS.applications}   subtitle={t('admin.kpiRow.applicationsSub')} />
          <Kpi layout="row" labelKey="admin.kpiRow.quoteRequests"  value={data ? data.quoteRequests : null}          to={KPI_LINKS.quoteRequests}  subtitle={t('admin.kpiRow.quoteRequestsSub')} />
          <Kpi layout="row" labelKey="admin.kpiRow.totalUsers"     value={data ? data.totalUsers : null}             to={KPI_LINKS.totalUsers}     subtitle={t('admin.kpiRow.totalUsersSub')} />
        </KpiBand>
      </div>

      {/* ── What is waiting · what just happened ─────────────────────────────────── */}
      <div className={cn('grid items-start xl:grid-cols-[minmax(0,1fr)_23.75rem]', DASHBOARD_GAP)}>
        <Card titleKey="admin.attention.title" subtitleKey="admin.attention.subtitle" viewAllTo={SEE_ALL_LINKS.attention}>
          {counts && actions && actions.items.length > 0 && <PriorityBar counts={counts} total={actions.items.length} />}
          {!actions ? (
            <CardEmpty messageKey="common.loading" />
          ) : actions.items.length === 0 ? (
            <CardEmpty messageKey="admin.attention.empty" />
          ) : (
            <AttentionList items={actions.items} now={now} limit={OVERVIEW_ROWS} />
          )}
          {unavailable.length > 0 && (
            <p className="border-t border-brand-border-grey px-5 py-3 text-[11px] text-brand-mid-grey dark:border-[#2c2c2c]">
              {t('admin.attention.partial', { what: unavailable.join(', ') })}
            </p>
          )}
        </Card>

        <Card titleKey="admin.ops.recentTitle" subtitleKey="admin.ops.recentSubtitle" viewAllTo={SEE_ALL_LINKS.activity}>
          {!data?.recent.length ? (
            <CardEmpty messageKey="admin.ops.recentEmpty" />
          ) : (
            <GroupedActivityList events={data.recent} limit={OVERVIEW_ROWS} />
          )}
        </Card>
      </div>

      {/* ── Where the work is · what is coming in · who does it ──────────────────── */}
      <div className={cn('grid items-start lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]', DASHBOARD_GAP)}>
        <Card titleKey="admin.map.title" subtitleKey="admin.map.subtitle" viewAllTo={SEE_ALL_LINKS.locations}>
          {!data?.locations.length
            ? <CardEmpty messageKey="admin.map.empty" />
            : <ProjectsMap locations={data.locations} />}
        </Card>

        <Card titleKey="admin.funnel.title" subtitleKey="admin.funnel.subtitle" viewAllTo={SEE_ALL_LINKS.funnel}>
          {!data?.funnel
            ? <CardEmpty messageKey="admin.funnel.empty" />
            : <ApplicationsFunnel steps={data.funnel} />}
        </Card>

        <Card titleKey="admin.distribution.title" subtitleKey="admin.distribution.subtitle" viewAllTo={SEE_ALL_LINKS.contractors}>
          {!data?.contractorsByTrade?.length
            ? <CardEmpty messageKey="admin.distribution.empty" />
            : <ContractorDistribution slices={data.contractorsByTrade} />}
        </Card>
      </div>

      {/* ── The system: support · the integration · inspections ──────────────────── */}
      <div className={cn('grid items-start lg:grid-cols-3', DASHBOARD_GAP)}>
        <Card titleKey="admin.supportCard.title" subtitleKey="admin.supportCard.subtitle" viewAllTo={SEE_ALL_LINKS.support}>
          {!data?.tickets.length
            ? <CardEmpty messageKey="admin.supportCard.empty" />
            : <TicketList tickets={data.tickets} />}
        </Card>

        <Card titleKey="admin.ghl.title" subtitleKey="admin.ghl.subtitle" viewAllTo={SEE_ALL_LINKS.crm}>
          {!data ? (
            <CardEmpty messageKey="common.loading" />
          ) : !data.crm.status ? (
            <CardEmpty messageKey="admin.ghl.unavailable" />
          ) : (
            <ul className="space-y-2 px-5 py-4 text-xs">
              <GhlRow labelKey="admin.ghl.api" ok={data.crm.status.apiToken && data.crm.status.locationId} />
              <GhlRow labelKey="admin.ghl.conversationProvider" ok={data.crm.status.conversationProvider} />
              <GhlRow labelKey="admin.ghl.inboundSecret" ok={data.crm.status.inboundSecret} />
              <GhlRow labelKey="admin.ghl.pipeline" ok={data.crm.status.stageMapValid} />
              <li className="flex items-center justify-between gap-3 pt-1">
                <span className="text-brand-mid-grey">{t('admin.ghl.backlog')}</span>
                <span className="tabular-nums font-semibold text-brand-near-black dark:text-white">{data.crm.backlog}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-brand-mid-grey">{t('admin.ghl.failures')}</span>
                <span className={cn('tabular-nums font-semibold', data.crm.failures > 0 ? 'text-state-alert' : 'text-brand-near-black dark:text-white')}>
                  {data.crm.failures}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-brand-mid-grey">{t('admin.ghl.lastInbound')}</span>
                <span className="text-brand-near-black dark:text-white">
                  {data.crm.lastInboundAt ? formatRelative(data.crm.lastInboundAt) : t('admin.ghl.never')}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-brand-mid-grey">{t('admin.ghl.lastOutbound')}</span>
                <span className="text-brand-near-black dark:text-white">
                  {data.crm.lastOutboundAt ? formatRelative(data.crm.lastOutboundAt) : t('admin.ghl.never')}
                </span>
              </li>
            </ul>
          )}
        </Card>

        {/* Inspections have no entity in Groundwork. The card says so rather than
            showing rows that do not exist; it gains content the day one does. */}
        <Card titleKey="admin.inspections.title" subtitleKey="admin.inspections.subtitle">
          <CardEmpty messageKey="admin.inspections.empty" />
        </Card>
      </div>
    </div>
  );
}

function GroupedActivityList({
  events,
  limit,
}: {
  events: AdminOverviewData['recent'];
  limit: number;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const groups = groupActivityByActor(events).slice(0, limit);
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
      {groups.map(group => {
        if (group.events.length === 1) {
          const e = group.events[0];
          const verb = actionLabel(e.action, t);
          return (
            <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
              <span className="min-w-0">
                <span className="block text-xs leading-snug text-brand-near-black dark:text-white">
                  <span className="font-semibold">{e.actorName || '—'}</span> {verb}
                </span>
                {e.projectId ? (
                  <Link to={projectLink(e.projectId)} target={WORKSPACE_READY ? undefined : '_blank'}
                    className="mt-0.5 block truncate text-[11px] text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
                    {e.projectName || e.projectId.slice(0, 8)}
                  </Link>
                ) : (
                  <span className="mt-0.5 block truncate text-[11px] text-brand-mid-grey">{t('admin.ops.noProject')}</span>
                )}
              </span>
              <span className="shrink-0 text-[11px] text-brand-mid-grey">{formatRelative(e.createdAt)}</span>
            </li>
          );
        }

        const open = !!expanded[group.key];
        return (
          <li key={group.key} data-activity-group={group.key}>
            <button
              type="button"
              onClick={() => toggle(group.key)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]"
            >
              <span className="flex min-w-0 items-center gap-2">
                {open
                  ? <ChevronDown className="size-3.5 shrink-0 text-brand-mid-grey" aria-hidden />
                  : <ChevronRight className="size-3.5 shrink-0 text-brand-mid-grey" aria-hidden />}
                <span className="truncate text-xs font-semibold text-brand-near-black dark:text-white">{group.actorName}</span>
                <span className="shrink-0 rounded-full bg-brand-light-grey px-2 py-0.5 text-[11px] font-semibold text-brand-mid-grey dark:bg-[#2c2c2c]">
                  {t('admin.ops.groupActivities', { n: group.events.length })}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-brand-mid-grey">{formatRelative(group.latestAt)}</span>
            </button>
            {open && (
              <ul className="divide-y divide-brand-border-grey/60 border-t border-brand-border-grey/60 bg-brand-off-white/60 dark:divide-[#2c2c2c] dark:border-[#2c2c2c] dark:bg-[#141414]">
                {group.events.map(e => {
                  const verb = actionLabel(e.action, t);
                  return (
                    <li key={e.id} className="flex items-start justify-between gap-3 py-2 pl-10 pr-5">
                      <span className="min-w-0">
                        <span className="block text-xs leading-snug text-brand-near-black dark:text-white">{verb}</span>
                        {e.projectId ? (
                          <Link to={projectLink(e.projectId)} target={WORKSPACE_READY ? undefined : '_blank'}
                            className="mt-0.5 block truncate text-[11px] text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
                            {e.projectName || e.projectId.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="mt-0.5 block truncate text-[11px] text-brand-mid-grey">{t('admin.ops.noProject')}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-brand-mid-grey">{formatRelative(e.createdAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function countByPriority(items: { priority: Priority }[]): Record<Priority, number> {
  const out: Record<Priority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of items) out[i.priority] += 1;
  return out;
}

const BAR: Record<Priority, string> = {
  critical: 'bg-state-alert',
  high:     'bg-[#d9b46a]',
  medium:   'bg-[#a49ccc]',
  low:      'bg-brand-border-grey',
};

/** The attention list's shape at a glance — the same counts as the hero's chips. */
function PriorityBar({ counts, total }: { counts: Record<Priority, number>; total: number }) {
  const t = useT();
  const parts = (['critical', 'high', 'medium', 'low'] as Priority[]).filter(p => counts[p] > 0);
  const label = parts.map(p => t('admin.hero.priorityCount', { n: counts[p], level: t(`admin.attention.priority.${p}` as TKey).toLowerCase() })).join(', ');
  return (
    <div role="img" aria-label={label} title={label} className="mx-5 mt-3 flex h-2 overflow-hidden rounded-full bg-brand-light-grey">
      {parts.map(p => <span key={p} className={cn('h-full', BAR[p])} style={{ width: `${(counts[p] / total) * 100}%` }} />)}
    </div>
  );
}

function KpiBand({ titleKey, children }: { titleKey: TKey; children: ReactNode }) {
  const t = useT();
  return (
    <div className="grid gap-2 md:grid-cols-[6.875rem_minmax(0,1fr)] md:gap-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-brand-muted-grey md:pt-3.5">{t(titleKey)}</h3>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </div>
  );
}

function StatusTag({ tone, children }: { tone: 'ok' | 'warn' | 'alert' | 'mute'; children: ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
      tone === 'ok'    && 'bg-state-complete/10 text-state-complete',
      tone === 'warn'  && 'bg-state-held/10 text-state-held',
      tone === 'alert' && 'bg-state-alert/10 text-state-alert',
      tone === 'mute'  && 'bg-brand-light-grey text-brand-mid-grey',
    )}>
      {tone !== 'mute' && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

function GhlRow({ labelKey, ok }: { labelKey: TKey; ok: boolean }) {
  const t = useT();
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-brand-mid-grey">{t(labelKey)}</span>
      <span className="flex items-center gap-1.5 text-brand-near-black dark:text-white">
        <span className={cn('size-2 rounded-full', ok ? 'bg-state-complete' : 'bg-brand-muted-grey')} />
        {t(ok ? 'admin.ghl.configured' : 'admin.ghl.notConfigured')}
      </span>
    </li>
  );
}

/**
 * The greeting's name: the signed-in admin's own, first word only — their profile name
 * (what they chose to be called), then the session's metadata.
 *
 * NO EMAIL FALLBACK (Favour, 14 Sep 2026). The local part of an address is a login, not
 * a name, and capitalising it produced "Good morning, Phavorfavor." When there is no
 * real name the hero greets without one — `OverviewHero` has a second set of strings for
 * exactly that, and an unnamed greeting is better than a wrong name.
 */
export function firstName(profileName: string | undefined, user: { user_metadata?: { full_name?: string }; email?: string } | null): string {
  const full = profileName?.trim() || user?.user_metadata?.full_name?.trim();
  return full ? full.split(' ')[0] : '';
}
