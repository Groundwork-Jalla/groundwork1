import type { WorkspaceRaw } from '../workspace';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow, ProjectDocumentRow } from '@/types/project';
import type { StageVerification } from '@/lib/supabase/verifications';
import type { SiteUpdate } from '@/lib/supabase/site-updates';
import type { Payment } from '@/lib/supabase/payments';
import type { ProjectActivityRow } from '@/lib/supabase/activity';
import type { Conversation, Decision } from '@/lib/supabase/conversations';

// The workspace fixture of workspace.test.ts, shared by the 18 Nov tab-redesign tests
// (ws-*-redesign.test.ts) plus the rows those tabs need: documents, threads, decisions.

const PROJECT = 'p1';
const project = {
  id: PROJECT, user_id: 'owner', name: 'Bamenda Family House', status: 'active', tier: 'jalla_verify',
  current_stage: 2, budget_usd: 50_000, tracking_started_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  country: 'CM', city: 'Bamenda',
} as unknown as ProjectRow;

const stage = (n: number, status: ProjectStageRow['status'], milestone: number | null = 5000, required = true): ProjectStageRow => ({
  id: `s${n}`, project_id: PROJECT, stage_number: n, stage_key: `k${n}`, name: `Stage ${n}`, status,
  budget_pct: 10, fixed_amount_usd: null, payment_milestone_usd: milestone, payment_status: 'unpaid' as never,
  verification_required: required, completed_at: null, planned_start: null, planned_end: null, notes: null,
  created_at: '2026-08-01T00:00:00Z',
});

const verification = (stageId: string, requestedAt: string, decision: StageVerification['decision'], extra: Partial<StageVerification> = {}): StageVerification => ({
  id: `v-${stageId}-${requestedAt}`, stageId, projectId: PROJECT, verifierId: 'ver', requestedBy: 'admin', requestedAt,
  visitedAt: null, decision, findings: null, checklist: null, decidedAt: decision === 'pending' ? null : requestedAt,
  recordedBy: null, recordedOnBehalfOf: null, reason: null, certificateId: null, ...extra,
});

const update = (stageId: string, submittedAt: string): SiteUpdate => ({
  id: `u-${stageId}-${submittedAt}`, projectId: PROJECT, stageId, substageId: null, submittedBy: 'contractor',
  submittedAt, description: null, evidencePaths: [], location: null,
});

const pay = (p: Partial<Payment> & Pick<Payment, 'direction' | 'state' | 'amount'>): Payment => ({
  id: `pay-${p.direction}-${p.state}-${p.stageId ?? 'x'}`, projectId: PROJECT, stageId: null, currency: 'USD',
  beneficiaryId: null, fundingSource: null, confirmedBy: null, confirmedAt: null, authorisedBy: null, authorisedAt: null, initiatedAt: null,
  note: null, provider: null, providerRef: null, failureReason: null, settledAt: null,
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...p,
});

const act = (id: string, action: string, createdAt: string, extra: Partial<ProjectActivityRow> = {}): ProjectActivityRow => ({
  id, action, actorId: 'admin', personId: null, entityType: null, entityId: null, stageId: null, details: {}, createdAt, ...extra,
});

const people = new Map([
  ['owner',      { name: 'Charlotte Elame', email: 'charlotte@example.com' }],
  ['admin',      { name: '',                email: 'phavorfavor@gmail.com' }],   // no profile name → the address
  ['contractor', { name: 'Tonny Tawe',      email: 'tonny@example.com' }],
  ['ver',        { name: 'Vanessa Gwanvoma', email: 'pekuna@tryjalla.com' }],
]);

