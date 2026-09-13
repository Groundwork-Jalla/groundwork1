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
