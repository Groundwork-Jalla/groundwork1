import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, Loader2, Search, UserRound } from 'lucide-react';
import { listClients, type ClientDirectory, type ClientRow } from '@/lib/supabase/admin-clients';
import { EmptyState } from '@/components/ui/EmptyState';
import { PersonPreview, usePersonPreview } from '@/components/admin/PersonPreview';
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
  // Click a name, see what they signed up with — without leaving the list.
  const person = usePersonPreview();
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

  // The selected homeowner is the one whose signup details are open — the row and the
  // docked panel say the same thing (18 Nov redesign).
  const selectedId = person.ref?.userId ?? null;

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white sm:text-[28px]">{t('admin.clients.title')}</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('admin.clients.subtitle')}</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" aria-hidden />
          <input type="search" value={query} onChange={e => setParam('q', e.target.value || null)}
            placeholder={t('admin.clients.search')} aria-label={t('admin.clients.search')}
            className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white" />
        </div>
          <button type="button" onClick={() => setParam('projects', withProjects ? null : 'with')} aria-pressed={withProjects}
            className={cn('rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors',
              withProjects
                ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                : 'border-brand-border-grey bg-white text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white')}>
            {t('admin.clients.building')}<span className="ml-1.5 tabular-nums">{data ? building : '—'}</span>
          </button>
      </div>

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
        <div className={cn('grid items-start gap-4', person.ref && 'lg:grid-cols-[minmax(0,1fr)_23.75rem]')}>
          <ul className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            {shown.map(c => <ClientCard key={c.id} client={c} data={data} labels={labels} onOpen={person.open} selected={c.id === selectedId} />)}
          </ul>
          <PersonPreview reference={person.ref} rolesHint={person.rolesHint} onClose={person.close} docked />
        </div>
      )}
      {(data === null || !!error || shown.length === 0) && (
        <PersonPreview reference={person.ref} rolesHint={person.rolesHint} onClose={person.close} />
      )}
    </div>
  );
}

function ClientCard({ client, data, labels, onOpen, selected }: {
  client: ClientRow; data: ClientDirectory; labels: ReturnType<typeof useDomainLabels>;
  onOpen: (ref: { userId: string; email: string }, rolesHint?: string | null) => void;
  selected?: boolean;
}) {
  const t = useT();
  return (
    <li className={cn(
      'grid gap-4 border-t border-brand-border-grey px-5 py-4 first:border-t-0 md:grid-cols-[minmax(0,1fr)_17.5rem] dark:border-[#2c2c2c]',
      selected && 'bg-[#f3f6f4] shadow-[inset_3px_0_0_var(--color-brand-green)] dark:bg-[#1c2620]',
    )}>
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onOpen({ userId: client.id, email: client.email }, '')}
          title={t('admin.person.view')}
          aria-pressed={selected}
          className="block max-w-full truncate text-left text-[15px] font-bold text-brand-near-black underline-offset-2 hover:underline dark:text-white"
        >
          {client.name || client.email}
        </button>
        <p className="mt-0.5 truncate text-xs text-brand-mid-grey">
          {client.name ? `${client.email} · ` : ''}
          {t('admin.clients.joined', { when: formatRelative(client.createdAt) })}
          {client.lastSignInAt
            ? ` · ${t('admin.clients.lastSeen', { when: formatRelative(client.lastSignInAt) })}`
            : ` · ${t('admin.clients.neverSignedIn')}`}
        </p>
        <dl className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <Stat label={t('admin.clients.projects')} value={String(client.projects.length)} />
          <Stat label={t('admin.clients.conversations')}
            value={data.conversationsAvailable ? String(client.conversations ?? 0) : t('admin.clients.notAvailable')} />
          <Stat label={t('admin.clients.openTickets')}
            value={data.ticketsAvailable ? String(client.openTickets ?? 0) : t('admin.clients.notAvailable')} />
        </dl>
      </div>

      {client.projects.length === 0 ? (
        <p className="self-center text-xs text-brand-mid-grey">{t('admin.clients.noProjects')}</p>
      ) : (
        <ul className="space-y-1.5">
          {client.projects.map(p => (
            <li key={p.id}>
              <Link to={`/admin/projects/${p.id}`} className="flex items-center gap-2 rounded-xl border border-brand-border-grey bg-white px-3 py-2 transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:border-white/40">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-brand-near-black dark:text-white">{p.name}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-brand-mid-grey">
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
    <div className="flex flex-row-reverse items-baseline gap-1">
      <dt className="text-brand-mid-grey">{label}</dt>
      <dd className="text-[13px] font-semibold tabular-nums text-brand-near-black dark:text-white">{value}</dd>
    </div>
  );
}
