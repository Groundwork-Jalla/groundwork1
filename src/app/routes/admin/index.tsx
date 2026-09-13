import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';
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
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The operations command centre.
//
// Composition is the layout agreed 14 Sep 2026: hero, eight metrics, a main body that
// answers "where are the projects · how are applications progressing · where are the
// contractors · what needs me", and a right-hand operational rail. The visual language
// is the dark concept's; both themes wear it, including the sidebar, which follows the
// theme like everything else.
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
const WORKSPACE_READY = false;
const projectLink = (id: string) => (WORKSPACE_READY ? `/admin/projects/${id}` : `/projects/${id}`);

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

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6 2xl:p-8">
      <OverviewHero name={firstName(data?.viewerName, user)} now={now} />

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

      {/* Main dashboard + right operational rail. The rail drops below the body on
          tablets and stacks on phones. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">

          {/* ── Eight metrics ──────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi labelKey="admin.kpiRow.totalProjects"  value={data ? projects.length : null}             to={KPI_LINKS.totalProjects}  subtitle={t('admin.kpiRow.totalProjectsSub')} />
            <Kpi labelKey="admin.kpiRow.pendingReviews" value={data?.backlog.pendingReviews ?? null}      to={KPI_LINKS.pendingReviews} subtitle={t('admin.kpiRow.pendingReviewsSub')} />
            <Kpi labelKey="admin.kpiRow.totalUsers"     value={data ? data.totalUsers : null}             to={KPI_LINKS.totalUsers}     subtitle={t('admin.kpiRow.totalUsersSub')} />
            <Kpi labelKey="admin.kpiRow.applications"   value={data?.backlog.pendingApplications ?? null} to={KPI_LINKS.applications}   subtitle={t('admin.kpiRow.applicationsSub')} />
            <Kpi labelKey="admin.kpiRow.quoteRequests"  value={data ? data.quoteRequests : null}          to={KPI_LINKS.quoteRequests}  subtitle={t('admin.kpiRow.quoteRequestsSub')} />
            <Kpi labelKey="admin.kpiRow.conversations"  value={data ? data.openConversations : null}      to={KPI_LINKS.conversations}  subtitle={t('admin.kpiRow.conversationsSub')} />
            <Kpi labelKey="admin.kpiRow.atRisk"         value={data ? atRisk : null}                      to={KPI_LINKS.atRisk}         subtitle={t('admin.kpiRow.atRiskSub')}       accent="alert" />
            <Kpi labelKey="admin.kpiRow.pendingBudgets" value={data?.backlog.pendingBudgets ?? null}      to={KPI_LINKS.pendingBudgets} subtitle={t('admin.kpiRow.pendingBudgetsSub')} accent="held" />
          </div>

          {/* ── Where the projects are · how applications progress ─────────────────── */}
          <div className="grid items-start gap-5 lg:grid-cols-2">
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
          </div>

          {/* ── Where the contractors are · what needs me ──────────────────────────── */}
          <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <Card titleKey="admin.distribution.title" subtitleKey="admin.distribution.subtitle" viewAllTo={SEE_ALL_LINKS.contractors}>
              {!data?.contractorsByTrade?.length
                ? <CardEmpty messageKey="admin.distribution.empty" />
                : <ContractorDistribution slices={data.contractorsByTrade} />}
            </Card>

            <Card titleKey="admin.attention.title" subtitleKey="admin.attention.subtitle" viewAllTo={SEE_ALL_LINKS.attention}>
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
          </div>
        </div>

        {/* ── The operational rail ─────────────────────────────────────────────────── */}
        <aside className="flex min-w-0 flex-col gap-5">
          <Card titleKey="admin.ops.recentTitle" subtitleKey="admin.ops.recentSubtitle" viewAllTo={SEE_ALL_LINKS.activity}>
            {!data?.recent.length ? (
              <CardEmpty messageKey="admin.ops.recentEmpty" />
            ) : (
              <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
                {data.recent.slice(0, OVERVIEW_ROWS).map(e => {
                  const key = `admin.ops.action.${e.action.replace(/\./g, '_')}` as TKey;
                  const verb = t(key) === key ? t('admin.ops.action.other') : t(key);
                  return (
                    <li key={e.id} className="px-5 py-2.5">
                      <p className="text-xs leading-snug text-brand-near-black dark:text-white">
                        <span className="font-medium">{e.actorName || '—'}</span> {verb}
                      </p>
                      <p className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-brand-mid-grey">
                        {e.projectId ? (
                          <Link to={projectLink(e.projectId)} target={WORKSPACE_READY ? undefined : '_blank'}
                            className="truncate transition-colors hover:text-brand-near-black dark:hover:text-white">
                            {e.projectName || e.projectId.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="truncate">{t('admin.ops.noProject')}</span>
                        )}
                        <span className="shrink-0">{formatRelative(e.createdAt)}</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Inspections have no entity in Groundwork. The card says so rather than
              showing rows that do not exist; it gains content the day one does. */}
          <Card titleKey="admin.inspections.title" subtitleKey="admin.inspections.subtitle">
            <CardEmpty messageKey="admin.inspections.empty" />
          </Card>

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
        </aside>
      </div>
    </div>
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
