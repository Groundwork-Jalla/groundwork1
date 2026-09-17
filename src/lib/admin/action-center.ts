import { stageLifecycle, type StageLifecycle } from '@/lib/lifecycle/stage';
import type { StageVerification } from '@/lib/supabase/verifications';
import type { Payment } from '@/lib/supabase/payments';

// =========================================================
// The Action Center — computed from state, never stored (03 §5).
//
// Every item answers: what · which project or person · how old · how urgent · where to
// act. The rules are the table in docs/groundwork-admin/03-workflows.md §5, one function
// per row, all pure: rows in, items out, the clock passed in. An `action_center_items`
// table would be a second source of truth for "what needs doing", so there is none —
// the Overview and the Action Center page call this on load.
//
// Inputs are the real rows the admin can already read (RLS): projects, stages,
// verifications, verifiers, site updates, the ledger, waiting conversations (banded by
// the database's own thresholds, 091 `unanswered_conversations()`), and the three queues.
// Nothing here fabricates a row; an empty input list is an empty section.
// =========================================================

export type ActionKind =
  | 'budget_unconfirmed'
  | 'verifier_assignment_missing'
  | 'verifier_selection_needed'
  | 'verification_due'
  | 'stage_ready_to_approve'
  | 'evidence_requested'
  | 'awaiting_funding'
  | 'payment_ready'
  | 'disbursement_failed'
  | 'unanswered_conversation'
  | 'application_to_decide'
  | 'quote_request_open'
  | 'support_ticket_open';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface ActionItem {
  kind: ActionKind;
  priority: Priority;
  /** ISO timestamp the item has been open since; age is measured from it. */
  since: string;
  projectId?: string;
  projectName?: string;
  /** The person the item concerns — client, applicant, contact — when there is one. */
  personName?: string;
  stageNumber?: number;
  /** Where one click takes the admin (a queue, or the Workspace deep link). */
  to: string;
  /** Stable key for React lists and de-duplication. */
  key: string;
}

export interface ActionProject {
  id: string; name: string; status: string; tier: string;
  tracking_started_at: string | null; created_at?: string | null; ownerName?: string;
}
export interface ActionStage {
  id: string; project_id: string; stage_number: number; status: string;
  verification_required?: boolean | null; payment_milestone_usd?: number | null;
  completed_at?: string | null; updated_at?: string | null;
}
export interface ActionSiteUpdate { stageId: string; submittedAt: string }
export interface ActionVerifierCount { projectId: string; active: number }
export interface WaitingConversation {
  conversationId: string; projectId: string | null; personName?: string;
  waitingSince: string; band: 'medium' | 'high' | 'critical';
}
export interface QueueRow { id: string; label: string; since: string }
export interface UnmatchedEvent { id: string; receivedAt: string }

