import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleWorkspace, type WorkspaceRaw } from './workspace';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow } from '@/types/project';
import type { StageVerification } from '@/lib/supabase/verifications';
import type { SiteUpdate } from '@/lib/supabase/site-updates';
import type { Payment } from '@/lib/supabase/payments';
import type { ProjectActivityRow } from '@/lib/supabase/activity';

/**
 * The loader assembles the lifecycle's inputs correctly — which is the whole job.
 *
 * `stageLifecycle()` is pinned by its own 18+ tests; what can go wrong HERE is feeding it
 * the wrong verification (an older one), the wrong site update (an older one), the wrong
 * `nextStageStarted`, or `[]` where it needed `null`. Each of those is a stage shown in
 * the wrong state to the person deciding whether to release money, so each is pinned.
 */

const ROOT = resolve(__dirname, '..', '..', '..');

// ── Fixture: one project, four stages, one contractor, one verifier ──────────────────
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
  beneficiaryId: null, fundingSource: null, confirmedBy: null, confirmedAt: null, authorisedBy: null, authorisedAt: null,
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

function raw(over: Partial<WorkspaceRaw> = {}): WorkspaceRaw {
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
    invites: on([{ id: 'inv1', project_id: PROJECT, invited_by: 'owner', email: 'tonny@example.com', role: 'contractor', status: 'accepted' as const, accepted_at: '2026-08-02T00:00:00Z', created_at: '2026-08-01T00:00:00Z', token: 't', contractor_user_id: 'contractor' }]),
    activity: on([
      act('a1', 'verification.requested', '2026-08-28T00:00:00Z', { entityType: 'stage_verification', entityId: 'v2' }),
      act('a2', 'stage.approved',         '2026-08-12T00:00:00Z', { entityType: 'project_stage', entityId: 's1', stageId: 's1' }),
      act('a3', 'ticket.linked',          '2026-09-06T00:00:00Z', { entityType: 'support_ticket', entityId: 'tk', personId: 'owner' }),
    ]),
    ...over,
  };
}

const now = new Date('2026-09-14T09:00:00Z');

describe('stage views feed stageLifecycle the right inputs', () => {
  const ws = assembleWorkspace(raw(), now);
  const s = (n: number) => ws.stages.find(v => v.stage.stage_number === n)!;

  it('orders stages by number and substages by substage_number', () => {
    expect(ws.stages.map(v => v.stage.stage_number)).toEqual([1, 2, 3, 4]);
    expect(s(2).substages.map(x => x.name)).toEqual(['A', 'B']);
  });

  it('picks the NEWEST verification for a stage, not the first one written', () => {
    expect(s(2).latestVerification?.decision).toBe('pending');
    expect(s(2).verifications.map(v => v.decision)).toEqual(['pending', 'rejected']);   // newest first
    expect(s(2).lifecycle.state).toBe('verification_in_progress');                       // visited, pending
  });

  it('picks the NEWEST site update as lastSiteUpdateAt', () => {
    expect(s(3).siteUpdates[0].submittedAt).toBe('2026-09-05T00:00:00Z');
    expect(s(3).lifecycle.state).toBe('evidence_submitted');
  });

  it('computes nextStageStarted from the following stage (true for the last)', () => {
    expect(s(1).nextStageStarted).toBe(true);    // stage 2 is pending_review, not locked
    expect(s(3).nextStageStarted).toBe(false);   // stage 4 is locked
    expect(s(4).nextStageStarted).toBe(true);    // last stage
  });

  it('reads the ledger into the lifecycle: stage 1 is release_authorised, stage 2 has its expected tranche', () => {
    expect(s(1).lifecycle.state).toBe('release_authorised');
    expect(s(1).release?.state).toBe('release_authorised');
    expect(s(1).tranche?.state).toBe('funded');
    expect(s(2).tranche?.state).toBe('expected');
    expect(s(2).release).toBeNull();
  });

  it('carries the certificate from the verified decision', () => {
    expect(s(1).certificateId).toBe('cert-1');
    expect(s(2).certificateId).toBeNull();
  });

  it('currentStage follows projects.current_stage', () => {
    expect(ws.currentStage?.stage.stage_number).toBe(2);
  });
});

