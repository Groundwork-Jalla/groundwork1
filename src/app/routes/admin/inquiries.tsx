import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, HardHat } from 'lucide-react';
import {
  listInquiries, updateInquiry,
  type ContractorInquiry, type InquiryStatus,
} from '@/lib/supabase/admin-inquiries';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';

// =========================================================
// /admin/inquiries
//
// Quote requests from homeowners to contractors (migration 076). This queue is not a
// convenience — it is the whole contact path. Contractor phone numbers and emails are
// staff-only at the database (075), so an introduction happens because somebody here
// makes it happen.
//
// Before 076 the Request Quote dialog's submit handler was
// `(e) => { e.preventDefault(); setSubmitted(true); }` — it showed a confirmation and
// sent nothing. Every request since the directory shipped was lost.
// =========================================================

const STATUS_KEY: Record<InquiryStatus, TKey> = {
  open:       'admin.inquiries.statusOpen',
  introduced: 'admin.inquiries.statusIntroduced',
  declined:   'admin.inquiries.statusDeclined',
  closed:     'admin.inquiries.statusClosed',
};
const STATUSES = Object.keys(STATUS_KEY) as InquiryStatus[];

export default function AdminInquiries() {
  const t = useT();
  const { lang } = useLanguage();

  const [rows, setRows]       = useState<ContractorInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [filter, setFilter]   = useState<'open' | 'all'>('open');
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listInquiries()
      .then(r  => { if (alive) setRows(r); })
      .catch(() => { if (alive) setError(t('admin.inquiries.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  async function setStatus(row: ContractorInquiry, status: InquiryStatus) {
    setBusyId(row.id); setSaveError(null);
    try {
      await updateInquiry(row.id, { status });
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, status } : r)));
    } catch {
      setSaveError(t('admin.inquiries.saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const openCount = useMemo(() => rows.filter(r => r.status === 'open').length, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(r => (filter === 'all' ? true : r.status === 'open'))
      .filter(r => !q
        || r.name.toLowerCase().includes(q)
        || r.location.toLowerCase().includes(q)
        || r.message.toLowerCase().includes(q)
        || (r.contractor?.name ?? '').toLowerCase().includes(q));
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
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.inquiries.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.inquiries.subtitle')}</p>
      </header>

      {!loading && !error && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Chip active={filter === 'open'} onClick={() => setFilter('open')}>
              {t('admin.inquiries.filterOpen')} · {openCount}
            </Chip>
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
              {t('admin.inquiries.filterAll')} · {rows.length}
            </Chip>
          </div>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={t('admin.inquiries.search')} aria-label={t('admin.inquiries.search')}
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
          {rows.length === 0 ? t('admin.inquiries.empty') : t('admin.inquiries.emptyFiltered')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map(r => (
            <li key={r.id} className="rounded-xl border border-brand-border-grey bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-near-black">
                    <HardHat className="size-3.5 shrink-0 text-brand-mid-grey" aria-hidden />
                    {r.contractor?.name ?? t('admin.inquiries.contractorGone')}
                    {r.contractor?.trade && (
                      <span className="font-normal text-brand-mid-grey">· {r.contractor.trade}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-brand-mid-grey">
                    {r.name} · {r.location} · {r.build_type}
                    {' · '}<span className="tabular-nums">{fmt(r.created_at)}</span>
                    {/* The account may have closed since; the inquiry outlives it. */}
                    {r.user_id === null && <> · {t('admin.inquiries.accountGone')}</>}
                  </p>
                </div>
                <select
                  value={r.status}
                  disabled={busyId === r.id}
                  onChange={e => setStatus(r, e.target.value as InquiryStatus)}
                  aria-label={t('admin.inquiries.status')}
                  className="shrink-0 rounded-lg border border-brand-border-grey bg-white px-2 py-1.5 text-xs font-medium text-brand-near-black outline-none focus:ring-2 focus:ring-brand-near-black/20 disabled:opacity-50"
                >
                  {STATUSES.map(s => <option key={s} value={s}>{t(STATUS_KEY[s])}</option>)}
                </select>
              </div>

              {/* What the homeowner wrote. Not editable anywhere — a trigger pins it. */}
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