export interface ActionCenterInput {
  projects: ActionProject[];
  stages: ActionStage[];
  verifications: StageVerification[];
  verifiers: ActionVerifierCount[];
  siteUpdates: ActionSiteUpdate[];
  payments: Pick<Payment, 'id' | 'projectId' | 'stageId' | 'direction' | 'state' | 'amount' | 'createdAt' | 'updatedAt'>[];
  /** False when 090 is not applied: eligibility is then not evaluated (no funding items). */
  ledgerAvailable: boolean;
  unmatchedEvents: UnmatchedEvent[];
  waiting: WaitingConversation[];
  applications: QueueRow[];
  inquiries: QueueRow[];
  tickets: QueueRow[];
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Stage deep link into the Workspace (Phase 5). TEMPORARY until the route exists: the
 *  Stages & Reviews queue, which is where these stages are acted on today. */
export function stageLink(projectId: string, stageId: string, workspaceReady: boolean): string {
  return workspaceReady ? `/admin/projects/${projectId}?tab=stages&stage=${stageId}` : '/admin/reviews';
}

export function actionCenterItems(input: ActionCenterInput, now: Date, workspaceReady = true): ActionItem[] {
  const items: ActionItem[] = [];
  const projectById = new Map(input.projects.map(p => [p.id, p]));
  const stagesByProject = new Map<string, ActionStage[]>();
  for (const s of input.stages) {
    const list = stagesByProject.get(s.project_id) ?? [];
    list.push(s); stagesByProject.set(s.project_id, list);
  }
  const verifierCount = new Map(input.verifiers.map(v => [v.projectId, v.active]));
  const latestUpdate = new Map<string, string>();
  for (const u of input.siteUpdates) {
    const cur = latestUpdate.get(u.stageId);
    if (!cur || u.submittedAt > cur) latestUpdate.set(u.stageId, u.submittedAt);
  }
  const latestVerification = (stageId: string): StageVerification | null => {
    const mine = input.verifications.filter(v => v.stageId === stageId);
    return mine.length ? mine.reduce((a, b) => (b.requestedAt > a.requestedAt ? b : a)) : null;
  };
  const paymentsByProject = new Map<string, ActionCenterInput['payments']>();
  for (const p of input.payments) {
    const list = paymentsByProject.get(p.projectId) ?? [];
    list.push(p); paymentsByProject.set(p.projectId, list);
  }

  for (const project of input.projects) {
    if (project.status === 'archived' || project.status === 'completed') continue;
    const stages = (stagesByProject.get(project.id) ?? []).slice().sort((a, b) => a.stage_number - b.stage_number);

    // Budget unconfirmed — Management project, tracking not started.
    if (['jalla_management', 'enterprise'].includes(project.tier) && !project.tracking_started_at) {
      items.push({
        kind: 'budget_unconfirmed', priority: 'high', since: project.created_at ?? now.toISOString(),
        projectId: project.id, projectName: project.name, personName: project.ownerName,
        to: '/admin/budgets', key: `budget:${project.id}`,
      });
    }

    // Verifier assignment missing — tracked, any stage requires verification, no active verifier.
    if (project.tracking_started_at && stages.some(s => s.verification_required) && (verifierCount.get(project.id) ?? 0) === 0) {
      items.push({
        kind: 'verifier_assignment_missing', priority: 'high', since: project.tracking_started_at,
        projectId: project.id, projectName: project.name, personName: project.ownerName,
        to: workspaceReady ? `/admin/projects/${project.id}?tab=team` : '/admin/projects', key: `verifier-assign:${project.id}`,
      });
    }

    const ledger = (paymentsByProject.get(project.id) ?? []).map(p => ({ ...p }));
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      const v = latestVerification(s.id);
      const lastUpdate = latestUpdate.get(s.id) ?? null;
      const next = stages[i + 1];
      const lifecycle: StageLifecycle = stageLifecycle(
        { id: s.id, status: s.status as 'locked' | 'active' | 'pending_review' | 'complete', stage_number: s.stage_number,
          verification_required: s.verification_required ?? false, payment_milestone_usd: s.payment_milestone_usd ?? null },
        input.verifications, { status: project.status as 'active' | 'on_hold' | 'completed' | 'archived' },
        next ? next.status !== 'locked' : true, lastUpdate,
        input.ledgerAvailable ? ledger : null,
      );
      const base = { projectId: project.id, projectName: project.name, personName: project.ownerName, stageNumber: s.stage_number };
      const link = stageLink(project.id, s.id, workspaceReady);

      // Verifier selection needed — pending_review ∧ required ∧ no verification since the latest site update.
      if (s.status === 'pending_review' && s.verification_required && (!v || (lastUpdate && v.requestedAt < lastUpdate && v.decision !== 'pending'))) {
        items.push({ ...base, kind: 'verifier_selection_needed', priority: 'high', since: lastUpdate ?? s.updated_at ?? now.toISOString(), to: link, key: `select-verifier:${s.id}` });
      }
      // Verification due — a pending decision, escalating with age.
      if (v?.decision === 'pending') {
        const days = (now.getTime() - new Date(v.requestedAt).getTime()) / 86_400_000;
        items.push({ ...base, kind: 'verification_due', priority: days >= 5 ? 'critical' : 'high', since: v.requestedAt, to: link, key: `verify:${v.id}` });
      }
      // Stage ready to approve — verified, still pending_review.
      if (lifecycle.state === 'verified' && s.status === 'pending_review') {
        items.push({ ...base, kind: 'stage_ready_to_approve', priority: 'high', since: v?.decidedAt ?? s.updated_at ?? now.toISOString(), to: '/admin/reviews', key: `approve:${s.id}` });
      }
      // Evidence requested — rejected / needs more, stage back to active, nothing new since.
      if (lifecycle.state === 'rejected') {
        items.push({ ...base, kind: 'evidence_requested', priority: 'medium', since: v?.decidedAt ?? now.toISOString(), to: link, key: `evidence:${s.id}` });
      }
      // Awaiting funding — approved with the blocker.
      if (lifecycle.state === 'approved' && lifecycle.blockers.includes('awaiting_funding')) {
        items.push({ ...base, kind: 'awaiting_funding', priority: 'medium', since: s.completed_at ?? now.toISOString(), to: '/admin/budgets', key: `funding:${s.id}` });
      }
      // Payment ready — eligible, no out row.
      if (lifecycle.state === 'payment_eligible') {
        items.push({ ...base, kind: 'payment_ready', priority: 'high', since: s.completed_at ?? now.toISOString(), to: '/admin/budgets', key: `release:${s.id}` });
      }
    }

    // Disbursement failed / reconciling.
    for (const p of ledger) {
      if (p.direction === 'out' && (p.state === 'failed' || p.state === 'reconciling')) {
        const stage = stages.find(s => s.id === p.stageId);
        items.push({
          kind: 'disbursement_failed', priority: 'critical', since: p.updatedAt, projectId: project.id, projectName: project.name,
          personName: project.ownerName, stageNumber: stage?.stage_number, to: '/admin/budgets', key: `disbursement:${p.id}`,
        });
      }
    }
  }

  // Provider events that matched nothing.
  for (const e of input.unmatchedEvents) {
    items.push({ kind: 'disbursement_failed', priority: 'critical', since: e.receivedAt, to: '/admin/budgets', key: `unmatched:${e.id}` });
  }

  // Unanswered conversations — the database banded them (091 thresholds in app_config).
  for (const w of input.waiting) {
    const project = w.projectId ? projectById.get(w.projectId) : undefined;
    items.push({
      kind: 'unanswered_conversation', priority: w.band, since: w.waitingSince,
      projectId: w.projectId ?? undefined, projectName: project?.name, personName: w.personName,
      to: '/admin/inbox', key: `conversation:${w.conversationId}`,
    });
  }

  for (const a of input.applications) items.push({ kind: 'application_to_decide', priority: 'medium', since: a.since, personName: a.label, to: `/admin/applications/${a.id}`, key: `application:${a.id}` });
  for (const q of input.inquiries)    items.push({ kind: 'quote_request_open',    priority: 'medium', since: q.since, personName: q.label, to: '/admin/inquiries', key: `inquiry:${q.id}` });
  for (const s of input.tickets)      items.push({ kind: 'support_ticket_open',   priority: 'medium', since: s.since, personName: s.label, to: '/admin/support',   key: `ticket:${s.id}` });

  return items.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.since.localeCompare(b.since));
}

/** Hours since `since`, for the age column. */
export function ageHours(since: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(since).getTime()) / 3_600_000);
}
