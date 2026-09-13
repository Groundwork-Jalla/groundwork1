import { supabase } from './client';
import { notifyProjectMembers } from './notifications';
import { ensureProjectConversation, isConversationsUnavailable, sendConversationMessage } from './conversations';
import type { ProjectMessageRow } from '@/types/project';

// =========================================================
// fetchMessages — ordered by oldest first (chat order)
//
// By project: after 091 every message on a project's threads carries project_id (the
// backfill, the BEFORE INSERT trigger, and link_conversation all keep it so), and RLS
// hides staff's internal notes from non-staff readers. Reading by conversation is the
// Inbox's job (Phase 6); the project chat shows the project.
// =========================================================
export async function fetchMessages(projectId: string): Promise<ProjectMessageRow[]> {
  const { data, error } = await supabase
    .from('project_messages')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

// =========================================================
// sendMessage — through the thread (091), with the pre-091 insert as the fallback for a
// deploy that lands before the migration is pasted.
// =========================================================
export async function sendMessage(
  projectId: string,
  senderId: string,
  senderName: string,
  content: string,
): Promise<void> {
  let messageId: string | null = null;
  try {
    const conversationId = await ensureProjectConversation(projectId);
    messageId = await sendConversationMessage(conversationId, content);
  } catch (err) {
    if (!isConversationsUnavailable(err)) throw err;
    const { data, error } = await supabase
      .from('project_messages')
      .insert({ project_id: projectId, sender_id: senderId, sender_name: senderName, content })
      .select('id')
      .single();
    if (error) throw error;
    messageId = data?.id ?? null;
  }

  // Mirror onto the owner's GoHighLevel thread so the team can see the conversation and
  // answer from the inbox they actually work in. Fire-and-forget on purpose: the message
  // is already stored and already on the other person's screen, so a CRM outage must not
  // surface as a failed send. A miss leaves `ghl_message_id` null, which is the backlog
  // the partial index in migration 077 exists to answer.
  if (messageId) {
    void mirrorToCrm(messageId);
  }

  // Notify other project members (fire-and-forget)
  notifyProjectMembers(
    projectId,
    senderId,
    'message_received',
    'New message',
    `${senderName} sent a message`,
    { project_id: projectId },
  ).catch(() => {});
}

/**
 * Push one message onto the owner's GoHighLevel thread.
 *
 * The Authorization header is not optional: `requireUser` in the handler reads the
 * Supabase access token off it and 401s without one. Missing it would fail every mirror
 * silently, because the whole call is deliberately fire-and-forget.
 */
async function mirrorToCrm(messageId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch('/api/events?action=crm-chat-mirror', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ messageId }),
    });
  } catch {
    /* A CRM mirror. Never surface, never block: the message is already delivered. */
  }
}

// =========================================================
// subscribeToMessages — Supabase Realtime channel
// Returns an unsubscribe function
// =========================================================
export function subscribeToMessages(
  projectId: string,
  onMessage: (msg: ProjectMessageRow) => void,
): () => void {
  const channel = supabase
    .channel(`project-messages-${projectId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'project_messages',
        filter: `project_id=eq.${projectId}`,
      },
      payload => onMessage(payload.new as ProjectMessageRow),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// =========================================================
// formatRelativeTime — "2 min ago", "just now", etc.
// =========================================================
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
