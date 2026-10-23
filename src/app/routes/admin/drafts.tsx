import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Trash2, ChevronDown, ChevronRight, Mail, Phone } from 'lucide-react';
import {
  fetchApplicationDrafts, deleteApplicationDraft, type DraftRow,
} from '@/lib/supabase/application-drafts';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { readAnswers, humanise } from '@/lib/admin/draft-answers';
import { useT, useLanguage, type TKey } from '@/lib/i18n';

// =========================================================
// /admin/drafts
//
// Contractor applications that were started and not sent. The form asks for nineteen
// things and a document upload, so a good number of people stop part-way; this is the
// list of them, and the reason `contractor_application_drafts` exists.
//
// Sorted by how far they got, not by date. Someone at 85% needs one nudge; someone at
// 10% typed their email and left. The two are different jobs and the sort is what
// separates them.
// =========================================================

export default function AdminDrafts() {
  const t = useT();
  const { lang } = useLanguage();

  const [rows, setRows]         = useState<DraftRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [query, setQuery]       = useState('');
  const [includeDone, setIncludeDone] = useState(false);
  const [open, setOpen]         = useState<string | null>(null);
  const [target, setTarget]     = useState<DraftRow | null>(null);
  const [busy, setBusy]         = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchApplicationDrafts(!includeDone)
      .then(r  => { if (alive) { setRows(r); setError(null); } })
      .catch(e => { if (alive) setError(errorMessage(e, t('admin.drafts.loadFailed'))); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [includeDone, t]);

  async function confirmDelete() {
    if (!target) return;
    setBusy(true); setDelError(null);
    try {
      await deleteApplicationDraft(target.id);
      setRows(prev => prev.filter(r => r.id !== target.id));
      setTarget(null);
    } catch (e) {
      setDelError(errorMessage(e, t('admin.del.failed')));
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (r: DraftRow) =>
      !q || [r.full_name, r.email, r.phone,
             // So "partner" and "contractor" work as filters, not just as labels.
             t(r.source === 'in_app' ? 'admin.drafts.sourcePartner' : 'admin.drafts.sourceContractor'),
            ].some(v => v?.toLowerCase().includes(q));
    // Furthest along first — see the header note.
    return rows.filter(hit).sort((a, b) => b.progress_pct - a.progress_pct);
  }, [rows, query, t]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB',
          { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.drafts.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.drafts.subtitle')}</p>
      </header>

      {!loading && !error && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Chip active={!includeDone} onClick={() => setIncludeDone(false)}>
              {t('admin.drafts.filterOpen')}
            </Chip>
            <Chip active={includeDone} onClick={() => setIncludeDone(true)}>
              {t('admin.drafts.filterAll')}
            </Chip>
          </div>

          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('admin.drafts.search')}
              aria-label={t('admin.drafts.search')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
            />
          </div>
        </div>
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
          {rows.length === 0 ? t('admin.drafts.empty') : t('admin.drafts.emptyFiltered')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(r => {
            const expanded = open === r.id;
            return (
              <div key={r.id} className="rounded-xl border border-brand-border-grey bg-white">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : r.id)}
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {expanded
                      ? <ChevronDown className="size-4 shrink-0 text-brand-mid-grey" />
                      : <ChevronRight className="size-4 shrink-0 text-brand-mid-grey" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-brand-near-black">
                          {r.full_name || r.email || t('admin.drafts.anonymous')}
                        </span>
                        {/* Which door they started at (138). A partner already has an
                            account and stopped short of a call with Philip; a contractor
                            is a stranger who typed an email into the public form. Same
                            list, opposite follow-up, so the row has to say which. */}
                        <span className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          r.source === 'in_app'
                            ? 'bg-brand-near-black text-white'
                            : 'bg-brand-light-grey text-brand-mid-grey',
                        )}>
                          {t(r.source === 'in_app'
                            ? 'admin.drafts.sourcePartner' : 'admin.drafts.sourceContractor')}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-brand-mid-grey">
                        {[r.role, r.email, r.phone].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    {/* The bar is the whole point of the screen: it says who is worth a
                        call today. Percentage beside it because "nearly" is not a number
                        anyone can act on. */}
                    <span className="hidden w-32 shrink-0 items-center gap-2 sm:flex">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-light-grey">
                        <span
                          className="block h-full rounded-full bg-brand-near-black"
                          style={{ width: `${r.progress_pct}%` }}
                        />
                      </span>
                      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-brand-mid-grey">
                        {r.progress_pct}%
                      </span>
                    </span>
                    <span className="hidden shrink-0 whitespace-nowrap text-xs tabular-nums text-brand-mid-grey md:block">
                      {fmt(r.updated_at)}
                    </span>
                    {r.submitted_application_id && (
                      <span className="shrink-0 rounded-full bg-brand-off-white px-2 py-0.5 text-[11px] font-medium text-brand-mid-grey">
                        {t('admin.drafts.submitted')}
                      </span>
                    )}
                  </button>

                  {r.email && (
                    <a
                      href={`mailto:${r.email}`}
                      aria-label={`${t('admin.drafts.emailThem')} ${r.email}`}
                      className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-brand-near-black"
                    >
                      <Mail className="size-3.5" />
                    </a>
                  )}
                  {r.phone && (
                    <a
                      href={`tel:${r.phone}`}
                      aria-label={`${t('admin.drafts.callThem')} ${r.phone}`}
                      className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-brand-near-black"
                    >
                      <Phone className="size-3.5" />
                    </a>
                  )}
                  <button
                    type="button" onClick={() => setTarget(r)}
                    aria-label={`${t('admin.del.confirm')} ${r.email ?? r.id}`}
                    className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-state-alert"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {expanded && <Answers payload={r.payload} />}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDelete
        open={!!target}
        subject={target?.email ?? target?.full_name ?? ''}
        busy={busy}
        error={delError}
        onConfirm={confirmDelete}
        onCancel={() => { setTarget(null); setDelError(null); }}
      />
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

/**
 * What the applicant actually said, so far.
 *
 * Walks whatever is in the payload rather than a list of expected fields — the raw JSON
 * this replaces was deliberate for exactly that reason, and the form's shape has changed
 * twice this week. A field nobody has labelled yet still shows, under its own name, so
 * nothing can go missing.
 */
function Answers({ payload }: { payload: unknown }) {
  const t = useT();
  const answers = readAnswers(payload);
  if (!answers.length) return null;

  const show = (key: TKey | null, fallback: string) => {
    if (!key) return fallback;
    const out = t(key);
    // t() hands back the key when it is missing; the raw value beats a raw key.
    return out === key ? fallback : out;
  };

  return (
    <div className="border-t border-brand-border-grey px-4 py-3 dark:border-[#2c2c2c]">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {answers.map(a => (
          <div key={a.key} className={a.answered ? '' : 'opacity-45'}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
              {show(a.labelKey, humanise(a.key))}
            </dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs text-brand-near-black dark:text-white">
              {a.answered
                ? show(a.valueKey, a.raw)
                : <span className="text-brand-mid-grey">{t('admin.drafts.unanswered')}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