export function raw(over: Partial<WorkspaceRaw> = {}): WorkspaceRaw {
  const on = <T,>(rows: T[]) => ({ rows, available: true });
  return {
    project,
    stages: [stage(1, 'complete'), stage(2, 'pending_review'), stage(3, 'active'), stage(4, 'locked')],
    substages: [
      { id: 'sub-b', stage_id: 's2', project_id: PROJECT, substage_number: 2, substage_key: null, name: 'B', status: 'in_progress', evidence_urls: [], approved_by: null, approved_at: null, completed_at: null, created_at: '' },
      { id: 'sub-a', stage_id: 's2', project_id: PROJECT, substage_number: 1, substage_key: null, name: 'A', status: 'complete',    evidence_urls: ['p1/x.jpg'], approved_by: null, approved_at: null, completed_at: null, created_at: '' },
    ] as ProjectSubstageRow[],
    fees: [],
    people,
    siteUpdates: on([update('s3', '2026-09-02T00:00:00Z'), update('s3', '2026-09-05T00:00:00Z')]),
    verifications: on([
      verification('s2', '2026-08-20T00:00:00Z', 'rejected'),
      verification('s2', '2026-08-28T00:00:00Z', 'pending', { visitedAt: '2026-08-29T00:00:00Z' }),
      verification('s1', '2026-08-10T00:00:00Z', 'verified', { certificateId: 'cert-1', visitedAt: '2026-08-10T00:00:00Z' }),
    ]),
    verifiers: on([{ id: 'pv1', projectId: PROJECT, userId: 'ver', discipline: 'civil', status: 'active' as const, assignedAt: '2026-08-05T00:00:00Z' }]),
    payments: on([
      pay({ direction: 'in',  state: 'funded',  amount: 5000, stageId: 's1' }),
      pay({ direction: 'in',  state: 'expected', amount: 5000, stageId: 's2' }),
      pay({ direction: 'out', state: 'release_authorised', amount: 5000, stageId: 's1', createdAt: '2026-09-03T00:00:00Z' }),
    ]),
    conversations: on([]),
    decisions: on([]),
    documents: on([]),
    invites: on([{ id: 'inv1', project_id: PROJECT, invited_by: 'owner', email: 'tonny@example.com', role: 'contractor', status: 'accepted' as const, accepted_at: '2026-08-02T00:00:00Z', created_at: '2026-08-01T00:00:00Z', token: 't', contractor_user_id: 'contractor', is_primary: true }]),
    activity: on([
      act('a1', 'verification.requested', '2026-08-28T00:00:00Z', { entityType: 'stage_verification', entityId: 'v2' }),
      act('a2', 'stage.approved',         '2026-08-12T00:00:00Z', { entityType: 'project_stage', entityId: 's1', stageId: 's1' }),
      act('a3', 'ticket.linked',          '2026-09-06T00:00:00Z', { entityType: 'support_ticket', entityId: 'tk', personId: 'owner' }),
    ]),
    ...over,
  };
}

export { update, act, people };

export const doc = (id: string, category: ProjectDocumentRow['category'], file_name: string, extra: Partial<ProjectDocumentRow> = {}): ProjectDocumentRow => ({
  id, project_id: PROJECT, file_name, file_path: `p1/${file_name}`, file_size: 1_800_000, mime_type: file_name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
  uploaded_by: 'owner', category, stage_id: null, created_at: '2026-09-01T00:00:00Z', ...extra,
});

export const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, personId: 'owner', projectId: PROJECT, channel: 'jalla' as Conversation['channel'], subject: null, status: 'waiting_on_us',
  assignedTo: null, ghlConversationId: null, lastMessageAt: '2026-09-13T08:00:00Z', resolvedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});

export const decision = (id: string, extra: Partial<Decision> = {}): Decision => ({
  id, projectId: PROJECT, conversationId: 'c1', messageId: null, subject: 'Window moved to the east wall', decision: 'Same price.',
  related: 'stage', relatedId: 's2', supersedesId: null, recordedBy: 'admin', approvedBy: 'owner', approvedAt: '2026-09-12T00:00:00Z',
  costImpactUsd: 0, scheduleImpactDays: 1, recordedAt: '2026-09-12T00:00:00Z', ...extra,
} as Decision);
