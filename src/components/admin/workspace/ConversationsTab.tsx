import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'framer-motion';
import { Loader2, MessagesSquare, StickyNote } from 'lucide-react';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import type { Workspace } from '@/lib/admin/workspace';
import {
  assignConversation, ensureProjectConversation, listConversationMessages, resolveConversation, sendConversationMessage,
  type Conversation, type ConversationMessage, type Decision,
} from '@/lib/supabase/conversations';
import { subscribeToMessages } from '@/lib/supabase/messages';
import { listAdminUsers } from '@/lib/supabase/admin-users';
import { domainStateOf, nameLookup, workspaceHref } from '@/lib/admin/workspace-params';
import { ConversationThread } from '@/components/admin/conversations/ConversationThread';
import { DomainNote } from './DomainNote';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDateTime, formatRelative } from '@/lib/format';
import { formatUSDFull } from '@/lib/budget';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Conversations tab (05 §9) — THIS PROJECT'S threads, and the decisions taken on them.
//
// Not the Inbox. The Inbox (Phase 6) is every thread across every project and channel;
// this is `ws.conversations` — rows whose `project_id` is this project — and nothing
// else. No discovery, no channel queues, no pre-project threads.
//
// Threads come from the loader; messages come from `listConversationMessages(id)` for
// the selected thread only, in thread order, with `direction` rendered as stored:
// inbound on the left, outbound on the right, an internal note as a full-width grey
// note that non-staff never see (091 RLS). The client never reinterprets direction.
//
// Every act is a 091 RPC — send_message (outbound / internal), assign_conversation,
// resolve_conversation, record_decision, ensure_project_conversation — and after each
// the thread is re-read and the workspace reloaded. Nothing is appended optimistically;
// a decision appears from `ws.decisions` on the next read.
// =========================================================

const STATUS_DOT: Record<Conversation['status'], string> = {
  open: 'bg-state-active', waiting_on_us: 'bg-state-held', waiting_on_them: 'bg-brand-muted-grey', resolved: 'bg-state-complete',
};

export function ConversationsTab({ loaded, conversationId, onChanged }: { loaded: LoadedWorkspace; conversationId: string | null; onChanged: () => void }) {
  const t = useT();
  const ws = loaded.workspace;
  const state = domainStateOf(ws, loaded.errors, 'conversations', ws.conversations.length);
  const name = nameLookup(ws);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Staff who can be assigned: the admin role, from the one authorised reader. Loaded
  // once; an empty list means "nobody to assign", never an invented person.
  const [staff, setStaff] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    listAdminUsers()
      .then(rows => { if (alive) setStaff(rows.filter(u => u.roles.split(',').map(r => r.trim()).includes('admin')).map(u => ({ id: u.id, label: u.fullName || u.email }))); })
      .catch(() => { if (alive) setStaff([]); });
    return () => { alive = false; };
  }, []);
  const staffName = (id: string | null) => (id ? (staff?.find(s => s.id === id)?.label || name(id) || t('admin.workspace.header.unknownAccount')) : '');

  if (state === 'unavailable' || state === 'error') {
    return <div className="p-6 sm:p-8"><DomainNote state={state} reason={loaded.errors.conversations} /></div>;
  }

  const selected = (conversationId && ws.conversations.find(c => c.id === conversationId)) || ws.conversations[0] || null;

  async function startThread() {
    setStarting(true); setStartError(null);
    try { await ensureProjectConversation(ws.project.id); onChanged(); }
    catch (err) { setStartError(errorMessage(err, t('common.somethingWrong'))); }
    finally { setStarting(false); }
  }

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6 2xl:p-8">
      {state === 'empty' ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState
            icon={<MessagesSquare className="size-8" />}
            title={t('admin.workspace.conversations.empty')}
            description={t('admin.workspace.conversations.emptyBody')}
            action={
              <button type="button" onClick={startThread} disabled={starting}
                className="inline-flex items-center gap-2 rounded-xl border border-brand-border-grey px-4 py-2 text-xs font-semibold text-brand-near-black hover:border-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:border-white">
                {starting && <Loader2 className="size-3.5 animate-spin" />}{t('admin.workspace.conversations.start')}
              </button>
            }
          />
          {startError && <p role="alert" className="px-6 pb-5 text-center text-xs text-state-alert">{startError}</p>}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* ── Threads ───────────────────────────────────────────────────────────── */}
          <aside className="min-w-0 overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e] lg:self-start">
            <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {ws.conversations.map(c => {
                const active = c.id === selected?.id;
                return (
                  <li key={c.id}>
                    <Link to={workspaceHref(ws.project.id, { tab: 'conversations', conversationId: c.id })} replace aria-current={active ? 'true' : undefined}
                      className={cn('block px-4 py-3 transition-colors', active ? 'bg-brand-off-white dark:bg-[#252525]' : 'hover:bg-brand-off-white dark:hover:bg-[#252525]')}>
                      <p className="flex items-center gap-2 text-sm font-medium text-brand-near-black dark:text-white">
                        <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[c.status])} />
                        <span className="truncate">{c.subject || t(`admin.workspace.conversations.channel.${c.channel}` as TKey)}</span>
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-brand-mid-grey">
                        {t(`admin.workspace.conversations.status.${c.status}` as TKey)}
                        {' · '}{t(`admin.workspace.conversations.channel.${c.channel}` as TKey)}
                        {c.assignedTo && ` · ${staffName(c.assignedTo)}`}
                        {c.lastMessageAt && ` · ${formatRelative(c.lastMessageAt)}`}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* ── The selected thread ───────────────────────────────────────────────── */}
          <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            {selected && (
              <ConversationThread
                key={selected.id}
                conversation={selected}
                staff={staff}
                staffName={staffName}
                onChanged={onChanged}
                decision={{ projectId: ws.project.id, ownerId: ws.team.owner?.id ?? null, stages: ws.stages }}
                realtimeProjectId={ws.project.id}
              />
            )}
          </section>
        </div>
      )}

      {/* ── Decisions taken on this project ───────────────────────────────────────── */}
      <DecisionsList ws={ws} loaded={loaded} name={name} />
    </div>
  );
}

