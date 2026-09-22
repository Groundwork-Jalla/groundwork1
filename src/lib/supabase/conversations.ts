import { supabase } from './client';
import { isMissingTable } from '@/lib/errors';
import { isMissingRpc } from './activity';

// =========================================================
// Conversations, decisions and support links (091).
//
// A conversation is the thread with a person — optionally about a project. Its identity
// across the GHL boundary is `ghl_conversation_id`. Messages stay in `project_messages`
// (extended, not replaced); this module is the thread-level view and the staff acts on
// it. Nothing here writes a row directly: every write is a SECURITY DEFINER RPC that
// re-checks the actor. Reads are what RLS allows — staff everything, a person their own
// threads, project members their project's.
//
// The Inbox that renders these is Phase 6. What ships with 091 is the data and the acts.
// =========================================================

export type ConversationStatus = 'open' | 'waiting_on_us' | 'waiting_on_them' | 'resolved';
export type Channel = 'jalla' | 'whatsapp' | 'email' | 'call';
export type MessageDirection = 'inbound' | 'outbound' | 'internal';

export interface Conversation {
  id: string;
  personId: string | null;
  projectId: string | null;
  channel: Channel;
  subject: string | null;
  status: ConversationStatus;
  assignedTo: string | null;
  ghlConversationId: string | null;
  lastMessageAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface Decision {
  id: string;
  projectId: string;
  conversationId: string | null;
  messageId: string | null;
  subject: string;
  decision: string;
  related: 'budget' | 'stage' | 'design' | 'payment' | 'other';
  relatedId: string | null;
  supersedesId: string | null;
  recordedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  costImpactUsd: number | null;
  scheduleImpactDays: number | null;
  recordedAt: string;
}

export interface UnansweredConversation {
  conversationId: string;
  projectId: string | null;
  personId: string | null;
  assignedTo: string | null;
  waitingSince: string;
  hours: number;
  band: 'medium' | 'high' | 'critical';
}

const CONV_COLUMNS = 'id, person_id, project_id, channel, subject, status, assigned_to, ghl_conversation_id, last_message_at, resolved_at, created_at';

function rowToConversation(r: Record<string, unknown>): Conversation {
  return {
    id:                r.id as string,
    personId:          (r.person_id as string | null) ?? null,
    projectId:         (r.project_id as string | null) ?? null,
    channel:           r.channel as Channel,
    subject:           (r.subject as string | null) ?? null,
    status:            r.status as ConversationStatus,
    assignedTo:        (r.assigned_to as string | null) ?? null,
    ghlConversationId: (r.ghl_conversation_id as string | null) ?? null,
    lastMessageAt:     (r.last_message_at as string | null) ?? null,
    resolvedAt:        (r.resolved_at as string | null) ?? null,
    createdAt:         r.created_at as string,
  };
}

/** Threads the caller may see, newest activity first. `available: false` before 091 is applied. */
export async function listConversations(filter: { projectId?: string; status?: ConversationStatus } = {}):
  Promise<{ rows: Conversation[]; available: boolean }> {
  let q = supabase.from('conversations').select(CONV_COLUMNS).order('last_message_at', { ascending: false, nullsFirst: false });
  if (filter.projectId) q = q.eq('project_id', filter.projectId);
  if (filter.status)    q = q.eq('status', filter.status);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }
  return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToConversation), available: true };
}

/** The project's platform thread, created if it has none. Member or staff. */
export async function ensureProjectConversation(projectId: string): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_project_conversation', { p_project: projectId });
  if (error) throw error;
  return data as string;
}

/**
 * Send on a thread. A client or contractor message is `inbound`; staff send `outbound`
 * or an `internal` note (never mirrored, never shown to non-staff). Refuses
 * `not_member:`, `bad_direction:`, `empty_message:`. Returns the message id.
 */
