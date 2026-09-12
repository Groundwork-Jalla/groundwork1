import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ChevronRight, ClipboardCheck, Wallet, FileText, LifeBuoy, MessagesSquare, Clapperboard,
  AlertTriangle, ExternalLink,
} from 'lucide-react';
import { loadAdminOverview, type AdminOverviewData, type ScoredProject } from '@/lib/supabase/admin-overview';
import { ACTIVE_BANDS, type HealthBand, type HealthReason } from '@/lib/admin/health';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { State } from '@/lib/status';
import { formatRelative } from '@/lib/format';
import { useStageLabels } from '@/lib/stage-labels';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// The operations desk.
//
// Was five stat cards. Could not answer the one question anyone opens this page with:
// which builds need me today? Every project was watched by hand, in the client's own
// project page opened in a new tab.
//
// Now: the fleet by health, a needs-attention list where every row links to the page
// where the admin acts, the pipeline by stage, the desk backlog, and what happened last.
// Health rules live in lib/admin/health.ts; the plan is docs/ADMIN-DASHBOARD.md.
// =========================================================

/** Health band → the one badge vocabulary the rest of the app uses. */
const BAND_STATE: Record<HealthBand, State> = {
  on_track:  'in_progress',
  attention: 'held',
  at_risk:   'needs_attention',
  planning:  'locked',
  done:      'complete',
  archived:  'locked',
};

/** Where the admin goes to act on a reason. Reviews and budgets have queues; the rest is the project. */
function actionFor(reason: HealthReason | undefined, projectId: string): string {
  if (reason?.kind === 'review_pending')     return '/admin/reviews';
  if (reason?.kind === 'budget_unconfirmed') return '/admin/budgets';
  return `/projects/${projectId}`;
}

function ReasonLine({ reason }: { reason: HealthReason }) {
  const t = useT();
  const { stageLabel } = useStageLabels();

  const text = (() => {
    switch (reason.kind) {
      case 'review_pending':
        return reason.days !== undefined
          ? t('admin.ops.reviewPendingDays', { days: reason.days })
          : t('admin.ops.reviewPending');
      case 'stage_overdue':      return t('admin.ops.stageOverdue', { days: reason.days ?? 0 });
      case 'stalled':            return t('admin.ops.stalled',      { days: reason.days ?? 0 });
      case 'payment_pending':    return t('admin.ops.paymentPending');
      case 'on_hold':            return t('admin.ops.onHold');
      case 'budget_unconfirmed': return t('admin.ops.budgetUnconfirmed');
    }
  })();

  const stage = reason.stageNumber !== undefined
    ? t('admin.ops.stageRef', {
        n: reason.stageNumber,
        name: stageLabel({ stage_key: reason.stageKey ?? null, name: reason.stageName ?? '' }),
      })
    : null;

  return (
    <p className="text-xs text-brand-mid-grey">
      {text}{stage && <span className="text-brand-near-black"> · {stage}</span>}
    </p>
  );
}

function FleetCard({ labelKey, value, band, to }: { labelKey: TKey; value: number; band: HealthBand; to: string }) {
  const t = useT();
  return (
    <Link
      to={to}
      className="group flex items-center justify-between rounded-2xl border border-brand-border-grey bg-white p-5 transition-all hover:border-brand-near-black hover:shadow-sm"
    >
      <div>
        <StatusBadge state={BAND_STATE[band]} size="small" className="mb-1" />
        <p className="text-xs text-brand-mid-grey">{t(labelKey)}</p>
        <p className="text-3xl font-black tabular-nums text-brand-near-black">{value}</p>
      </div>
      <ChevronRight className="size-4 text-brand-mid-grey transition-colors group-hover:text-brand-near-black" />
    </Link>
  );
}