function DecisionsList({ ws, loaded, name }: { ws: Workspace; loaded: LoadedWorkspace; name: (id: string | null | undefined) => string }) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const state = domainStateOf(ws, loaded.errors, 'decisions', ws.decisions.length);
  const related = (d: Decision) => {
    const kind = t(`admin.decision.relatedKind.${d.related}` as TKey);
    if (d.related === 'stage' && d.relatedId) {
      const v = ws.stages.find(s => s.stage.id === d.relatedId);
      return v ? `${kind} · ${v.stage.stage_number} ${stageLabel(v.stage)}` : kind;
    }
    return kind;
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('admin.decision.listTitle')}</h2>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.decision.listSub')}</p>
      </header>
      {state === 'unavailable' || state === 'error' ? (
        <DomainNote state={state} reason={loaded.errors.decisions} />
      ) : state === 'empty' ? (
        <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t('admin.decision.listEmpty')}</p>
      ) : (
        <ol className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
          {ws.decisions.map(d => (
            <li key={d.id} className="px-5 py-3">
              <p className="text-sm font-medium text-brand-near-black dark:text-white">{d.subject}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-brand-near-black dark:text-white">{d.decision}</p>
              <p className="mt-1 text-[11px] text-brand-mid-grey">
                {related(d)}
                {' · '}{t('admin.decision.recordedBy', { name: name(d.recordedBy) || t('admin.workspace.header.unknownAccount'), when: formatRelative(d.recordedAt) })}
                {d.approvedBy && ` · ${t('admin.decision.approvedBy', { name: name(d.approvedBy) || t('admin.workspace.header.unknownAccount'), when: formatRelative(d.approvedAt) })}`}
                {d.costImpactUsd != null && ` · ${t('admin.decision.costImpact', { amount: formatUSDFull(d.costImpactUsd) })}`}
                {d.scheduleImpactDays != null && ` · ${t('admin.decision.scheduleImpact', { days: d.scheduleImpactDays })}`}
                {d.conversationId && (
                  <> · <Link to={workspaceHref(ws.project.id, { tab: 'conversations', conversationId: d.conversationId })} className="hover:underline">{t('admin.decision.openThread')}</Link></>
                )}
                {d.supersedesId && ` · ${t('admin.decision.supersedes')}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
