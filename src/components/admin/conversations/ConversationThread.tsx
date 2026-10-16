import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Paperclip, StickyNote, X } from 'lucide-react';
import type { Workspace } from '@/lib/admin/workspace';
import {
  assignConversation, deliverMessage, listConversationMessages, resolveConversation, sendConversationMessage,
  type Conversation, type ConversationMessage,
} from '@/lib/supabase/conversations';
import { subscribeToMessages } from '@/lib/supabase/messages';
import { RecordDecisionModal } from '@/components/admin/conversations/RecordDecisionModal';
import { DomainNote } from '@/components/admin/workspace/DomainNote';
import { formatDateTime, formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import {
  ATTACHMENT_ACCEPT, MAX_ATTACHMENT_MB, attachmentProblem, toAttachments,
  uploadChatAttachment, type ChatAttachment,
} from '@/lib/supabase/chat-attachments';
import { MessageAttachments } from '@/components/conversations/MessageAttachments';
import { VoiceRecorder } from '@/components/conversations/VoiceRecorder';
import { cn } from '@/lib/utils';

// =========================================================
// One conversation thread — admin controls in staff view; a Jalla composer in member view.
//
// Lifted out of the workspace tab (05 §9) unchanged so the Inbox (06 §18) and the
// project workspace show the SAME thread rather than two that drift. What the two
// callers differ in is passed in: a project thread has a decision context and a project
// to watch for realtime; an Inbox thread may have neither, because an inbound WhatsApp
// conversation has no project until somebody links one.
//
// Messages are read with `listConversationMessages(id)` in thread order and rendered by
// stored `direction` — inbound left, outbound right, internal a full-width note that
// non-staff never see (091 RLS). Every act is a 091 RPC, and after each the thread is
// re-read; nothing is appended optimistically.
// =========================================================

const STATUS_DOT: Record<Conversation['status'], string> = {
  open: 'bg-state-active', waiting_on_us: 'bg-state-held', waiting_on_them: 'bg-brand-muted-grey', resolved: 'bg-state-complete',
};

export function ConversationThread({ conversation, staff, staffName, onChanged, decision, realtimeProjectId, title, memberView, currentUserId }: {
  conversation: Conversation;
  staff: { id: string; label: string }[] | null;
  staffName: (id: string | null) => string;
  onChanged: () => void;
  /** Project members can send on Jalla but cannot assign, resolve or write staff notes. */
  memberView?: boolean;
  currentUserId?: string;
  /** Present only where a decision has a project to belong to (the workspace tab). */
  decision?: { projectId: string; ownerId: string | null; stages: Workspace['stages'] } | null;
  /** 091 messages carry project_id only for project threads; an Inbox thread has none. */
  realtimeProjectId?: string | null;
  /** What to call the thread when it has no subject — the person, in the Inbox. */
  title?: string;
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
  const [delivery, setDelivery] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listConversationMessages(conversation.id);
      setAvailable(r.available); setMessages(r.rows);
    } catch { setMessages(null); }
  }, [conversation.id]);

  useEffect(() => { load(); }, [load]);

  // A message landing on any of this project's threads (091: every one carries project_id)
  // re-reads this thread rather than appending the payload — the row as stored is the truth.
  useEffect(() => {
    if (!realtimeProjectId) return;
    return subscribeToMessages(realtimeProjectId, () => { load(); });
  }, [realtimeProjectId, load]);

  async function act(kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) {
    setBusy(kind); setError(null); setDelivery(null);
    try { await fn(); await load(); onChanged(); return true; }
    catch (err) {
      const msg = errorMessage(err, '');
      setError(msg.includes('empty_message') ? t('admin.workspace.conversations.errEmpty') : msg || t('common.somethingWrong'));
      return false;
    } finally { setBusy(null); }
  }

  // Send: the row is written by 091 first and exists whatever happens next. For an
  // OUTBOUND message on a WhatsApp thread it is then carried to the phone; a delivery
  // failure is said plainly and the message stays in the thread marked failed. An
  // internal note is never carried anywhere.
  /**
   * Files picked but not yet sent. Uploaded as they are chosen rather than on send,
   * so a 6 MB photo is already in the bucket by the time the sentence is finished —
   * and so a file that the bucket refuses is reported while it can still be changed.
   */
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function attach(file: File, kind: 'file' | 'voice' = 'file') {
    const problem = attachmentProblem(file);
    if (problem) {
      setDelivery(t(problem === 'size' ? 'chat.attachment.tooLarge' : 'chat.attachment.badType',
        { mb: String(MAX_ATTACHMENT_MB) }));
      return;
    }
    setUploading(true);
    setDelivery(null);
    try {
      // Awaited first: a state updater is not an async function, and putting the
      // upload inside one is a promise stored as an attachment.
      const uploaded = await uploadChatAttachment(conversation.id, file, kind);
      setPending(list => [...list, uploaded]);
    } catch {
      setDelivery(t('chat.attachment.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  const send = (direction: 'outbound' | 'internal') => {
    const content = draft.trim();
    // A photograph on its own is a message. Requiring words beside it would make
    // somebody type "see photo" every time.
    if (!content && pending.length === 0) return;
    act(direction === 'outbound' ? 'send' : 'note', async () => {
      const messageId = await sendConversationMessage(
        conversation.id,
        // `send_message` refuses an empty body, so an attachment-only message carries
        // a short stand-in rather than being rejected at the database.
        content || t('chat.attachment.sentAttachment'),
        memberView ? undefined : direction,
        pending.length ? pending : undefined,
      );
      // Delivery is the server's business: anything that leaves Groundwork is asked for
      // here, and the provider — GHL today — is chosen there, from the channel.
      if (!memberView && direction === 'outbound' && conversation.channel !== 'jalla') {
        const d = await deliverMessage(messageId);
        // `not_deliverable` is not a failure: that channel simply is not carried.
        if (!d.ok && d.reason !== 'not_deliverable') {
          setDelivery(d.detail ? `${t('admin.inbox.notDelivered')} — ${d.detail}` : t('admin.inbox.notDelivered'));
        } else setDelivery(null);
      }
    }).then(ok => { if (ok) { setDraft(''); setPending([]); } });
  };

  const resolved = conversation.status === 'resolved';

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-brand-near-black dark:text-white">
            {conversation.subject || title || t(`admin.workspace.conversations.channel.${conversation.channel}` as TKey)}
          </h2>
          <p className="text-[11px] text-brand-mid-grey">
            <span className={cn('mr-1.5 inline-block size-1.5 rounded-full align-middle', STATUS_DOT[conversation.status])} />
            {t(`admin.workspace.conversations.status.${conversation.status}` as TKey)}
            {/* The channel is the heading when there is no subject; saying it twice is noise. */}
            {(conversation.subject || title) && ` · ${t(`admin.workspace.conversations.channel.${conversation.channel}` as TKey)}`}
            {conversation.resolvedAt && ` · ${t('admin.workspace.conversations.resolvedAt', { when: formatRelative(conversation.resolvedAt) })}`}
          </p>
        </div>
        {!memberView && <div className="flex flex-wrap items-center gap-2">
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
          {decision && (
            <button type="button" onClick={() => setRecording(true)}
              className="rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black">
              {t('admin.decision.record')}
            </button>
          )}
        </div>}
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
          const outbound = memberView ? m.senderId === currentUserId : m.direction === 'outbound';
          const bubbleClass = cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-left text-sm',
            outbound ? 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black' : 'border border-brand-border-grey bg-white text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#252525] dark:text-white',
            mine && 'ring-2 ring-offset-1 ring-brand-mid-grey');
          return (
            <div key={m.id} className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
              {memberView ? (
                <div className={bubbleClass}>
                  <span className="whitespace-pre-wrap">{m.content}</span>
                  <MessageAttachments attachments={toAttachments(m.attachments)} />
                  <span className={cn('mt-1 block text-[10px]', outbound ? 'text-white/60 dark:text-brand-near-black/60' : 'text-brand-mid-grey')} title={formatDateTime(m.createdAt)}>
                    {m.senderName} · {formatRelative(m.createdAt)}
                  </span>
                </div>
              ) : (
                <button type="button" onClick={() => setSource(mine ? null : m)} title={t('admin.workspace.conversations.useAsSource')}
                  className={bubbleClass}>
                  <span className="whitespace-pre-wrap">{m.content}</span>
                  <MessageAttachments attachments={toAttachments(m.attachments)} />
                  <span className={cn('mt-1 block text-[10px]', outbound ? 'text-white/60 dark:text-brand-near-black/60' : 'text-brand-mid-grey')} title={formatDateTime(m.createdAt)}>
                    {m.senderName} · {formatRelative(m.createdAt)}{m.channel !== 'jalla' && ` · ${t(`admin.workspace.conversations.channel.${m.channel}` as TKey)}`}{m.status === 'failed' && ` · ${t('admin.workspace.conversations.failed')}`}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Composer: two different acts, named as such ───────────────────────────── */}
      <div className="border-t border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} placeholder={t('admin.workspace.conversations.placeholder')} aria-label={t('admin.workspace.conversations.placeholder')}
          className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white" />
        {/* What is already uploaded and will go with the next message. Removable
            until it is sent — picking the wrong photo is the commonest mistake here. */}
        {pending.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {pending.map(a => (
              <li key={a.path}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-2 py-1 text-[11px] dark:border-[#2c2c2c]">
                <Paperclip className="size-3 shrink-0 text-brand-mid-grey" aria-hidden />
                <span className="max-w-40 truncate">{a.name}</span>
                <button
                  type="button" onClick={() => setPending(list => list.filter(x => x.path !== a.path))}
                  aria-label={t('chat.attachment.remove')}
                  className="rounded p-0.5 text-brand-mid-grey hover:text-state-alert"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* A build is discussed in photographs: a question about a crack is a
              picture, not a paragraph. */}
          <input
            ref={fileRef} type="file" multiple className="sr-only" accept={ATTACHMENT_ACCEPT}
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              // Sequential, so one refusal is reported against the file that caused it.
              void files.reduce<Promise<void>>((run, f) => run.then(() => attach(f)), Promise.resolve());
            }}
          />
          <button
            type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null || uploading}
            aria-label={t('chat.attachment.attach')} title={t('chat.attachment.attach')}
            className="rounded-lg p-2 text-brand-mid-grey hover:bg-brand-off-white disabled:opacity-40 dark:hover:bg-[#2c2c2c]"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Paperclip className="size-4" aria-hidden />}
          </button>

          {/* On site, typing is the slow way to say something. */}
          <VoiceRecorder disabled={busy !== null || uploading} onRecorded={clip => void attach(clip, 'voice')} />

          <button type="button" disabled={busy !== null || uploading || (!draft.trim() && pending.length === 0)} onClick={() => send('outbound')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
            {busy === 'send' && <Loader2 className="size-3.5 animate-spin" />}{t('admin.workspace.conversations.send')}
          </button>
          {!memberView && <button type="button" disabled={busy !== null || uploading || (!draft.trim() && pending.length === 0)} onClick={() => send('internal')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-semibold text-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white">
            {busy === 'note' && <Loader2 className="size-3.5 animate-spin" />}<StickyNote className="size-3.5" />{t('admin.workspace.conversations.internalNote')}
          </button>}
          {!memberView && <span className="text-[11px] text-brand-mid-grey">{t('admin.workspace.conversations.internalHint')}</span>}
          {error && <p role="alert" className="w-full text-xs text-state-alert">{error}</p>}
          {delivery && <p role="alert" className="w-full text-xs text-state-alert">{delivery}</p>}
        </div>
      </div>

      <AnimatePresence>
        {recording && decision && (
          <RecordDecisionModal
            projectId={decision.projectId}
            ownerId={decision.ownerId}
            stages={decision.stages}
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
