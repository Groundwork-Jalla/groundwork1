import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Loader2, MessagesSquare, Plus } from 'lucide-react';
import { linkConversation, listConversationPreviews, listConversations, type Conversation, type ConversationPreview } from '@/lib/supabase/conversations';
import { listAdminUsers, type AdminUser } from '@/lib/supabase/admin-users';
import { listProjectsForPeople, type InboxProject } from '@/lib/supabase/inbox-context';
import { personLabel, projectContext, type ProjectContext } from '@/lib/admin/inbox-context';
import { ConversationThread } from '@/components/admin/conversations/ConversationThread';
import { NewJallaMessage } from '@/components/admin/NewJallaMessage';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/inbox (06 §18) — every conversation, whether or not it has a project.
//
// ── Why this page exists ─────────────────────────────────────────────────────────────
// The same thread UI already ran inside the project workspace, but a real inbound
// WhatsApp conversation has `project_id = NULL` until somebody links one — so it was
// reachable from nowhere. This is the person-scoped view: threads on the left, the
// selected thread on the right, `?conversation=<id>` in the URL so a thread can be
// linked to and survives a reload.
//
// ── What it does NOT do ──────────────────────────────────────────────────────────────
// No unread counts, no channel tabs, no search, no bulk actions. The list is
// `listConversations()` ordered by last message, and the thread is the shared
// `ConversationThread` — the workspace tab renders the same component, so the two can
// never drift. Sending is 091's `send_message`; delivery to the client's phone is asked
// for by channel and carried out server-side, where the provider is chosen.
// =========================================================

/** People, so a thread says a name rather than a uuid. Admin-visible accounts only. */
function usePeople() {
  const [people, setPeople] = useState<Map<string, AdminUser> | null>(null);
  useEffect(() => {
    let alive = true;
    listAdminUsers()
      .then(rows => { if (alive) setPeople(new Map(rows.map(r => [r.id, r]))); })
      .catch(() => { if (alive) setPeople(new Map()); });
    return () => { alive = false; };
  }, []);
  return people;
}

