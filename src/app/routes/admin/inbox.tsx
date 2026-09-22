import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Loader2, MessagesSquare } from 'lucide-react';
import { listConversations, type Conversation } from '@/lib/supabase/conversations';
import { listAdminUsers, type AdminUser } from '@/lib/supabase/admin-users';
import { ConversationThread } from '@/components/admin/conversations/ConversationThread';
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

  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const people = usePeople();

  const load = useCallback(async () => {
    try {
      const r = await listConversations();
      setRows(r.rows); setAvailable(r.available); setError(null);
    } catch (err) {
      setRows([]); setError(errorMessage(err, t('common.somethingWrong')));
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const staff = useMemo(
    () => (people ? [...people.values()].filter(u => u.roles.split(',').map(r => r.trim()).includes('admin')).map(u => ({ id: u.id, label: u.fullName || u.email })) : null),
    [people],
  );
  const personName = useCallback((id: string | null | undefined) => {
    if (!id) return '';
    const p = people?.get(id);
    return p ? (p.fullName || p.email) : '';
  }, [people]);
  const staffName = useCallback((id: string | null) => personName(id) || t('admin.workspace.header.unknownAccount'), [personName, t]);

  const title = useCallback(
    (c: Conversation) => personName(c.personId) || c.subject || t('admin.inbox.unknownPerson'),
    [personName, t],
  );

  const shown = useMemo(
    () => (rows ?? []).filter(c =>
      (statusFilter === 'active' ? c.status !== 'resolved' : statusFilter ? c.status === statusFilter : true)
      && (channelFilter ? c.channel === channelFilter : true)),
    [rows, statusFilter, channelFilter],
  );
  const selected = shown.find(c => c.id === selectedId) ?? shown[0] ?? null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.inbox.title')}</h1>
        <p className="mt-0.5 text-xs text-brand-mid-grey">
          {channelFilter ? t(`admin.workspace.conversations.channel.${channelFilter}` as TKey) : t('admin.inbox.sub')}
        </p>
      </header>

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
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-brand-mid-grey">
                        {t(`admin.workspace.conversations.channel.${c.channel}` as TKey)}
                        {' · '}{t(`admin.workspace.conversations.status.${c.status}` as TKey)}
                        {c.lastMessageAt && ` · ${formatRelative(c.lastMessageAt)}`}
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
                <ConversationThread
                  key={selected.id}
                  conversation={selected}
                  staff={staff}
                  staffName={staffName}
                  onChanged={load}
                  title={title(selected)}
                  realtimeProjectId={selected.projectId}
                />
                {selected.projectId && (
                  <div className="border-t border-brand-border-grey px-5 py-2.5 dark:border-[#2c2c2c]">
                    <Link to={`/admin/projects/${selected.projectId}?tab=conversations&conversation=${selected.id}`}
                      className="text-xs font-semibold text-brand-near-black underline-offset-2 hover:underline dark:text-white">
                      {t('admin.inbox.openProject')}
                    </Link>
                  </div>
                )}
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
