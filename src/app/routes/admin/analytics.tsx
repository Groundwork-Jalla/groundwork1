import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2 } from 'lucide-react';
import { loadAdminAnalytics, type AdminAnalytics, type Bucket } from '@/lib/supabase/admin-analytics';
import { useDomainLabels } from '@/lib/domain-labels';
import { formatUSDFull } from '@/lib/budget';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/analytics — what the operation adds up to (01 §3 ANALYTICS).
//
// Counts and sums of rows that exist now. No trend, no percentage change, no chart with
// a direction: Groundwork keeps no historical series to compare against, and a slope
// drawn from one reading is a decoration that invites a wrong decision. When the
// activity model can answer "what was true a month ago", trends belong here honestly.
//
// A section whose table could not be read says "not available" and is not counted as
// zero — the two are different facts and only one of them is about the business.
// =========================================================

export default function AdminAnalytics() {
  const t = useT();
  const labels = useDomainLabels();
  const [data, setData] = useState<AdminAnalytics | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await loadAdminAnalytics()); setError(null); }
    catch (err) { setData(null); setError(errorMessage(err, t('common.somethingWrong'))); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (data === undefined) {
    return <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>;
  }
  if (data === null) {
    return <p role="alert" className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 text-xs text-state-alert dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{error}</p>;
  }

  const { projects, finance, verification, communication, acquisition, field, support } = data;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.analytics.title')}</h1>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.analytics.subtitle')}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t('admin.analytics.projects')} sub={t('admin.analytics.projectsSub', { n: projects.total })}>
          <Bars rows={projects.byStatus} total={projects.total} label={k => t(`admin.workspace.header.status.${k}` as TKey)} />
          <Split>
            <Bars rows={projects.byTier} total={projects.total} label={k => labels.tier(k)} />
          </Split>
          <Foot>{t('admin.analytics.tracking', { n: projects.tracking, total: projects.total })}</Foot>
        </Panel>

        <Panel title={t('admin.analytics.stages')} sub={t('admin.analytics.stagesSub')}>
          <Bars rows={projects.byStage} total={projects.total} label={k => t('admin.ops.pipelineStage', { n: Number(k) })} />
        </Panel>

        <Panel title={t('admin.analytics.finance')} sub={t('admin.analytics.financeSub')}>
          {finance === null ? (
            <Unavailable text={t('admin.ledger.unavailable')} />
          ) : (
            <>
              <Figures rows={[
                [t('admin.finops.expected'),   formatUSDFull(finance.expected)],
                [t('admin.finops.funded'),     formatUSDFull(finance.funded)],
                [t('admin.finops.authorised'), formatUSDFull(finance.authorised)],
                [t('admin.finops.inTransit'),  formatUSDFull(finance.inTransit)],
                [t('admin.finops.disbursed'),  formatUSDFull(finance.disbursed)],
              ]} />
              <Foot>
                <Link to="/admin/budgets" className="font-semibold underline-offset-2 hover:underline">
                  {t('admin.analytics.needsAttention', { n: finance.needsAttention })}
                </Link>
              </Foot>
            </>
          )}
        </Panel>

        <Panel title={t('admin.analytics.verification')} sub={t('admin.analytics.verificationSub')}>
          {verification === null ? <Unavailable text={t('admin.verifiers.profilesUnavailable')} /> : (
            <Figures rows={[
              [t('verifier.decision.pending'),             String(verification.pending)],
              [t('verifier.decision.verified'),            String(verification.verified)],
              [t('verifier.decision.rejected'),            String(verification.rejected)],
              [t('verifier.decision.needs_more_evidence'), String(verification.needsMore)],
            ]} />
          )}
        </Panel>

        <Panel title={t('admin.analytics.communication')} sub={t('admin.analytics.communicationSub')}>
          {communication === null ? <Unavailable text={t('admin.inbox.unavailable')} /> : (
            <>
              <Figures rows={[
                [t('admin.analytics.conversations'), String(communication.conversations)],
                [t('admin.inbox.needsReply'),        String(communication.needsReply)],
                [t('admin.workspace.conversations.status.resolved'), String(communication.resolved)],
              ]} />
              <Foot>
                <Link to="/admin/inbox?status=waiting_on_us" className="font-semibold underline-offset-2 hover:underline">
                  {t('admin.analytics.openInbox')}
                </Link>
              </Foot>
            </>
          )}
        </Panel>

        <Panel title={t('admin.analytics.acquisition')} sub={t('admin.analytics.acquisitionSub')}>
          <Figures rows={[
            [t('nav.applications'),  String(acquisition.applicationsPending)],
            [t('nav.startedApplications'), String(acquisition.drafts)],
            [t('nav.waitlist'),      String(acquisition.waitlist)],
            [t('nav.quoteRequests'), String(acquisition.quoteRequests)],
            [t('nav.support'),       String(support.open)],
          ]} />
        </Panel>

        <Panel title={t('admin.analytics.field')} sub={t('admin.analytics.fieldSub')}>
          {field === null ? <Unavailable text={t('admin.siteUpdates.unavailable')} /> : (
            <>
              <Figures rows={[
                [t('admin.analytics.updates'),      String(field.siteUpdates)],
                [t('admin.analytics.contributors'), String(field.contributors)],
              ]} />
              <Foot>
                <Link to="/admin/site-updates" className="font-semibold underline-offset-2 hover:underline">
                  {t('admin.analytics.openFeed')}
                </Link>
              </Foot>
            </>
          )}
        </Panel>
      </div>

      <p className="text-[11px] text-brand-mid-grey">{t('admin.analytics.noTrends')}</p>
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="self-start overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{title}</h2>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{sub}</p>
      </header>
      {children}
    </section>
  );
}

/** A proportion of a real total — never a time series. */
function Bars({ rows, total, label }: { rows: Bucket[]; total: number; label: (key: string) => string }) {
  if (rows.length === 0 || total === 0) return null;
  return (
    <ul className="space-y-2 px-5 py-4">
      {rows.map(r => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-brand-near-black dark:text-white">{label(r.key)}</span>
            <span className="shrink-0 tabular-nums text-brand-mid-grey">{r.count}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-brand-off-white dark:bg-[#252525]">
            <div className="h-full rounded-full bg-brand-near-black dark:bg-white" style={{ width: `${Math.round((r.count / total) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Figures({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-brand-border-grey text-xs dark:divide-[#2c2c2c]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
          <dt className="text-brand-mid-grey">{label}</dt>
          <dd className="font-semibold tabular-nums text-brand-near-black dark:text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Split({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-brand-border-grey dark:border-[#2c2c2c]">{children}</div>;
}

function Foot({ children }: { children: React.ReactNode }) {
  return <p className={cn('border-t border-brand-border-grey px-5 py-2.5 text-[11px] text-brand-mid-grey dark:border-[#2c2c2c]')}>{children}</p>;
}

function Unavailable({ text }: { text: string }) {
  return <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{text}</p>;
}
