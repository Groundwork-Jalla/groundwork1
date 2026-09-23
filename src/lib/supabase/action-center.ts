import { supabase } from './client';
import { isMissingTable } from '@/lib/errors';
import { ownerLookup } from './admin-users';
import { listAllPayments } from './payments';
import { unansweredConversations } from './conversations';
import { listOpenSupportTickets } from './support';
import { actionCenterItems, type ActionCenterInput, type ActionItem } from '@/lib/admin/action-center';
import { listConversationPreviews, listConversations } from './conversations';
import type { StageVerification } from './verifications';

// =========================================================
// Loads the rows the Action Center rules read and runs them. Admin-only by RLS: every
// read here is a table an admin can SELECT under 009/086–091. Fail-soft per domain — a
// migration that has not been pasted yet hides its items, not the page — and every
// `available` flag says which.
// =========================================================

export interface ActionCenterData {
  items: ActionItem[];
  available: { verifications: boolean; siteUpdates: boolean; ledger: boolean; conversations: boolean };
  loadedAt: string;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A fail-soft table read: rows, or [] with available=false when the table is not there yet. */
type Filter = { eq: (c: string, v: unknown) => Filter };
async function softRows(table: string, columns: string, modify?: (q: Filter) => Filter): Promise<{ rows: Row[]; available: boolean }> {
  const base = supabase.from(table).select(columns);
  const q = modify ? (modify(base as unknown as Filter) as unknown as typeof base) : base;
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }
  return { rows: (data ?? []) as unknown as Row[], available: true };
}

export async function loadActionCenter(now: Date = new Date(), workspaceReady = true): Promise<ActionCenterData> {
  const [projectsRes, stagesRes, verRes, verifiersRes, updatesRes, ledger, eventsRes, waiting, appsRes, inqRes, ticketsRes, owners] = await Promise.all([
    supabase.from('projects').select('id, name, user_id, status, tier, tracking_started_at, created_at').neq('status', 'archived'),
    supabase.from('project_stages').select('id, project_id, stage_number, status, verification_required, payment_milestone_usd, completed_at'),
    softRows('stage_verifications', 'id, stage_id, project_id, verifier_id, requested_by, requested_at, visited_at, decision, decided_at, recorded_by, recorded_on_behalf_of, reason, certificate_id'),
    softRows('project_verifiers', 'project_id, status', q => q.eq('status', 'active')),
    softRows('site_updates', 'stage_id, submitted_at'),
    listAllPayments(),
    softRows('payment_events', 'id, received_at', q => q.eq('outcome', 'unmatched')),
    unansweredConversations(),
    supabase.from('contractor_applications').select('id, full_name, email, created_at').eq('status', 'pending'),
    // `contractor_inquiries` has no `email` column (076 deliberately stores only the
    // name and location typed in the dialog). Asking for one made PostgREST answer 400,
    // and because a PostgREST error arrives as a value rather than a throw, the quote
    // requests silently vanished from the Action Center instead of failing loudly.
    supabase.from('contractor_inquiries').select('id, name, location, created_at').eq('status', 'open'),
    listOpenSupportTickets(),
    ownerLookup(),
  ]);
  if (projectsRes.error) throw projectsRes.error;
  if (stagesRes.error)   throw stagesRes.error;
  // A PostgREST error is a value, not a throw: an unchecked one reads as an empty queue,
  // which is how a broken select becomes "nothing needs your attention".
  if (appsRes.error) throw appsRes.error;
  if (inqRes.error)  throw inqRes.error;

  // Two more reads, both bounded by the waiting list and skipped entirely when it is
  // empty: what channel each waiting thread is on, and what was last said on it.
  const waitingIds = waiting.rows.map(w => w.conversationId);
  const [channelOf, previews] = waitingIds.length === 0
    ? [new Map<string, string>(), new Map<string, { content: string; direction: string }>()]
    : await Promise.all([
        listConversations().then(r => new Map(r.rows.map(c => [c.id, c.channel as string]))).catch(() => new Map<string, string>()),
        listConversationPreviews(waitingIds).then(r => r.previews as Map<string, { content: string; direction: string }>).catch(() => new Map<string, { content: string; direction: string }>()),
      ]);

  const activeVerifiers = new Map<string, number>();
  for (const r of verifiersRes.rows) activeVerifiers.set(str(r.project_id), (activeVerifiers.get(str(r.project_id)) ?? 0) + 1);

  const input: ActionCenterInput = {
    projects: ((projectsRes.data ?? []) as Row[]).map(p => ({
      id: str(p.id), name: str(p.name), status: str(p.status), tier: str(p.tier),
      tracking_started_at: (p.tracking_started_at as string | null) ?? null, created_at: (p.created_at as string | null) ?? null,
      ownerName: owners.get(str(p.user_id))?.name || owners.get(str(p.user_id))?.email,
    })),
    stages: ((stagesRes.data ?? []) as Row[]).map(s => ({
      id: str(s.id), project_id: str(s.project_id), stage_number: Number(s.stage_number), status: str(s.status),
      verification_required: s.verification_required === true, payment_milestone_usd: s.payment_milestone_usd == null ? null : Number(s.payment_milestone_usd),
      completed_at: (s.completed_at as string | null) ?? null,
    })),
    verifications: verRes.rows.map(r => ({
      id: str(r.id), stageId: str(r.stage_id), projectId: str(r.project_id), verifierId: str(r.verifier_id),
      requestedBy: (r.requested_by as string | null) ?? null, requestedAt: str(r.requested_at), visitedAt: (r.visited_at as string | null) ?? null,
      decision: r.decision as StageVerification['decision'], findings: null, checklist: null,
      decidedAt: (r.decided_at as string | null) ?? null, recordedBy: (r.recorded_by as string | null) ?? null,
      recordedOnBehalfOf: (r.recorded_on_behalf_of as string | null) ?? null, reason: (r.reason as string | null) ?? null,
      certificateId: (r.certificate_id as string | null) ?? null,
    })),
    verifiers: [...activeVerifiers].map(([projectId, active]) => ({ projectId, active })),
    siteUpdates: updatesRes.rows.map(r => ({ stageId: str(r.stage_id), submittedAt: str(r.submitted_at) })),
    payments: ledger.rows,
    ledgerAvailable: ledger.available,
    unmatchedEvents: eventsRes.rows.map(r => ({ id: str(r.id), receivedAt: str(r.received_at) })),
    waiting: waiting.rows.map(w => ({
      conversationId: w.conversationId, projectId: w.projectId, waitingSince: w.waitingSince, band: w.band,
      personName: w.personId ? (owners.get(w.personId)?.name || owners.get(w.personId)?.email) : undefined,
      channel: channelOf.get(w.conversationId),
      // The client's last word. A staff internal note is not offered as the thing waiting.
      preview: previews.get(w.conversationId)?.direction === 'internal' ? undefined : previews.get(w.conversationId)?.content,
    })),
    applications: ((appsRes.data ?? []) as Row[]).map(a => ({ id: str(a.id), label: str(a.full_name) || str(a.email), since: str(a.created_at) })),
    inquiries:    ((inqRes.data ?? []) as Row[]).map(q => ({ id: str(q.id), label: str(q.name) || str(q.location), since: str(q.created_at) })),
    tickets:      ticketsRes.map(t => ({ id: t.id, label: t.subject || t.name || t.email, since: t.created_at })),
  };

  return {
    items: actionCenterItems(input, now, workspaceReady),
    available: { verifications: verRes.available, siteUpdates: updatesRes.available, ledger: ledger.available, conversations: waiting.available },
    loadedAt: now.toISOString(),
  };
}
