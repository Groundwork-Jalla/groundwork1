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
                    <span>{r.email}</span>
                    {' · '}
                    <span className="tabular-nums">{fmt(r.created_at)}</span>
                    {/* The account may since have been closed; the ticket outlives it. */}
                    {r.user_id === null && <> · {t('admin.support.accountGone')}</>}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* Reply where the conversation is, not in a mail client Groundwork
                      cannot see. One thread opens; several ask; none says so. */}
                  {(() => {
                    const resolved = ticketThread(r, threads, byId);
                    if (resolved.kind === 'linked' || resolved.kind === 'single') {
                      const id = resolved.conversation.id;
                      return (
                        <Link
                          to={`/admin/inbox?conversation=${id}`}
                          onClick={() => noteLink(r, id)}
                          className="flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white"
                        >
                          <MessagesSquare className="size-3" /> {t('admin.support.openThread')}
                        </Link>
                      );
                    }
                    if (resolved.kind === 'choose') {
                      return (
                        <button
                          type="button"
                          onClick={() => setChoosing(r)}
                          className="flex items-center gap-1.5 rounded-lg border border-brand-near-black px-2.5 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white"
                        >
                          <MessagesSquare className="size-3" />
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
                        className="flex cursor-default items-center gap-1.5 rounded-lg border border-dashed border-brand-border-grey px-2.5 py-1.5 text-xs font-medium text-brand-mid-grey"
                      >
                        <MessagesSquare className="size-3" /> {t('admin.support.noThread')}
                      </span>
                    );
                  })()}
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
          ? 'border-brand-near-black bg-brand-near-black text-white'
          : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black',
      )}
    >
      {children}
    </button>
  );
}