function BacklogRow({ icon: Icon, labelKey, value, to }: { icon: React.ElementType; labelKey: TKey; value: number; to: string }) {
  const t = useT();
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-brand-off-white"
    >
      <span className="flex items-center gap-2.5 text-sm text-brand-near-black">
        <Icon className="size-4 text-brand-mid-grey" />
        {t(labelKey)}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${value > 0 ? 'text-brand-near-black' : 'text-brand-mid-grey'}`}>
        {value}
      </span>
    </Link>
  );
}

function AttentionRow({ p }: { p: ScoredProject }) {
  const t = useT();
  const primary = p.health.reasons[0];
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusBadge state={BAND_STATE[p.health.band]} size="small" />
          <p className="truncate text-sm font-medium text-brand-near-black">{p.name}</p>
          <span className="truncate text-xs text-brand-mid-grey">{p.ownerName || p.ownerEmail}</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {p.health.reasons.slice(0, 2).map((r, i) => <ReasonLine key={i} reason={r} />)}
          {p.health.reasons.length > 2 && (
            <p className="text-[11px] text-brand-mid-grey">+{p.health.reasons.length - 2}</p>
          )}
        </div>
        <p className="mt-1 text-[11px] text-brand-mid-grey">
          {t('admin.ops.lastActivity', { when: p.lastActivityAt ? formatRelative(p.lastActivityAt) : t('admin.ops.never') })}
        </p>
      </div>
      <Link
        to={actionFor(primary, p.id)}
        target={actionFor(primary, p.id).startsWith('/projects/') ? '_blank' : undefined}
        className="mt-0.5 shrink-0 text-brand-mid-grey transition-colors hover:text-brand-near-black"
        aria-label={`${t('admin.openProject')} ${p.name}`}
      >
        {actionFor(primary, p.id).startsWith('/projects/')
          ? <ExternalLink className="size-4" />
          : <ChevronRight className="size-4" />}
      </Link>
    </li>
  );
}

export default function AdminOverview() {
  const t = useT();
  const [data, setData]   = useState<AdminOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadAdminOverview()
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(errorMessage(e, t('common.somethingWrong'))); });
    return () => { alive = false; };
  }, [t]);

  const byBand = (band: HealthBand) => data?.projects.filter(p => p.health.band === band).length ?? 0;
  const active = data?.projects.filter(p => ACTIVE_BANDS.includes(p.health.band)).length ?? 0;

  // Everything with a reason, worst first. Planning projects appear only when they are
  // waiting on us (a Management budget) — an ordinary self-verify build that has not
  // started is the client's to start, not ours to chase.
  const attention = (data?.projects ?? [])
    .filter(p => p.health.reasons.length > 0)
    .sort((a, b) => {
      const rank = (b: HealthBand) => (b === 'at_risk' ? 0 : b === 'attention' ? 1 : 2);
      return rank(a.health.band) - rank(b.health.band);
    });

  const pipelineMax = Math.max(1, ...Array.from(data?.pipeline.values() ?? [0]));

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.overviewTitle')}</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('admin.ops.subtitle')}</p>
      </div>

      {error && (
        <p role="alert" className="mb-6 rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm text-state-alert">
          {error}
        </p>
      )}

      {data && !data.activityAvailable && (
        <p className="mb-6 flex items-start gap-2 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-xs text-brand-near-black">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-state-held" />
          {t('admin.ops.activityMissing')}
        </p>
      )}

      {/* ── The fleet ── */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <FleetCard labelKey="admin.ops.cardActive"    value={active}              band="on_track"  to="/admin/projects" />
        <FleetCard labelKey="admin.ops.cardOnTrack"   value={byBand('on_track')}  band="on_track"  to="/admin/projects" />
        <FleetCard labelKey="admin.ops.cardAttention" value={byBand('attention')} band="attention" to="/admin/projects" />
        <FleetCard labelKey="admin.ops.cardAtRisk"    value={byBand('at_risk')}   band="at_risk"   to="/admin/projects" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Needs attention ── */}
        <section className="rounded-2xl border border-brand-border-grey bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-brand-border-grey px-4 py-3">
            <h2 className="text-sm font-semibold text-brand-near-black">{t('admin.ops.attentionTitle')}</h2>
            <span className="text-xs tabular-nums text-brand-mid-grey">{attention.length}</span>
          </div>
          {!data ? (
            <p className="px-4 py-8 text-center text-xs text-brand-mid-grey">{t('common.loading')}</p>
          ) : attention.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-brand-mid-grey">{t('admin.ops.attentionEmpty')}</p>
          ) : (
            <ul className="divide-y divide-brand-border-grey">
              {attention.map(p => <AttentionRow key={p.id} p={p} />)}
            </ul>
          )}
        </section>

        {/* ── Your desk ── */}
        <section className="rounded-2xl border border-brand-border-grey bg-white">
          <div className="border-b border-brand-border-grey px-4 py-3">
            <h2 className="text-sm font-semibold text-brand-near-black">{t('admin.ops.backlogTitle')}</h2>
          </div>
          <div className="p-2">
            <BacklogRow icon={ClipboardCheck} labelKey="admin.ops.backlogReviews"      value={data?.backlog.pendingReviews ?? 0}      to="/admin/reviews" />
            <BacklogRow icon={Wallet}         labelKey="admin.ops.backlogBudgets"      value={data?.backlog.pendingBudgets ?? 0}      to="/admin/budgets" />
            <BacklogRow icon={FileText}       labelKey="admin.ops.backlogApplications" value={data?.backlog.pendingApplications ?? 0} to="/admin/applications" />
            <BacklogRow icon={LifeBuoy}       labelKey="admin.ops.backlogSupport"      value={data?.backlog.openSupport ?? 0}         to="/admin/support" />
            <BacklogRow icon={MessagesSquare} labelKey="admin.ops.backlogInquiries"    value={data?.backlog.openInquiries ?? 0}       to="/admin/inquiries" />
            <BacklogRow icon={Clapperboard}   labelKey="admin.ops.backlogRequests"     value={data?.backlog.newAgentRequests ?? 0}    to="/admin/requests" />
          </div>
        </section>

        {/* ── Pipeline ── */}
        <section className="rounded-2xl border border-brand-border-grey bg-white lg:col-span-2">
          <div className="border-b border-brand-border-grey px-4 py-3">
            <h2 className="text-sm font-semibold text-brand-near-black">{t('admin.ops.pipelineTitle')}</h2>
          </div>
          <div className="p-4">
            {data && data.pipeline.size === 0 ? (
              <p className="py-4 text-center text-xs text-brand-mid-grey">{t('admin.ops.pipelineEmpty')}</p>
            ) : (
              <ol className="space-y-1.5">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
                  const count = data?.pipeline.get(n) ?? 0;
                  return (
                    <li key={n} className="flex items-center gap-3 text-xs">
                      <span className="w-16 shrink-0 text-brand-mid-grey">{t('admin.ops.pipelineStage', { n })}</span>
                      {/* Length carries the number; the fill is one neutral tone on purpose. */}
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-brand-off-white">
                        <span
                          className="block h-full rounded-full bg-brand-near-black transition-all"
                          style={{ width: `${(count / pipelineMax) * 100}%` }}
                        />
                      </span>
                      <span className={`w-6 shrink-0 text-right tabular-nums ${count ? 'text-brand-near-black' : 'text-brand-mid-grey'}`}>
                        {count}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>

        {/* ── Recent activity ── */}
        <section className="rounded-2xl border border-brand-border-grey bg-white">
          <div className="border-b border-brand-border-grey px-4 py-3">
            <h2 className="text-sm font-semibold text-brand-near-black">{t('admin.ops.recentTitle')}</h2>
          </div>
          {!data ? (
            <p className="px-4 py-8 text-center text-xs text-brand-mid-grey">{t('common.loading')}</p>
          ) : data.recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-brand-mid-grey">{t('admin.ops.recentEmpty')}</p>
          ) : (
            <ul className="divide-y divide-brand-border-grey">
              {data.recent.slice(0, 10).map(e => {
                const key = `admin.ops.action.${e.action}` as TKey;
                const verb = t(key) === key ? t('admin.ops.action.other') : t(key);
                return (
                  <li key={e.id} className="px-4 py-2.5">
                    <p className="text-xs text-brand-near-black">
                      <span className="font-medium">{e.actorName || '—'}</span> {verb}
                    </p>
                    <p className="mt-0.5 flex items-center justify-between text-[11px] text-brand-mid-grey">
                      <Link to={`/projects/${e.projectId}`} target="_blank" className="truncate hover:text-brand-near-black">
                        {e.projectName || e.projectId.slice(0, 8)}
                      </Link>
                      <span className="shrink-0">{formatRelative(e.createdAt)}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