export default function AdminInbox() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('conversation');
  // The Overview's "Active conversations" KPI links here with ?status=active: anything
  // not resolved. A parameter a page does not read is a lie about what it is showing.
  const statusFilter = params.get('status');
  // The sidebar's WhatsApp entry is this page filtered to that channel.
  const channelFilter = params.get('channel');
  /**
   * Starting a thread is only meaningful on the native channel: WhatsApp, email and
   * calls are threads somebody else opened, and Groundwork cannot conjure one. So the
   * button appears for `jalla` and nowhere else.
   */
  const [newJalla, setNewJalla] = useState(false);

  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Map<string, ConversationPreview>>(new Map());
  const [projectsByPerson, setProjectsByPerson] = useState<Map<string, InboxProject[]>>(new Map());
  const people = usePeople();

  // Three reads for the whole screen, not one per row: the conversations, the last
  // message of each (one query for every thread), and every project owned by the people
  // in the list. A thread's context must not cost a round trip to look at.
  const load = useCallback(async () => {
    try {
      const r = await listConversations();
      setRows(r.rows); setAvailable(r.available); setError(null);
      const [p, proj] = await Promise.all([
        listConversationPreviews(r.rows.map(c => c.id)),
        listProjectsForPeople(r.rows.map(c => c.personId).filter((id): id is string => !!id)),
      ]);
      setPreviews(p.previews);
      setProjectsByPerson(proj.byPerson);
    } catch (err) {
      setRows([]); setError(errorMessage(err, t('common.somethingWrong')));
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  /**
   * A thread the URL names but the list has never heard of.
   *
   * The conversations are read once, when the screen mounts. Anything created after that
   * — by "New message" here, by the Jalla or WhatsApp button in a project, by the support
   * chooser, by a colleague in another tab — is a real row that this page simply has not
   * seen, and rendering the empty state for it says "no conversation yet" about a
   * conversation that exists. So an unknown id triggers exactly one re-read.
   *
   * Once per id: if it is still missing afterwards it is genuinely not ours to show, and
   * re-reading forever would turn a bad link into a loop.
   */
  const refetched = useRef(new Set<string>());
  useEffect(() => {
    if (!selectedId || rows === null) return;
    if (rows.some(c => c.id === selectedId)) return;
    if (refetched.current.has(selectedId)) return;
    refetched.current.add(selectedId);
    void load();
  }, [selectedId, rows, load]);

  const staff = useMemo(
    () => (people ? [...people.values()].filter(u => u.roles.split(',').map(r => r.trim()).includes('admin')).map(u => ({ id: u.id, label: u.fullName || u.email })) : null),
    [people],
  );
  // full_name → email → an honest generic label. A phone number is a transport address,
  // never a display name.
  const label = useCallback((id: string | null | undefined) => {
    const p = id ? people?.get(id) : undefined;
    return personLabel(p?.fullName, p?.email, t('admin.inbox.unknownPerson'));
  }, [people, t]);
  const staffName = useCallback((id: string | null) => (id ? label(id).primary : t('admin.workspace.header.unknownAccount')), [label, t]);
  const title = useCallback((c: Conversation) => (c.personId ? label(c.personId).primary : c.subject || t('admin.inbox.unknownPerson')), [label, t]);

  const shown = useMemo(
    () => (rows ?? []).filter(c =>
      (statusFilter === 'active' ? c.status !== 'resolved' : statusFilter ? c.status === statusFilter : true)
      && (channelFilter ? c.channel === channelFilter : true)),
    [rows, statusFilter, channelFilter],
  );
  const selected = shown.find(c => c.id === selectedId) ?? shown[0] ?? null;

  // Needs reply is `waiting_on_us` and nothing else — 091 sets it when a client writes
  // and clears it when staff answer. No second source of truth, no per-admin read state.
  const needsReply = (rows ?? []).filter(c => c.status === 'waiting_on_us').length;
  const needsReplyOn = statusFilter === 'waiting_on_us';
  const setStatus = (value: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (value) next.set('status', value); else next.delete('status');
    next.delete('conversation');
    return next;
  }, { replace: true });

  const context = selected ? projectContext(selected, projectsByPerson) : null;
  const preview = (id: string) => previews.get(id) ?? null;
  const projectName = (projectId: string, personId: string | null) =>
    (personId ? projectsByPerson.get(personId) ?? [] : []).find(p => p.id === projectId)?.name ?? '';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.inbox.title')}</h1>
          <p className="mt-0.5 text-xs text-brand-mid-grey">
            {channelFilter ? t(`admin.workspace.conversations.channel.${channelFilter}` as TKey) : t('admin.inbox.sub')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {channelFilter === 'jalla' && (
          <button
            type="button" onClick={() => setNewJalla(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-near-black px-3 py-1.5 text-xs font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white dark:border-white dark:text-white dark:hover:bg-[#252525]"
          >
            <Plus className="size-3.5" />
            {t('admin.jalla.newMessage')}
          </button>
        )}
        {/* Needs reply: the count is `waiting_on_us`, and the chip filters to exactly those. */}
        {rows !== null && (
          <button type="button" onClick={() => setStatus(needsReplyOn ? null : 'waiting_on_us')} aria-pressed={needsReplyOn}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              needsReplyOn
                ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                : 'border-brand-border-grey text-brand-near-black hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]')}>
            {t('admin.inbox.needsReply')}
            <span className={cn('ml-1.5 tabular-nums', needsReplyOn ? '' : 'text-brand-mid-grey')}>{needsReply}</span>
          </button>
        )}
        </div>
      </header>

      {newJalla && <NewJallaMessage onClose={() => setNewJalla(false)} onCreated={load} />}

      {rows === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('admin.inbox.loading')}</p>
      ) : error ? (
        <p role="alert" className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 text-xs text-state-alert dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {t('admin.inbox.error', { reason: error })}
        </p>
      ) : !available ? (
        <p className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 text-xs text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {t('admin.inbox.unavailable')}
        </p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState icon={<MessagesSquare className="size-8" />} title={t('admin.inbox.empty')} description={t('admin.inbox.emptyBody')} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          {/* ── The threads ───────────────────────────────────────────────────────── */}
          <aside className="min-w-0 overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e] lg:self-start">
            <ul className="max-h-[36rem] divide-y divide-brand-border-grey overflow-y-auto dark:divide-[#2c2c2c]">
              {shown.map(c => {
                const active = c.id === selected?.id;
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setParams(prev => { const next = new URLSearchParams(prev); next.set('conversation', c.id); return next; }, { replace: true })}
                      aria-current={active ? 'true' : undefined}
                      className={cn('block w-full px-4 py-3 text-left transition-colors', active ? 'bg-brand-off-white dark:bg-[#252525]' : 'hover:bg-brand-off-white dark:hover:bg-[#252525]')}>
                      <p className="flex items-center gap-2 text-sm font-medium text-brand-near-black dark:text-white">
                        <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[c.status])} />
                        <span className="truncate">{title(c)}</span>
                        {c.lastMessageAt && <span className="ml-auto shrink-0 text-[11px] font-normal text-brand-mid-grey">{formatRelative(c.lastMessageAt)}</span>}
                      </p>
                      {/* The last message, as stored. An internal note is marked as one:
                          staff talking to each other must never read as the client's last word. */}
                      {preview(c.id) && (
                        <p className="mt-0.5 truncate text-xs text-brand-mid-grey">
                          {preview(c.id)!.direction === 'internal' && (
                            <span className="mr-1 font-semibold uppercase tracking-wide text-[10px]">{t('admin.workspace.conversations.internal')}:</span>
                          )}
                          {preview(c.id)!.direction === 'outbound' && (
                            <span className="mr-1 text-[10px] uppercase tracking-wide">{t('admin.inbox.youPrefix')}</span>
                          )}
                          {preview(c.id)!.content}
                        </p>
                      )}
                      <p className="mt-0.5 truncate text-[11px] text-brand-mid-grey">
                        {t(`admin.workspace.conversations.channel.${c.channel}` as TKey)}
                        {' · '}{t(`admin.workspace.conversations.status.${c.status}` as TKey)}
                        {/* Only an explicitly linked project appears in the list: the row stays compact. */}
                        {c.projectId && projectName(c.projectId, c.personId) && ` · ${projectName(c.projectId, c.personId)}`}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* ── The selected thread ───────────────────────────────────────────────── */}
          <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            {selected ? (
              <>
                <ContextHeader conversation={selected} label={label(selected.personId)} context={context} onLinked={load} />
                <ConversationThread
                  key={selected.id}
                  conversation={selected}
                  staff={staff}
                  staffName={staffName}
                  onChanged={load}
                  realtimeProjectId={selected.projectId}
                />
              </>
            ) : (
              <p className="px-5 py-10 text-center text-xs text-brand-mid-grey">{t('admin.inbox.selectPrompt')}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const STATUS_DOT: Record<Conversation['status'], string> = {
  open: 'bg-state-active', waiting_on_us: 'bg-state-held', waiting_on_them: 'bg-brand-muted-grey', resolved: 'bg-state-complete',
};

/**
 * Who this is, and what Groundwork is building for them (06 §19 D).
 *
 * A project the CONVERSATION names is stated as the conversation's. A project the PERSON
 * owns is stated as the account's — context for the person answering, not a claim about
 * what the message is about. Several projects are listed, not guessed between. None is
 * said plainly. Nothing here writes `conversations.project_id`: linking a thread to a
 * project stays an explicit act.
 */
function ContextHeader({ conversation, label, context, onLinked }: {
  conversation: Conversation;
  label: { primary: string; secondary: string | null };
  context: ProjectContext | null;
  /** Re-read after linking: the answer comes back from the row, never from local state. */
  onLinked: () => void;
}) {
  const t = useT();
  const [linking, setLinking] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Linking is an ACT, and only a person may do it. `link_conversation` (091, staff only)
  // moves the thread and every message on it onto the project; Groundwork never does this
  // on its own, because only the admin reading the words knows which build they are about.
  const link = async (projectId: string) => {
    setLinking(projectId); setLinkError(null);
    try {
      await linkConversation(conversation.id, projectId);
      onLinked();
    } catch (err) {
      const msg = errorMessage(err, '');
      setLinkError(msg.includes('already_linked') ? t('admin.inbox.alreadyLinked') : msg || t('common.somethingWrong'));
    } finally {
      setLinking(null);
    }
  };
  // `projects.current_stage` is a number, not a stage row — so it is said as a number
  // rather than run through the stage-name lookup, which would render nothing.
  const line = (p: InboxProject) => [
    p.currentStage != null ? `${t('admin.inbox.stage')} ${p.currentStage}` : null,
    p.status ? t(`admin.workspace.header.status.${p.status}` as TKey) : null,
    [p.city, p.country].filter(Boolean).join(', ') || null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
      <p className="text-sm font-semibold text-brand-near-black dark:text-white">{label.primary}</p>
      {label.secondary && <p className="text-[11px] text-brand-mid-grey">{label.secondary}</p>}

      <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-2">
        {context?.kind === 'none' || !context ? (
          <p className="text-[11px] text-brand-mid-grey">{t('admin.inbox.noProject')}</p>
        ) : context.kind === 'choice' ? (
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey">
              {t('admin.inbox.accountProjects', { count: context.projects.length })}
            </p>
            <ul className="mt-1 space-y-1">
              {context.projects.map(p => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <Link to={`/admin/projects/${p.id}`} className="font-medium text-brand-near-black underline-offset-2 hover:underline dark:text-white">{p.name}</Link>
                  <span className="text-brand-mid-grey">— {line(p)}</span>
                  <button type="button" onClick={() => link(p.id)} disabled={linking !== null}
                    className="rounded-lg border border-brand-border-grey px-2 py-0.5 text-[11px] font-semibold text-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white">
                    {linking === p.id ? <Loader2 className="size-3 animate-spin" /> : t('admin.inbox.linkThis')}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-brand-mid-grey">{t('admin.inbox.notLinked')}</p>
            {linkError && <p role="alert" className="mt-1 text-[11px] text-state-alert">{linkError}</p>}
          </div>
        ) : context.project ? (
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey">
              {context.kind === 'linked' ? t('admin.inbox.projectLinked') : t('admin.inbox.projectAccount')}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-brand-near-black dark:text-white">{context.project.name}</p>
            <p className="truncate text-[11px] text-brand-mid-grey">{line(context.project)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Link to={`/admin/projects/${context.project.id}${conversation.projectId ? `?tab=conversations&conversation=${conversation.id}` : ''}`}
                className="text-xs font-semibold text-brand-near-black underline-offset-2 hover:underline dark:text-white">
                {t('admin.inbox.openProject')}
              </Link>
              {/* The person owns it; nobody has said the conversation is about it. Saying so
                  is one click, and it is a click, never an inference. */}
              {context.kind === 'account' && (
                <button type="button" onClick={() => link(context.project!.id)} disabled={linking !== null}
                  className="rounded-lg border border-brand-border-grey px-2 py-0.5 text-[11px] font-semibold text-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white">
                  {linking ? <Loader2 className="size-3 animate-spin" /> : t('admin.inbox.linkThis')}
                </button>
              )}
            </div>
            {linkError && <p className="mt-1 text-[11px] text-state-alert" role="alert">{linkError}</p>}
          </div>
        ) : (
          <p className="text-[11px] text-brand-mid-grey">{t('admin.inbox.noProject')}</p>
        )}
      </div>
    </div>
  );
}