describe('the ledger: null when not applied, [] when empty — different facts', () => {
  it('a complete, verified stage with NO ledger reads approved with no funding blocker', () => {
    const ws = assembleWorkspace(raw({
      stages: [stage(1, 'complete'), stage(2, 'locked')],
      verifications: { rows: [verification('s1', '2026-08-10T00:00:00Z', 'verified', { visitedAt: '2026-08-10T00:00:00Z' })], available: true },
      payments: { rows: [], available: false },
    }), now);
    expect(ws.stages[0].lifecycle).toEqual({ state: 'approved', blockers: [] });
    expect(ws.financials.available).toBe(false);
    expect(ws.available.ledger).toBe(false);
  });

  it('the same stage with an EMPTY ledger is approved and awaiting funding', () => {
    const ws = assembleWorkspace(raw({
      stages: [stage(1, 'complete'), stage(2, 'locked')],
      verifications: { rows: [verification('s1', '2026-08-10T00:00:00Z', 'verified', { visitedAt: '2026-08-10T00:00:00Z' })], available: true },
      payments: { rows: [], available: true },
    }), now);
    expect(ws.stages[0].lifecycle).toEqual({ state: 'approved', blockers: ['awaiting_funding'] });
    expect(ws.openBlockers).toEqual([{ stageNumber: 1, stageId: 's1', state: 'approved', blocker: 'awaiting_funding' }]);
  });

  it('funded and verified → payment_eligible, no blockers', () => {
    const ws = assembleWorkspace(raw({
      stages: [stage(1, 'complete'), stage(2, 'locked')],
      verifications: { rows: [verification('s1', '2026-08-10T00:00:00Z', 'verified', { visitedAt: '2026-08-10T00:00:00Z' })], available: true },
      payments: { rows: [pay({ direction: 'in', state: 'funded', amount: 5000, stageId: 's1' })], available: true },
    }), now);
    expect(ws.stages[0].lifecycle.state).toBe('payment_eligible');
    expect(ws.openBlockers).toEqual([]);
  });
});

