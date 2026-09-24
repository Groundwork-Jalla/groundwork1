import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Loader2, Search, HardHat, MessagesSquare, Building2, User } from 'lucide-react';
import {
  listInquiries, updateInquiry,
  type ContractorInquiry, type InquiryStatus,
} from '@/lib/supabase/admin-inquiries';
import { listConversations, type Conversation } from '@/lib/supabase/conversations';
import { listProjectsForPeople, type InboxProject } from '@/lib/supabase/inbox-context';
import { listAdminUsers, type AdminUser } from '@/lib/supabase/admin-users';
import { INQUIRY_STATUSES, allowedTransitions, isSettled } from '@/lib/admin/inquiry-workflow';
import { personLabel } from '@/lib/admin/inbox-context';
import { byRecency } from '@/lib/admin/ticket-thread';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';

// =========================================================
// /admin/inquiries — quote requests, and the work of answering one (076).
//
// This queue is not a convenience: it is the whole contact path. Contractor phone
// numbers and emails are staff-only at the database (075), so an introduction happens
// because somebody here makes it happen. Before 076 the Request Quote dialog's submit
// handler was `(e) => { e.preventDefault(); setSubmitted(true); }` — it showed a
// confirmation and sent nothing.
//
// ── What this screen may and may not do ──────────────────────────────────────────────
// A trigger in 076 pins `name`, `location`, `build_type`, `message` and `contractor_id`
// on every update. Two columns are writable — `status` and `admin_notes` — and those are
// exactly the two controls below. Nothing here sends anything: marking a request
// `introduced` records a decision, it does not deliver a message, and the screen says so
// rather than letting the word imply a WhatsApp nobody sent.
//
// Context is read, never inferred. The requester's conversations and projects are the
// PERSON's, shown as the person's — 076 has no column linking an inquiry to either, so
// no link here is written and none is claimed.
// =========================================================

const STATUS_KEY: Record<InquiryStatus, TKey> = {
  open:       'admin.inquiries.statusOpen',
  introduced: 'admin.inquiries.statusIntroduced',
  declined:   'admin.inquiries.statusDeclined',
  closed:     'admin.inquiries.statusClosed',
};

/** Context for the requester, each part independently unavailable. */
interface People {
  /** `null` when 091 is absent: conversations are unavailable, which is not "none". */
  threads: Map<string, Conversation[]> | null;
  projects: Map<string, InboxProject[]> | null;
  accounts: Map<string, AdminUser> | null;
}