export async function sendConversationMessage(
  conversationId: string, content: string, direction?: 'outbound' | 'internal', attachments?: unknown[],
): Promise<string> {
  const { data, error } = await supabase.rpc('send_message', {
    p_conversation: conversationId, p_content: content, p_direction: direction ?? null, p_attachments: attachments ?? null,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Ask for an outbound message to be delivered to the client (06 §18).
 *
 * Channel-agnostic on purpose: the Inbox knows it has sent something and wants it to
 * reach the person, not which company carries it. The server picks the provider from the
 * conversation's channel — GoHighLevel for WhatsApp today, whatever replaces it later —
 * and this call does not change when that does.
 *
 * The message row already exists (`send_message` wrote it), so this reports DELIVERY
 * only and never throws: a refusal is an answer the composer shows, not an exception
 * that loses the reply. An internal note is never delivered.
 */
export async function deliverMessage(messageId: string): Promise<{ ok: boolean; reason?: string; detail?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false, reason: 'not_signed_in' };
    const r = await fetch('/api/events?action=conversation-deliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ messageId }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: 'request_failed', detail: typeof body?.error === 'string' ? body.error : `HTTP ${r.status}` };
    return { ok: body?.ok === true, reason: body?.reason, detail: typeof body?.detail === 'string' ? body.detail : undefined };
  } catch (err) {
    return { ok: false, reason: 'unreachable', detail: err instanceof Error ? err.message : undefined };
  }
}

/** Staff: put a staff member on the thread (null to unassign). */
export async function assignConversation(conversationId: string, userId: string | null): Promise<void> {
  const { error } = await supabase.rpc('assign_conversation', { p_conversation: conversationId, p_user: userId });
  if (error) throw error;
}

/** Staff: attach a pre-project thread to a project; its messages follow. */
export async function linkConversation(conversationId: string, projectId: string): Promise<void> {
  const { error } = await supabase.rpc('link_conversation', { p_conversation: conversationId, p_project: projectId });
  if (error) throw error;
}

/** Staff: close the thread. The next message reopens it. */
export async function resolveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_conversation', { p_conversation: conversationId });
  if (error) throw error;
}

export interface NewDecision {
  projectId: string;
  subject: string;
  decision: string;
  related?: Decision['related'];
  relatedId?: string;
  conversationId?: string;
  messageId?: string;
  costImpactUsd?: number;
  scheduleImpactDays?: number;
  /** The client, when it is their approval (given on WhatsApp, say) being recorded. */
  approvedBy?: string;
  supersedes?: string;
}

/** Staff: record a decision. Immutable; a reversal is a new one that names the old. */
export async function recordDecision(d: NewDecision): Promise<string> {
  const { data, error } = await supabase.rpc('record_decision', {
    p_project: d.projectId, p_subject: d.subject, p_decision: d.decision,
    p_related: d.related ?? 'other', p_related_id: d.relatedId ?? null,
    p_conversation: d.conversationId ?? null, p_message: d.messageId ?? null,
    p_cost_impact_usd: d.costImpactUsd ?? null, p_schedule_impact_days: d.scheduleImpactDays ?? null,
    p_approved_by: d.approvedBy ?? null, p_supersedes: d.supersedes ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** The project owner confirms a decision on their project, once. */
export async function confirmDecision(decisionId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_decision', { p_decision: decisionId });
  if (error) throw error;
}

export async function listDecisions(projectId: string): Promise<{ rows: Decision[]; available: boolean }> {
  const { data, error } = await supabase
    .from('decisions')
    .select('id, project_id, conversation_id, message_id, subject, decision, related, related_id, supersedes_id, recorded_by, approved_by, approved_at, cost_impact_usd, schedule_impact_days, recorded_at')
    .eq('project_id', projectId)
    .order('recorded_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
    id: r.id as string, projectId: r.project_id as string,
    conversationId: (r.conversation_id as string | null) ?? null, messageId: (r.message_id as string | null) ?? null,
    subject: r.subject as string, decision: r.decision as string, related: r.related as Decision['related'],
    relatedId: (r.related_id as string | null) ?? null, supersedesId: (r.supersedes_id as string | null) ?? null,
    recordedBy: r.recorded_by as string, approvedBy: (r.approved_by as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    costImpactUsd: r.cost_impact_usd == null ? null : Number(r.cost_impact_usd),
    scheduleImpactDays: r.schedule_impact_days == null ? null : Number(r.schedule_impact_days),
    recordedAt: r.recorded_at as string,
  }));
  return { rows, available: true };
}

/** Staff: link a support ticket to a project and/or a thread. */
export async function linkTicket(ticketId: string, projectId?: string, conversationId?: string): Promise<void> {
  const { error } = await supabase.rpc('link_ticket', { p_ticket: ticketId, p_project: projectId ?? null, p_conversation: conversationId ?? null });
  if (error) throw error;
}

/**
 * Threads waiting on us past the threshold, banded by age. The threshold and bands live
 * in app_config and are read only inside the RPC — no number here. Staff only.
 */
export async function unansweredConversations(): Promise<{ rows: UnansweredConversation[]; available: boolean }> {
  const { data, error } = await supabase.rpc('unanswered_conversations');
  if (error) {
    if (isMissingRpc(error)) return { rows: [], available: false };
    throw error;
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map(r => ({
    conversationId: r.conversation_id as string, projectId: (r.project_id as string | null) ?? null,
    personId: (r.person_id as string | null) ?? null, assignedTo: (r.assigned_to as string | null) ?? null,
    waitingSince: r.waiting_since as string, hours: Number(r.hours), band: r.band as UnansweredConversation['band'],
  }));
  return { rows, available: true };
}

/** Is this the "091 not applied yet" refusal, so a caller can fall back? */
export function isConversationsUnavailable(err: unknown): boolean {
  return isMissingTable(err) || isMissingRpc(err);
}

// =========================================================
// One thread's messages (05 §9) — the Workspace's Conversations tab reads by
// `conversation_id`, oldest first, so a thread reads top to bottom.
//
// This is the 091 shape (direction, channel, status, attachments), not `fetchMessages`'
// pre-091 `select('*')` by project: a project can have several threads and a message's
// side of the screen is its `direction`, never "was the sender the owner". RLS already
// hides `internal` rows from non-staff (091 `member_read_messages`); an admin sees all.
// =========================================================

export interface ConversationMessage {
  id: string;
  conversationId: string;
  projectId: string | null;
  senderId: string | null;
  senderName: string;
  content: string;
  direction: MessageDirection;
  channel: Channel;
  status: 'sent' | 'delivered' | 'failed' | null;
  attachments: unknown[];
  /** Set when the row was mirrored from GoHighLevel (077). */
  ghlMessageId: string | null;
  createdAt: string;
}

const MESSAGE_COLUMNS =
  'id, conversation_id, project_id, sender_id, sender_name, content, direction, channel, status, attachments, ghl_message_id, created_at';

export async function listConversationMessages(conversationId: string):
  Promise<{ rows: ConversationMessage[]; available: boolean }> {
  const { data, error } = await supabase
    .from('project_messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) {
    // 42703: `conversation_id` is not there — 091 has not been pasted. The table exists
    // (it predates 091), so `isMissingTable` would say the wrong thing here.
    if (isMissingTable(error) || (error as { code?: string }).code === '42703') return { rows: [], available: false };
    throw error;
  }
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const sn = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    available: true,
    rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
      id:             s(r.id),
      conversationId: s(r.conversation_id),
      projectId:      sn(r.project_id),
      senderId:       sn(r.sender_id),
      senderName:     s(r.sender_name),
      content:        s(r.content),
      direction:      (r.direction as MessageDirection) ?? 'outbound',
      channel:        (r.channel as Channel) ?? 'jalla',
      status:         (r.status as 'sent' | 'delivered' | 'failed' | null) ?? null,
      attachments:    Array.isArray(r.attachments) ? (r.attachments as unknown[]) : [],
      ghlMessageId:   sn(r.ghl_message_id),
      createdAt:      s(r.created_at),
    })),
  };
}
