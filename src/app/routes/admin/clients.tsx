import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, Loader2, UserRound } from 'lucide-react';
import { listClients, type ClientDirectory, type ClientRow } from '@/lib/supabase/admin-clients';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDomainLabels } from '@/lib/domain-labels';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/clients — the people Groundwork builds for (01 §3 PEOPLE).
//
// A VIEW over `profiles` and the projects they own, not a new record: /admin/users lists
// every account, this one answers "who are our clients and how are their builds going?".
// Staff and verifiers are excluded by role, never by guesswork.
//
// Admin manages the actor; admin does not become the actor. Everything here opens the
// client's project workspace or their conversation — it is not a copy of the client's own
// dashboard.
// =========================================================

export default function AdminClients() {
  const t = useT();
  const labels = useDomainLabels();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const withProjects = params.get('projects') === 'with';

  const [data, setData] = useState<ClientDirectory | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await listClients()); setError(null); }
    catch (err) { setData({ rows: [], conversationsAvailable: false, ticketsAvailable: false }); setError(errorMessage(err, t('common.somethingWrong'))); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const setParam = (key: string, value: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  const shown = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter(c =>
      (!withProjects || c.projects.length > 0)
      && (!q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
          || c.projects.some(p => p.name.toLowerCase().includes(q))));
  }, [data, query, withProjects]);

  const building = (data?.rows ?? []).filter(c => c.projects.length > 0).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.clients.title')}</h1>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.clients.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={query} onChange={e => setParam('q', e.target.value || null)}
            placeholder={t('admin.clients.search')} aria-label={t('admin.clients.search')}
            className="w-52 rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 text-xs text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white" />
          <button type="button" onClick={() => setParam('projects', withProjects ? null : 'with')} aria-pressed={withProjects}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              withProjects
                ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                : 'border-brand-border-grey text-brand-near-black hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]')}>
            {t('admin.clients.building')}<span className="ml-1.5 tabular-nums">{data ? building : '—'}</span>
          </button>
        </div>
      </header>

      {data === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : error ? (
        <p role="alert" className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 text-xs text-state-alert dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{error}</p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState icon={<UserRound className="size-8" />}
            title={t(data.rows.length === 0 ? 'admin.clients.empty' : 'admin.clients.noMatch')}
            description={t(data.rows.length === 0 ? 'admin.clients.emptyBody' : 'admin.clients.noMatchBody')} />
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map(c => <ClientCard key={c.id} client={c} data={data} labels={labels} />)}
        </ul>
      )}
    </div>
  );
}

function ClientCard({ client, data, labels }: { client: ClientRow; data: ClientDirectory; labels: ReturnType<typeof useDomainLabels> }) {
  const t = useT();
  return (
    <li className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-brand-near-black dark:text-white">{client.name || client.email}</p>
          <p className="mt-0.5 truncate text-[11px] text-brand-mid-grey">
            {client.name ? `${client.email} · ` : ''}
            {t('admin.clients.joined', { when: formatRelative(client.createdAt) })}
            {client.lastSignInAt
              ? ` · ${t('admin.clients.lastSeen', { when: formatRelative(client.lastSignInAt) })}`
              : ` · ${t('admin.clients.neverSignedIn')}`}
          </p>
        </div>
        <dl className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
          <Stat label={t('admin.clients.projects')} value={String(client.projects.length)} />
          <Stat label={t('admin.clients.conversations')}
            value={data.conversationsAvailable ? String(client.conversations ?? 0) : t('admin.clients.notAvailable')} />
          <Stat label={t('admin.clients.openTickets')}
            value={data.ticketsAvailable ? String(client.openTickets ?? 0) : t('admin.clients.notAvailable')} />
        </dl>
      </div>

      {client.projects.length === 0 ? (
        <p className="border-t border-brand-border-grey px-5 py-3 text-[11px] text-brand-mid-grey dark:border-[#2c2c2c]">
          {t('admin.clients.noProjects')}
        </p>
      ) : (
        <ul className="divide-y divide-brand-border-grey border-t border-brand-border-grey dark:divide-[#2c2c2c] dark:border-[#2c2c2c]">
          {client.projects.map(p => (
            <li key={p.id}>
              <Link to={`/admin/projects/${p.id}`} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-brand-near-black dark:text-white">{p.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-brand-mid-grey">
                    {p.currentStage != null && p.stagesTotal > 0
                      ? t('admin.workspace.header.stageOf', { n: p.currentStage, total: p.stagesTotal })
                      : t('admin.clients.noStages')}
                    {p.tier && ` · ${labels.tier(p.tier)}`}
                    {p.status && ` · ${t(`admin.workspace.header.status.${p.status}` as TKey)}`}
                    {(p.city || p.country) && ` · ${[p.city, p.country].filter(Boolean).join(', ')}`}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-brand-muted-grey" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-brand-muted-grey">{label}</dt>
      <dd className="font-semibold tabular-nums text-brand-near-black dark:text-white">{value}</dd>
    </div>
  );
}
