import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, AlertTriangle, Mail } from 'lucide-react';
import {
  listSupportTickets, updateSupportTicket,
  type SupportTicket, type TicketStatus,
} from '@/lib/supabase/support';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';

// =========================================================
// /admin/support
//
// The queue for `support_tickets` (migration 074). Until that migration there was no
// table at all: `help.tsx` and the profile Close-account flow both wrote to it, both
// caught the "relation does not exist" error, and both told the person it had worked. So
// every support message and every account-deletion request since launch was discarded.
//
// The email and the notification bell fire from a trigger on the table, so nothing here
// is load-bearing for someone finding out about a ticket. This screen is for working
// through them — and for the account-deletion requests, which have a clock on them and
// are pinned to the top of the default view for that reason.
// =========================================================

// A static map rather than a template-literal key: `fr.ts` is typed `Mirror<EnDict>`, so
// spelling these out is what makes `tsc` prove both dictionaries carry them.
const STATUS_KEY: Record<TicketStatus, TKey> = {
  open:        'admin.support.statusOpen',
  in_progress: 'admin.support.statusInProgress',
  resolved:    'admin.support.statusResolved',
  closed:      'admin.support.statusClosed',
};
const STATUSES = Object.keys(STATUS_KEY) as TicketStatus[];

export default function AdminSupport() {
  const t = useT();
  const { lang } = useLanguage();

  const [rows, setRows]       = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [filter, setFilter]   = useState<'open' | 'all'>('open');
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listSupportTickets()
      .then(r  => { if (alive) setRows(r); })
      .catch(() => { if (alive) setError(t('admin.support.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  async function setStatus(ticket: SupportTicket, status: TicketStatus) {
    setBusyId(ticket.id); setSaveError(null);
    try {
      await updateSupportTicket(ticket.id, { status });
      setRows(prev => prev.map(r => (r.id === ticket.id ? { ...r, status } : r)));
    } catch {
      setSaveError(t('admin.support.saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const openCount     = useMemo(() => rows.filter(r => r.status === 'open').length, [rows]);
  const deletionCount = useMemo(
    () => rows.filter(r => r.kind === 'account_deletion' && r.status !== 'closed' && r.status !== 'resolved').length,
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(r => (filter === 'all' ? true : r.status === 'open'))
      .filter(r => !q
        || r.email.toLowerCase().includes(q)
        || r.subject.toLowerCase().includes(q)
        || r.message.toLowerCase().includes(q)
        || (r.name ?? '').toLowerCase().includes(q))
      // Deletion requests first — they are the ones with a deadline attached.
      .sort((a, b) => Number(b.kind === 'account_deletion') - Number(a.kind === 'account_deletion'));
  }, [rows, query, filter]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB',
          { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.support.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.support.subtitle')}</p>
      </header>

      {deletionCount > 0 && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-state-alert/40 bg-state-alert/5 px-4 py-3">
          <AlertTriangle className="mt-px size-4 shrink-0 text-state-alert" aria-hidden />
          <p className="text-sm text-brand-near-black">
            {t('admin.support.deletionsPending', { count: deletionCount })}
          </p>
        </div>
      )}

      {!loading && !error && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Chip active={filter === 'open'} onClick={() => setFilter('open')}>
              {t('admin.support.filterOpen')} · {openCount}
            </Chip>
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
              {t('admin.support.filterAll')} · {rows.length}
            </Chip>
          </div>

          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('admin.support.search')}
              aria-label={t('admin.support.search')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
            />
          </div>
        </div>
      )}

      {saveError && (
        <p role="alert" className="mb-4 rounded-xl border border-state-alert/40 bg-state-alert/5 px-4 py-2.5 text-sm text-state-alert">
          {saveError}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </p>
      ) : error ? (
        <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-brand-mid-grey">
          {rows.length === 0 ? t('admin.support.empty') : t('admin.support.emptyFiltered')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map(r => (
            <li
              key={r.id}
              className={cn(
                'rounded-xl border p-4',
                r.kind === 'account_deletion'
                  ? 'border-state-alert/40 bg-state-alert/[0.03]'
                  : 'border-brand-border-grey bg-white',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.kind === 'account_deletion' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-state-alert px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        <AlertTriangle className="size-2.5" /> {t('admin.support.kindDeletion')}
                      </span>
                    )}
                    <p className="text-sm font-semibold text-brand-near-black">{r.subject}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-brand-mid-grey">
                    {r.name ? `${r.name} · ` : ''}
                    <a href={`mailto:${r.email}?subject=Re: ${encodeURIComponent(r.subject)}`}
                       className="underline underline-offset-2 hover:text-brand-near-black">
                      {r.email}
                    </a>
                    {' · '}
                    <span className="tabular-nums">{fmt(r.created_at)}</span>
                    {/* The account may since have been closed; the ticket outlives it. */}
                    {r.user_id === null && <> · {t('admin.support.accountGone')}</>}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`mailto:${r.email}?subject=Re: ${encodeURIComponent(r.subject)}`}
                    className="flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white"
                  >
                    <Mail className="size-3" /> {t('admin.support.reply')}
                  </a>
                  <select
                    value={r.status}
                    disabled={busyId === r.id}
                    onChange={e => setStatus(r, e.target.value as TicketStatus)}
                    aria-label={t('admin.support.status')}
                    className="rounded-lg border border-brand-border-grey bg-white px-2 py-1.5 text-xs font-medium text-brand-near-black outline-none focus:ring-2 focus:ring-brand-near-black/20 disabled:opacity-50"
                  >
                    {STATUSES.map(s => (
                      <option key={s} value={s}>{t(STATUS_KEY[s])}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* The reporter's own words. Not editable anywhere — a trigger pins them. */}
              <p className="mt-3 whitespace-pre-wrap border-t border-brand-border-grey/60 pt-3 text-sm leading-relaxed text-brand-near-black">
                {r.message}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand-near-black bg-brand-near-black text-white'
          : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black',
      )}
    >
      {children}
    </button>
  );
}
