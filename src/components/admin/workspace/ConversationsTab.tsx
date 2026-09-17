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
import { RecordDecisionModal } from '@/components/admin/conversations/RecordDecisionModal';
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
            {selected && <Thread key={selected.id} ws={ws} conversation={selected} staff={staff} staffName={staffName} onChanged={onChanged} />}
          </section>
        </div>
      )}

      {/* ── Decisions taken on this project ───────────────────────────────────────── */}
      <DecisionsList ws={ws} loaded={loaded} name={name} />
    </div>
  );
}

function Thread({ ws, conversation, staff, staffName, onChanged }: {
  ws: Workspace; conversation: Conversation; staff: { id: string; label: string }[] | null;
  staffName: (id: string | null) => string; onChanged: () => void;
}) {
  const t = useT();
  const [messages, setMessages] = useState<ConversationMessage[] | null | undefined>(undefined);
  const [available, setAvailable] = useState(true);
  const [draft, setDraft]   = useState('');
  const [busy, setBusy]     = useState<'send' | 'note' | 'assign' | 'resolve' | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [assignee, setAssignee] = useState(conversation.assignedTo ?? '');
  const [source, setSource] = useState<ConversationMessage | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listConversationMessages(conversation.id);
      setAvailable(r.available); setMessages(r.rows);
    } catch { setMessages(null); }
  }, [conversation.id]);

  useEffect(() => { load(); }, [load]);

  // A message landing on any of this project's threads (091: every one carries project_id)
  // re-reads this thread rather than appending the payload — the row as stored is the truth.
  useEffect(() => subscribeToMessages(ws.project.id, () => { load(); }), [ws.project.id, load]);

  async function act(kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) {
    setBusy(kind); setError(null);
    try { await fn(); await load(); onChanged(); return true; }
    catch (err) {
      const msg = errorMessage(err, '');
      setError(msg.includes('empty_message') ? t('admin.workspace.conversations.errEmpty') : msg || t('common.somethingWrong'));
      return false;
    } finally { setBusy(null); }
  }

  const send = (direction: 'outbound' | 'internal') => {
    const content = draft.trim();
    if (!content) return;
    act(direction === 'outbound' ? 'send' : 'note', () => sendConversationMessage(conversation.id, content, direction))
      .then(ok => { if (ok) setDraft(''); });
  };

  const resolved = conversation.status === 'resolved';

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-brand-near-black dark:text-white">
            {conversation.subject || t(`admin.workspace.conversations.channel.${conversation.channel}` as TKey)}
          </h2>
          <p className="text-[11px] text-brand-mid-grey">
            <span className={cn('mr-1.5 inline-block size-1.5 rounded-full align-middle', STATUS_DOT[conversation.status])} />
            {t(`admin.workspace.conversations.status.${conversation.status}` as TKey)}
            {' · '}{t(`admin.workspace.conversations.channel.${conversation.channel}` as TKey)}
            {conversation.resolvedAt && ` · ${t('admin.workspace.conversations.resolvedAt', { when: formatRelative(conversation.resolvedAt) })}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Assign: staff only; "nobody to assign" when the list is empty. */}
          <select value={assignee} onChange={e => setAssignee(e.target.value)} aria-label={t('admin.workspace.conversations.assign')}
            disabled={!staff || staff.length === 0 || busy !== null}
            className="rounded-lg border border-brand-border-grey bg-white px-2.5 py-1.5 text-xs text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
            <option value="">{staff && staff.length === 0 ? t('admin.workspace.conversations.noStaff') : t('admin.workspace.conversations.unassigned')}</option>
            {(staff ?? []).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button type="button" disabled={busy !== null || (assignee || '') === (conversation.assignedTo ?? '')}
            onClick={() => act('assign', () => assignConversation(conversation.id, assignee || null))}
            className="rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-semibold text-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white">
            {busy === 'assign' ? <Loader2 className="size-3.5 animate-spin" /> : t('admin.workspace.conversations.assign')}
          </button>
          {!resolved && (
            <button type="button" disabled={busy !== null} onClick={() => act('resolve', () => resolveConversation(conversation.id))}
              className="rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-semibold text-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white">
              {busy === 'resolve' ? <Loader2 className="size-3.5 animate-spin" /> : t('admin.workspace.conversations.resolve')}
            </button>
          )}
          <button type="button" onClick={() => setRecording(true)}
            className="rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black">
            {t('admin.decision.record')}
          </button>
        </div>
      </header>

      {/* ── Messages, in thread order, as stored ─────────────────────────────────── */}
      <div className="flex max-h-[32rem] min-h-[12rem] flex-col gap-2 overflow-y-auto px-5 py-4">
        {messages === undefined ? (
          <p className="text-xs text-brand-mid-grey">{t('common.loading')}</p>
        ) : messages === null ? (
          <DomainNote state="error" reason={t('admin.workspace.conversations.messages')} />
        ) : !available ? (
          <DomainNote state="unavailable" />
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-brand-mid-grey">{t('admin.workspace.conversations.noMessages')}</p>
        ) : messages.map(m => {
          const mine = source?.id === m.id;
          if (m.direction === 'internal') {
            return (
              <button type="button" key={m.id} onClick={() => setSource(mine ? null : m)} title={t('admin.workspace.conversations.useAsSource')}
                className={cn('w-full rounded-lg border border-dashed border-brand-border-grey bg-brand-off-white px-3 py-2 text-left text-xs dark:border-[#2c2c2c] dark:bg-[#1a1a1a]', mine && 'ring-1 ring-brand-near-black dark:ring-white')}>
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey"><StickyNote className="size-3" />{t('admin.workspace.conversations.internal')} · {m.senderName} · {formatRelative(m.createdAt)}</span>
                <span className="mt-1 block whitespace-pre-wrap text-brand-near-black dark:text-white">{m.content}</span>
              </button>
            );
          }
          const outbound = m.direction === 'outbound';
          return (
            <div key={m.id} className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
              <button type="button" onClick={() => setSource(mine ? null : m)} title={t('admin.workspace.conversations.useAsSource')}
                className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-left text-sm',
                  outbound ? 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black' : 'border border-brand-border-grey bg-white text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#252525] dark:text-white',
                  mine && 'ring-2 ring-offset-1 ring-brand-mid-grey')}>
                <span className="whitespace-pre-wrap">{m.content}</span>
                <span className={cn('mt-1 block text-[10px]', outbound ? 'text-white/60 dark:text-brand-near-black/60' : 'text-brand-mid-grey')} title={formatDateTime(m.createdAt)}>
                  {m.senderName} · {formatRelative(m.createdAt)}{m.channel !== 'jalla' && ` · ${t(`admin.workspace.conversations.channel.${m.channel}` as TKey)}`}{m.status === 'failed' && ` · ${t('admin.workspace.conversations.failed')}`}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Composer: two different acts, named as such ───────────────────────────── */}
      <div className="border-t border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} placeholder={t('admin.workspace.conversations.placeholder')} aria-label={t('admin.workspace.conversations.placeholder')}
          className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy !== null || !draft.trim()} onClick={() => send('outbound')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
            {busy === 'send' && <Loader2 className="size-3.5 animate-spin" />}{t('admin.workspace.conversations.send')}
          </button>
          <button type="button" disabled={busy !== null || !draft.trim()} onClick={() => send('internal')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-semibold text-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white">
            {busy === 'note' && <Loader2 className="size-3.5 animate-spin" />}<StickyNote className="size-3.5" />{t('admin.workspace.conversations.internalNote')}
          </button>
          <span className="text-[11px] text-brand-mid-grey">{t('admin.workspace.conversations.internalHint')}</span>
          {error && <p role="alert" className="w-full text-xs text-state-alert">{error}</p>}
        </div>
      </div>

      <AnimatePresence>
        {recording && (
          <RecordDecisionModal
            projectId={ws.project.id}
            ownerId={ws.team.owner?.id ?? null}
            stages={ws.stages}
            conversationId={conversation.id}
            message={source ? { id: source.id, senderName: source.senderName, content: source.content } : null}
            onClose={() => setRecording(false)}
            onRecorded={() => { setRecording(false); setSource(null); onChanged(); }}
          />
        )}
      </AnimatePresence>
    </>
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