describe('open blockers and financials', () => {
  it('lists every blocker across stages, worst state first, and reports on_hold on all of them', () => {
    const ws = assembleWorkspace(raw({
      project: { ...project, status: 'on_hold' } as ProjectRow,
      stages: [stage(1, 'complete'), stage(2, 'pending_review'), stage(3, 'locked')],
      verifications: { rows: [], available: true },
      payments: { rows: [], available: true },
    }), now);
    expect(ws.openBlockers.map(b => `${b.stageNumber}:${b.state}:${b.blocker}`)).toEqual([
      '2:verification_pending:on_hold', '2:verification_pending:verifier_not_selected',
      '1:approved:on_hold', '1:approved:awaiting_funding',
      '3:locked:on_hold',
    ]);
  });

  it('sums the ledger by state and never reads payment_status', () => {
    const ws = assembleWorkspace(raw({
      payments: { available: true, rows: [
        pay({ direction: 'in',  state: 'funded',             amount: 10_000, stageId: 's1' }),
        pay({ direction: 'in',  state: 'reconciled',         amount:  5_000, stageId: 's2' }),
        pay({ direction: 'in',  state: 'expected',           amount:  5_000, stageId: 's3' }),
        pay({ direction: 'out', state: 'release_authorised', amount:  4_000, stageId: 's1' }),
        pay({ direction: 'out', state: 'initiated',          amount:  1_000, stageId: 's1', createdAt: '2026-09-04T00:00:00Z' }),
        pay({ direction: 'out', state: 'disbursed',          amount:  3_000, stageId: 's2' }),
        pay({ direction: 'out', state: 'failed',             amount:  9_999, stageId: 's3' }),
      ] },
    }), now);
    expect(ws.financials).toMatchObject({
      available: true, budgetUsd: 50_000, funded: 15_000, authorised: 4_000, inFlight: 1_000, disbursed: 3_000,
      availableFunds: 15_000 - 4_000 - 1_000 - 3_000,   // failed rows do not hold funds
    });
    // Code only — the module's header explains in a comment WHY it never reads the column.
    const src = readFileSync(resolve(ROOT, 'src/lib/admin/workspace.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/payment_status/);
  });
});

describe('team and activity resolve people once, by id', () => {
  const ws = assembleWorkspace(raw(), now);

  it('owner, contractor (by accepted account) and verifier are named', () => {
    expect(ws.team.owner).toEqual({ id: 'owner', name: 'Charlotte Elame', email: 'charlotte@example.com' });
    expect(ws.team.contractors[0].name).toBe('Tonny Tawe');
    expect(ws.team.verifiers[0]).toMatchObject({ discipline: 'civil', name: 'Vanessa Gwanvoma', email: 'pekuna@tryjalla.com' });
  });

  it('a contractor who has not accepted is named by the invite email', () => {
    const w = assembleWorkspace(raw({ invites: { available: true, rows: [
      { id: 'i', project_id: PROJECT, invited_by: 'owner', email: 'new@example.com', role: 'contractor', status: 'pending', accepted_at: null, created_at: '', token: 't', contractor_user_id: null },
    ] } }), now);
    expect(w.team.contractors[0].name).toBe('new@example.com');
  });

  it('activity is newest first, actor by name then by address, entity → tab', () => {
    expect(ws.activity.map(a => a.id)).toEqual(['a3', 'a1', 'a2']);
    expect(ws.activity[1]).toMatchObject({ action: 'verification.requested', actorName: 'phavorfavor@gmail.com', tab: 'stages' });
    expect(ws.activity[2].tab).toBe('stages');
    expect(ws.activity[0]).toMatchObject({ personName: 'Charlotte Elame', tab: null });   // support_ticket: no tab
  });

  it('an unknown actor id resolves to an empty name, never to a guess', () => {
    const w = assembleWorkspace(raw({ activity: { available: true, rows: [act('x', 'stage.approved', '2026-09-01T00:00:00Z', { actorId: 'ghost' })] } }), now);
    expect(w.activity[0].actorName).toBe('');
  });
});

describe('fail-soft flags pass through untouched', () => {
  it('every domain reports its own availability', () => {
    const ws = assembleWorkspace(raw({
      siteUpdates: { rows: [], available: false }, decisions: { rows: [], available: false }, activity: { rows: [], available: false },
    }), now);
    expect(ws.available).toEqual({
      siteUpdates: false, verifications: true, verifiers: true, ledger: true, conversations: true,
      decisions: false, documents: true, invites: true, activity: false,
    });
  });
});

describe('the loader (static)', () => {
  const loader = readFileSync(resolve(ROOT, 'src/lib/supabase/workspace.ts'), 'utf8');

  it('reads through the existing modules and writes nothing', () => {
    for (const fn of ['fetchProject', 'fetchProjectStages', 'fetchProjectSubstages', 'fetchProjectFees', 'ownerLookup',
      'listSiteUpdates', 'listProjectVerifications', 'listProjectVerifiers', 'listProjectPayments',
      'listConversations', 'listDecisions', 'fetchDocuments', 'fetchInvites', 'listProjectActivity']) {
      expect(loader, `loader must use ${fn}`).toContain(`${fn}(`);
    }
    expect(loader).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
    expect(loader).not.toMatch(/supabase\.from\(/);   // no ad-hoc table reads outside the modules
  });

  it('is fail-soft per domain, not per page', () => {
    expect(loader).toContain('Promise.allSettled');
    expect(loader).toMatch(/available: false/);
    expect(loader).toContain('errors[k as WorkspaceDomain]');
  });

  it('returns null for a project that does not exist rather than an empty workspace', () => {
    expect(loader).toMatch(/if \(!project\) return null;/);
  });
});

describe('the new readers (static)', () => {
  const activity = readFileSync(resolve(ROOT, 'src/lib/supabase/activity.ts'), 'utf8');
  const conversations = readFileSync(resolve(ROOT, 'src/lib/supabase/conversations.ts'), 'utf8');

  it('listProjectActivity filters by project, reads the 089 columns, and falls back on 42703', () => {
    expect(activity).toMatch(/listProjectActivity[\s\S]*?\.eq\('project_id', projectId\)/);
    expect(activity).toMatch(/id, action, actor_id, person_id, entity_type, entity_id, stage_id, details, created_at/);
    expect(activity).toMatch(/res\.error\.code === '42703'/);
  });

  it('listConversationMessages reads by conversation_id in thread order with the 091 columns', () => {
    expect(conversations).toMatch(/listConversationMessages[\s\S]*?\.eq\('conversation_id', conversationId\)[\s\S]*?ascending: true/);
    expect(conversations).toMatch(/direction, channel, status, attachments, ghl_message_id/);
  });
});