export default function AdminInquiries() {
  const t = useT();
  const { lang } = useLanguage();

  const [rows, setRows]       = useState<ContractorInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [people, setPeople]   = useState<People>({ threads: null, projects: null, accounts: null });
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // `?status=open` is the Overview's "Quote requests" link: the same condition the KPI
  // counted, carried into the page rather than left to its default. `?inquiry=` selects
  // one, the same way the Inbox carries `?conversation=` — so a row is a real address.
  const [params, setParams]   = useSearchParams();
  const filter: 'open' | 'all' = params.get('status') === 'all' ? 'all' : 'open';
  const selectedId = params.get('inquiry');

  const put = useCallback((key: string, value: string | null) => {
    const p = new URLSearchParams(params);
    if (value === null) p.delete(key); else p.set(key, value);
    setParams(p, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    let alive = true;
    listInquiries()
      .then(r  => { if (alive) setRows(r); })
      .catch(() => { if (alive) setError(t('admin.inquiries.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  // Context for whoever is selected. Each read fails on its own: a missing conversation
  // store must not cost the projects panel, and neither may cost the queue itself.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [conv, users] = await Promise.all([
        listConversations().catch(() => ({ rows: [] as Conversation[], available: false })),
        listAdminUsers().catch(() => null),
      ]);
      if (!alive) return;

      let threads: Map<string, Conversation[]> | null = null;
      if (conv.available) {
        threads = new Map();
        for (const c of conv.rows) {
          if (!c.personId) continue;
          threads.set(c.personId, [...(threads.get(c.personId) ?? []), c]);
        }
      }
      const accounts = users ? new Map(users.map(u => [u.id, u])) : null;
      setPeople(p => ({ ...p, threads, accounts }));
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const ids = [...new Set(rows.map(r => r.user_id).filter((v): v is string => !!v))];
    if (ids.length === 0) return;
    listProjectsForPeople(ids)
      .then(({ byPerson, available }) => { if (alive) setPeople(p => ({ ...p, projects: available ? byPerson : null })); })
      .catch(() => { if (alive) setPeople(p => ({ ...p, projects: null })); });
    return () => { alive = false; };
  }, [rows]);

  async function save(row: ContractorInquiry, patch: { status?: InquiryStatus; admin_notes?: string | null }) {
    setBusyId(row.id); setSaveError(null);
    try {
      await updateInquiry(row.id, patch);
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, ...patch } : r)));
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

  const selected = useMemo(
    () => (selectedId ? rows.find(r => r.id === selectedId) ?? null : null),
    [rows, selectedId],
  );

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
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('admin.inquiries.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.inquiries.subtitle')}</p>
      </header>

      {!loading && !error && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Chip active={filter === 'open'} onClick={() => put('status', 'open')}>
              {t('admin.inquiries.filterOpen')} · {openCount}
            </Chip>
            <Chip active={filter === 'all'} onClick={() => put('status', 'all')}>
              {t('admin.inquiries.filterAll')} · {rows.length}
            </Chip>
          </div>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={t('admin.inquiries.search')} aria-label={t('admin.inquiries.search')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
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
        <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-brand-mid-grey">
          {rows.length === 0 ? t('admin.inquiries.empty') : t('admin.inquiries.emptyFiltered')}
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <ul className="flex flex-col gap-3">
            {filtered.map(r => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => put('inquiry', r.id === selectedId ? null : r.id)}
                  aria-pressed={r.id === selectedId}
                  className={cn(
                    'w-full rounded-xl border bg-white p-4 text-left transition-colors dark:bg-[#1e1e1e]',
                    r.id === selectedId
                      ? 'border-brand-near-black dark:border-white'
                      : 'border-brand-border-grey hover:border-brand-dark-grey dark:border-[#2c2c2c]',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-near-black dark:text-white">
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
                    <StatusPill status={r.status} label={t(STATUS_KEY[r.status])} />
                  </div>

                  {/* What the homeowner wrote. Not editable anywhere — a trigger pins it. */}
                  <p className="mt-3 line-clamp-2 whitespace-pre-wrap border-t border-brand-border-grey/60 pt-3 text-sm leading-relaxed text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
                    {r.message}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="lg:sticky lg:top-6 lg:self-start">
            {selected
              ? <Detail
                  key={selected.id}
                  inquiry={selected}
                  people={people}
                  busy={busyId === selected.id}
                  onSave={patch => save(selected, patch)}
                />
              : <p className="rounded-xl border border-dashed border-brand-border-grey px-5 py-10 text-center text-xs text-brand-mid-grey dark:border-[#2c2c2c]">
                  {t('admin.inquiries.selectHint')}
                </p>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One request, and the two things the database lets an admin change about it.
 *
 * Everything else on this panel is context that belongs to the PERSON, not to the
 * inquiry: 076 has no conversation_id and no project_id, so a thread or a build shown
 * here is offered as theirs to open, never as this request's.
 */
function Detail({ inquiry, people, busy, onSave }: {
  inquiry: ContractorInquiry;
  people: People;
  busy: boolean;
  onSave: (patch: { status?: InquiryStatus; admin_notes?: string | null }) => void;
}) {
  const t = useT();
  const [notes, setNotes] = useState(inquiry.admin_notes ?? '');
  const dirty = notes !== (inquiry.admin_notes ?? '');

  const account  = inquiry.user_id && people.accounts ? people.accounts.get(inquiry.user_id) ?? null : null;
  const who      = personLabel(account?.fullName, account?.email, inquiry.name);
  const threads  = inquiry.user_id && people.threads  ? byRecency(people.threads.get(inquiry.user_id) ?? []) : [];
  const projects = inquiry.user_id && people.projects ? people.projects.get(inquiry.user_id) ?? [] : [];

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('admin.inquiries.detailTitle')}</h2>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.inquiries.detailSub')}</p>
      </header>

      {/* ── Who, and what they asked for ─────────────────────────────────── */}
      <dl className="divide-y divide-brand-border-grey text-xs dark:divide-[#2c2c2c]">
        <Row label={t('admin.inquiries.requester')}>
          {inquiry.user_id === null ? (
            <span className="text-brand-mid-grey">{inquiry.name} · {t('admin.inquiries.accountGone')}</span>
          ) : account ? (
            <Link to={`/admin/clients?q=${encodeURIComponent(account.email)}`} className="inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline">
              <User className="size-3" />{who.primary}
            </Link>
          ) : (
            // Signed in, but not in the account list — say that, do not guess a link.
            <span className="text-brand-mid-grey">{inquiry.name} · {t('admin.inquiries.accountUnknown')}</span>
          )}
          {/* The name typed into the dialog, kept when it differs: they may be asking
              for a relative, and the name they gave is the one to use. */}
          {account && inquiry.name.trim() && inquiry.name.trim() !== who.primary && (
            <span className="block text-brand-mid-grey">{t('admin.inquiries.askedAs', { name: inquiry.name })}</span>
          )}
        </Row>
        <Row label={t('admin.inquiries.contractorAsked')}>
          {inquiry.contractor ? (
            <Link to="/admin/contractors" className="inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline">
              <Building2 className="size-3" />{inquiry.contractor.name}
            </Link>
          ) : (
            <span className="text-brand-mid-grey">{t('admin.inquiries.contractorGone')}</span>
          )}
        </Row>
        <Row label={t('admin.inquiries.where')}>{inquiry.location}</Row>
        <Row label={t('admin.inquiries.buildType')}>{inquiry.build_type}</Row>
      </dl>

      {/* ── The one decision this screen makes ───────────────────────────── */}
      <div className="border-t border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
        <p className="text-xs font-semibold text-brand-near-black dark:text-white">{t('admin.inquiries.status')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {INQUIRY_STATUSES.map(s => {
            const current = s === inquiry.status;
            return (
              <button
                key={s} type="button" disabled={busy || current}
                onClick={() => onSave({ status: s })}
                aria-pressed={current}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-60',
                  current
                    ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-[#0a0a0a]'
                    : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black dark:border-[#2c2c2c]',
                )}
              >
                {t(STATUS_KEY[s])}
              </button>
            );
          })}
        </div>
        {/* The word "introduced" must not do work the database cannot back. */}
        <p className="mt-2 text-[11px] leading-relaxed text-brand-mid-grey">
          {inquiry.status === 'introduced'
            ? t('admin.inquiries.introducedMeans')
            : isSettled(inquiry.status) ? t('admin.inquiries.settledMeans')
            : t('admin.inquiries.statusMeans', { n: allowedTransitions(inquiry.status).length })}
        </p>
      </div>

      {/* ── The only other writable column ───────────────────────────────── */}
      <div className="border-t border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
        <label htmlFor="inquiry-notes" className="text-xs font-semibold text-brand-near-black dark:text-white">
          {t('admin.inquiries.notes')}
        </label>
        <p className="mt-0.5 text-[11px] text-brand-mid-grey">{t('admin.inquiries.notesHint')}</p>
        <textarea
          id="inquiry-notes" rows={3} value={notes} disabled={busy}
          onChange={e => setNotes(e.target.value)}
          className="mt-2 w-full resize-y rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-xs text-brand-near-black outline-none focus:ring-2 focus:ring-brand-near-black/20 disabled:opacity-60 dark:border-[#2c2c2c] dark:bg-[#161616] dark:text-white"
        />
        <button
          type="button" disabled={busy || !dirty}
          onClick={() => onSave({ admin_notes: notes.trim() || null })}
          className="mt-2 rounded-lg bg-brand-near-black px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#0a0a0a]"
        >
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>

      {/* ── Context that belongs to the person, labelled as theirs ───────── */}
      <Context
        title={t('admin.inquiries.theirConversations')}
        unavailable={people.threads === null ? t('admin.inquiries.conversationsUnavailable') : null}
        empty={t('admin.inquiries.noConversations')}
        note={threads.length > 0 ? t('admin.inquiries.conversationNote') : null}
        items={threads.map(c => ({
          key: c.id,
          to: `/admin/inbox?conversation=${c.id}`,
          icon: <MessagesSquare className="size-3 shrink-0" />,
          primary: t(`admin.workspace.conversations.channel.${c.channel}` as TKey),
          secondary: c.lastMessageAt ? formatRelative(c.lastMessageAt) : null,
        }))}
        hidden={inquiry.user_id === null}
      />
      <Context
        title={t('admin.inquiries.theirProjects')}
        unavailable={people.projects === null ? t('admin.inquiries.projectsUnavailable') : null}
        empty={t('admin.inquiries.noProjects')}
        note={null}
        items={projects.map(p => ({
          key: p.id,
          to: `/admin/projects/${p.id}`,
          icon: <Building2 className="size-3 shrink-0" />,
          primary: p.name,
          secondary: p.city,
        }))}
        hidden={inquiry.user_id === null}
      />
    </section>
  );
}

function Context({ title, unavailable, empty, note, items, hidden }: {
  title: string;
  /** Set when the table could not be read at all — which is not the same as none. */
  unavailable: string | null;
  empty: string;
  note: string | null;
  items: { key: string; to: string; icon: React.ReactNode; primary: string; secondary: string | null }[];
  hidden: boolean;
}) {
  if (hidden) return null;
  return (
    <div className="border-t border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
      <p className="text-xs font-semibold text-brand-near-black dark:text-white">{title}</p>
      {unavailable ? (
        <p className="mt-1.5 text-[11px] text-brand-mid-grey">{unavailable}</p>
      ) : items.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-brand-mid-grey">{empty}</p>
      ) : (
        <>
          <ul className="mt-1.5 space-y-1">
            {items.map(i => (
              <li key={i.key}>
                <Link to={i.to} className="flex items-center gap-1.5 text-[11px] text-brand-near-black underline-offset-2 hover:underline dark:text-white">
                  {i.icon}
                  <span className="truncate">{i.primary}</span>
                  {i.secondary && <span className="shrink-0 text-brand-mid-grey">· {i.secondary}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {note && <p className="mt-1.5 text-[11px] text-brand-mid-grey">{note}</p>}
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-2.5">
      <dt className="shrink-0 text-brand-mid-grey">{label}</dt>
      <dd className="min-w-0 text-right text-brand-near-black dark:text-white">{children}</dd>
    </div>
  );
}

function StatusPill({ status, label }: { status: InquiryStatus; label: string }) {
  return (
    <span className={cn(
      'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
      status === 'open'       ? 'bg-brand-near-black text-white dark:bg-white dark:text-[#0a0a0a]'
      : status === 'introduced' ? 'bg-state-complete/10 text-state-complete'
      : 'bg-brand-off-white text-brand-mid-grey dark:bg-[#252525]',
    )}>
      {label}
    </span>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-[#0a0a0a]'
          : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black dark:border-[#2c2c2c]',
      )}
    >
      {children}
    </button>
  );
}
