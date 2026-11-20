import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Search, AlertTriangle, MessagesSquare, X } from 'lucide-react';
import {
  listSupportTickets, updateSupportTicket,
  type SupportTicket, type TicketStatus,
} from '@/lib/supabase/support';
import {
  linkTicket, listConversations, listConversationPreviews,
  type Conversation, type ConversationPreview,
} from '@/lib/supabase/conversations';
import { listProjectsForPeople, type InboxProject } from '@/lib/supabase/inbox-context';
import { projectContext } from '@/lib/admin/inbox-context';
import { ticketThread, byRecency } from '@/lib/admin/ticket-thread';
import { formatRelative } from '@/lib/format';
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
  /**
   * Every thread a person has (091), so a reply happens in Groundwork rather than in
   * whatever mail client the operator happens to have open. A ticket is a CASE with a
   * lifecycle; the words belong in the one conversation store, never a second one.
   *
   * ALL of them, not the newest: which thread a ticket belongs to is decided by
   * `ticketThread()`, and a person with several is a question, not a sort order.
   *
   * `null` while unknown and when 091 is absent — the action is then honestly
   * unavailable rather than a button that does nothing.
   */
  const [threads, setThreads]   = useState<Map<string, Conversation[]> | null>(null);
  const [byId, setById]         = useState<Map<string, Conversation>>(new Map());
  const [previews, setPreviews] = useState<Map<string, ConversationPreview>>(new Map());
  const [projects, setProjects] = useState<Map<string, InboxProject[]>>(new Map());
  /** The ticket whose chooser is open. Nothing is linked until a row in it is clicked. */
  const [choosing, setChoosing] = useState<SupportTicket | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listSupportTickets()
      .then(r  => { if (alive) setRows(r); })
      .catch(() => { if (alive) setError(t('admin.support.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  // One read for the page: every conversation, grouped by the person it is with, plus
  // the last message and the person's projects — enough for an operator to tell two
  // threads apart in the chooser without opening either.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { rows, available } = await listConversations();
      if (!alive) return;
      if (!available) { setThreads(null); return; }

      const byPerson = new Map<string, Conversation[]>();
      const index = new Map<string, Conversation>();
      for (const c of rows) {
        index.set(c.id, c);
        if (!c.personId) continue;
        byPerson.set(c.personId, [...(byPerson.get(c.personId) ?? []), c]);
      }
      setThreads(byPerson); setById(index);

      // Context for the chooser only. Neither read may stop the page working: a failure
      // here costs a preview line, never the ability to open a thread.
      const [p, proj] = await Promise.all([
        listConversationPreviews(rows.map(c => c.id)).catch(() => ({ previews: new Map<string, ConversationPreview>() })),
        listProjectsForPeople([...byPerson.keys()]).catch(() => ({ byPerson: new Map<string, InboxProject[]>() })),
      ]);
      if (!alive) return;
      setPreviews(p.previews); setProjects(proj.byPerson);
    })().catch(() => { if (alive) setThreads(null); });
    return () => { alive = false; };
  }, []);

  /**
   * Opening the thread also records that this ticket is about it (`link_ticket`, 091),
   * so the case and the conversation stop being two unrelated facts — and so the next
   * operator inherits the decision instead of facing the same chooser.
   *
   * The local row is updated too, which is what makes a chosen thread stick: the next
   * render resolves `linked` rather than `choose`. A failure to link must not stop an
   * operator answering a customer, so it is logged, not surfaced.
   */
  function noteLink(ticket: SupportTicket, conversationId: string) {
    setRows(prev => prev.map(r => (r.id === ticket.id ? { ...r, conversation_id: conversationId } : r)));
    void linkTicket(ticket.id, undefined, conversationId).catch(() => { /* the reply matters more */ });
  }

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

  const selected = useMemo(
    () => filtered.find(r => r.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB',
          { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const renderThreadAction = (r: SupportTicket) => {
    const resolved = ticketThread(r, threads, byId);
    if (resolved.kind === 'linked' || resolved.kind === 'single') {
      const id = resolved.conversation.id;
      return (
        <Link
          to={`/admin/inbox?conversation=${id}`}
          onClick={() => noteLink(r, id)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-1.5 text-xs font-semibold text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white"
        >
          <MessagesSquare className="size-3.5" /> {t('admin.support.openThread')}
        </Link>
      );
    }
    if (resolved.kind === 'choose') {
      return (
        <button
          type="button"
          onClick={() => setChoosing(r)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-brand-near-black px-3 py-1.5 text-xs font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white dark:border-white dark:text-white"
        >
          <MessagesSquare className="size-3.5" />
          {t('admin.support.chooseThread', { count: resolved.conversations.length })}
        </button>
      );
    }
    const why: TKey = resolved.kind === 'unavailable' ? 'admin.support.inboxUnavailable'
                    : resolved.kind === 'linkedMissing' ? 'admin.support.threadUnreadable'
                    : 'admin.support.noThreadHint';
    return (
      <span
        title={t(why)}
        className="inline-flex cursor-default items-center gap-1.5 rounded-xl border border-dashed border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-mid-grey dark:border-[#2c2c2c]"
      >
        <MessagesSquare className="size-3.5" /> {t('admin.support.noThread')}
      </span>
    );
  };

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white">{t('admin.support.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.support.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Chip active={filter === 'open'} onClick={() => setFilter('open')}>
            {t('admin.support.filterOpen')} · {openCount}
          </Chip>
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            {t('admin.support.filterAll')} · {rows.length}
          </Chip>
        </div>
      </header>

      {/* Split-Pane Ops KPI Strip */}
      {!loading && !error && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <p className="text-xs font-medium text-brand-mid-grey">{t('admin.support.filterOpen')}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-brand-near-black dark:text-white">{openCount}</p>
          </div>
          <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <p className="text-xs font-medium text-brand-mid-grey">{t('admin.support.kindDeletion')}</p>
            <p className={cn('mt-1 text-2xl font-extrabold tabular-nums', deletionCount > 0 ? 'text-state-alert' : 'text-brand-near-black dark:text-white')}>{deletionCount}</p>
          </div>
          <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <p className="text-xs font-medium text-brand-mid-grey">{t('admin.support.filterAll')}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-brand-near-black dark:text-white">{rows.length}</p>
          </div>
        </div>
      )}

      {deletionCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-state-alert/40 bg-state-alert/5 px-4 py-3">
          <AlertTriangle className="mt-px size-4 shrink-0 text-state-alert" aria-hidden />
          <p className="text-sm text-brand-near-black dark:text-white">
            {t('admin.support.deletionsPending', { count: deletionCount })}
          </p>
        </div>
      )}

      {!loading && !error && (
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('admin.support.search')}
            aria-label={t('admin.support.search')}
            className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
          />
        </div>
      )}

      {saveError && (
        <p role="alert" className="rounded-xl border border-state-alert/40 bg-state-alert/5 px-4 py-2.5 text-sm text-state-alert">
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
        <p className="rounded-2xl border border-brand-border-grey bg-white py-12 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {rows.length === 0 ? t('admin.support.empty') : t('admin.support.emptyFiltered')}
        </p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_25rem]">
          {/* Left Triage Queue */}
          <div className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {filtered.map(r => {
                const active = r.id === selected?.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className={cn(
                        'flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-colors',
                        active
                          ? 'bg-brand-green/[0.06] shadow-[inset_3px_0_0_var(--color-brand-green)]'
                          : r.kind === 'account_deletion'
                            ? 'bg-state-alert/[0.03] hover:bg-state-alert/[0.06]'
                            : 'hover:bg-brand-off-white dark:hover:bg-[#242424]',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {r.kind === 'account_deletion' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-state-alert px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              <AlertTriangle className="size-2.5" /> {t('admin.support.kindDeletion')}
                            </span>
                          )}
                          <p className="truncate text-sm font-semibold text-brand-near-black dark:text-white">{r.subject}</p>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-brand-mid-grey">
                          {r.name ? `${r.name} · ` : ''}{r.email}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                          r.status === 'open' ? 'bg-state-alert/10 text-state-alert'
                            : r.status === 'in_progress' ? 'bg-state-held/15 text-state-held'
                            : 'bg-state-complete/10 text-state-complete',
                        )}>
                          {t(STATUS_KEY[r.status])}
                        </span>
                        <span className="text-[11px] tabular-nums text-brand-muted-grey">{fmt(r.created_at)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Right Ticket Detail & Actions Pane */}
          {selected && (
            <aside className="sticky top-4 rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  {selected.kind === 'account_deletion' && (
                    <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-state-alert px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      <AlertTriangle className="size-2.5" /> {t('admin.support.kindDeletion')}
                    </span>
                  )}
                  <h2 className="text-base font-extrabold text-brand-near-black dark:text-white">{selected.subject}</h2>
                  <p className="mt-0.5 text-xs text-brand-mid-grey">
                    {selected.name ? `${selected.name} · ` : ''}{selected.email} · {fmt(selected.created_at)}
                    {selected.user_id === null && <> · {t('admin.support.accountGone')}</>}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-brand-border-grey bg-brand-off-white p-3.5 text-sm leading-relaxed text-brand-near-black whitespace-pre-wrap dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white">
                {selected.message}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-brand-border-grey pt-4 dark:border-[#2c2c2c]">
                {renderThreadAction(selected)}
                <select
                  value={selected.status}
                  disabled={busyId === selected.id}
                  onChange={e => setStatus(selected, e.target.value as TicketStatus)}
                  aria-label={t('admin.support.status')}
                  className="rounded-xl border border-brand-border-grey bg-white px-3 py-1.5 text-xs font-semibold text-brand-near-black outline-none focus:border-brand-green disabled:opacity-50 dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white"
                >
                  {STATUSES.map(s => (
                    <option key={s} value={s}>{t(STATUS_KEY[s])}</option>
                  ))}
                </select>
              </div>
            </aside>
          )}
        </div>
      )}

      {choosing && (
        <ThreadChooser
          ticket={choosing}
          conversations={byRecency(threads?.get(choosing.user_id ?? '') ?? [])}
          previews={previews}
          projects={projects}
          onPick={id => { noteLink(choosing, id); }}
          onClose={() => setChoosing(null)}
        />
      )}
    </div>
  );
}

/**
 * Which of this person's threads is the ticket about? Groundwork does not know, so it
 * shows what it does know — channel, project, when, and the last thing said — and lets
 * the operator decide. Picking a row links the ticket (091) and opens that thread.
 */
function ThreadChooser({
  ticket, conversations, previews, projects, onPick, onClose,
}: {
  ticket: SupportTicket;
  conversations: Conversation[];
  previews: Map<string, ConversationPreview>;
  projects: Map<string, InboxProject[]>;
  onPick: (conversationId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={t('admin.support.chooseTitle')}
        onClick={e => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-brand-border-grey bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-brand-border-grey px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-brand-near-black">{t('admin.support.chooseTitle')}</h2>
            <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.support.chooseSub')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-lg p-1 text-brand-mid-grey hover:bg-brand-off-white">
            <X className="size-4" />
          </button>
        </header>

        <ul className="max-h-[56vh] overflow-y-auto divide-y divide-brand-border-grey">
          {conversations.map(c => {
            const ctx = projectContext(c, projects);
            const last = previews.get(c.id) ?? null;
            return (
              <li key={c.id}>
                <Link
                  to={`/admin/inbox?conversation=${c.id}`}
                  onClick={() => onPick(c.id)}
                  className="block px-5 py-3 transition-colors hover:bg-brand-off-white"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-brand-near-black">
                      {t(`admin.workspace.conversations.channel.${c.channel}` as TKey)}
                    </span>
                    <span className="shrink-0 text-[11px] text-brand-mid-grey">
                      {c.lastMessageAt ? formatRelative(c.lastMessageAt) : t('admin.support.neverUsed')}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-brand-mid-grey">
                    {/* A linked project is a fact about the thread; one the person merely
                        owns is context, and several is no answer at all. */}
                    {ctx.kind === 'linked' && ctx.project ? ctx.project.name
                      : ctx.kind === 'account' && ctx.project ? t('admin.support.ownerOf', { name: ctx.project.name })
                      : ctx.kind === 'choice' ? t('admin.support.severalProjects', { count: ctx.projects.length })
                      : t('admin.support.noProjectContext')}
                  </p>
                  {last && (
                    <p className="mt-1 truncate text-xs text-brand-near-black">{last.content}</p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="border-t border-brand-border-grey px-5 py-2.5 text-[11px] text-brand-mid-grey">
          {t('admin.support.chooseFoot', { subject: ticket.subject })}
        </p>
      </div>
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
          ? 'border-brand-green bg-brand-green text-white'
          : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black',
      )}
    >
      {children}
    </button>
  );
}
