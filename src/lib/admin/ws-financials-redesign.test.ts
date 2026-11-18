import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import { assembleWorkspace, type WorkspaceRaw } from './workspace';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow } from '@/types/project';
import type { StageVerification } from '@/lib/supabase/verifications';
import type { SiteUpdate } from '@/lib/supabase/site-updates';
import type { Payment } from '@/lib/supabase/payments';
import type { ProjectActivityRow } from '@/lib/supabase/activity';

/**
 * The redesigned workspace Financials tab (18 Nov, ws-financials-desktop.png): where the money
 * stands, the per-stage journey table with its one act, Funding beside Disbursements, then
 * Fees, Compensation, Reconciliation and Costing. Every act opens the same ledger dialog.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  events: vi.fn(),
}));
vi.mock('react', async original => {
  const real = await original<typeof import('react')>();
  const slot = () => { const list = h.store.get(h.path) ?? []; h.store.set(h.path, list); return { list, i: h.idx++ }; };
  return { ...real,
    useState: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = typeof initial === 'function' ? initial() : initial;
      return [list[i], (value: any) => { list[i] = typeof value === 'function' ? value(list[i]) : value; }]; },
    useRef: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = { current: initial }; return list[i]; },
    useEffect: (run: () => any) => { h.idx++; h.effects.push({ run }); },
    useMemo: (make: () => any) => { h.idx++; return make(); },
    useCallback: (callback: any) => { h.idx++; return callback; },
  };
});
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('framer-motion', () => ({ motion: { div: 'div' }, AnimatePresence: ({ children }: any) => children }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin' } }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/format', async o => ({ ...(await o<any>()), formatRelative: () => '2 h ago' }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: (s: any) => s.name, substageLabel: (s: any) => s.name }) }));
vi.mock('@/lib/supabase/payments', () => ({ listPaymentEvents: h.events }));
vi.mock('@/components/project/BudgetView', () => ({ default: 'mock-budget-view' }));
vi.mock('@/components/project/StagePricingPanel', () => ({ StagePricingPanel: 'mock-pricing' }));
vi.mock('@/components/admin/workspace/RepriceCard', () => ({ RepriceCard: 'mock-reprice' }));
vi.mock('@/components/admin/ledger/LedgerModal', () => ({ LedgerModal: 'mock-ledger' }));
import { FinancialsTab } from '@/components/admin/workspace/FinancialsTab';

type Node = { type: any; props: Record<string, any>; key?: string | null };
function expand(value: any, path: string): Node[] {
  if (Array.isArray(value)) return value.flatMap((child, i) => expand(child, `${path}.${child?.key ?? i}`));
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  if (typeof value.type === 'function') {
    const saved = [h.path, h.idx] as const; h.path = `${path}/${value.type.name}`; h.idx = 0;
    const out = value.type(value.props); const inner = h.path; [h.path, h.idx] = saved;
    return [value, ...expand(out, inner)];
  }
  return [value, ...expand(value.props?.children, path)];
}
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const L = (k: string) => lookup(en as never, k) as string;

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
    invites: on([{ id: 'inv1', project_id: PROJECT, invited_by: 'owner', email: 'tonny@example.com', role: 'contractor', status: 'accepted' as const, accepted_at: '2026-08-02T00:00:00Z', created_at: '2026-08-01T00:00:00Z', token: 't', contractor_user_id: 'contractor', is_primary: true }]),
    activity: on([
      act('a1', 'verification.requested', '2026-08-28T00:00:00Z', { entityType: 'stage_verification', entityId: 'v2' }),
      act('a2', 'stage.approved',         '2026-08-12T00:00:00Z', { entityType: 'project_stage', entityId: 's1', stageId: 's1' }),
      act('a3', 'ticket.linked',          '2026-09-06T00:00:00Z', { entityType: 'support_ticket', entityId: 'tk', personId: 'owner' }),
    ]),
    ...over,
  };
}

const now = new Date('2026-09-14T09:00:00Z');
let rawOver: Partial<WorkspaceRaw> = {};
const onChanged = vi.fn();
function loaded() { return { workspace: assembleWorkspace(raw(rawOver), now), errors: {} }; }
let LOADED = loaded();
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: FinancialsTab, props: { loaded: LOADED, onChanged }, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }
const button = (view: Node[], label: string) => view.filter(n => n.type === 'button' && text(n.props.children).includes(label));
const strings = (view: Node[]) => view.map(n => typeof n.props?.children === 'string' ? n.props.children : '');

// Stage 1 complete, funded, with no release yet: releasable. The project is in Cameroon.
const releasable = () => [
  pay({ direction: 'in', state: 'funded', amount: 5000, stageId: 's1' }),
  pay({ direction: 'in', state: 'expected', amount: 5000, stageId: 's2' }),
];

beforeEach(() => {
  h.store = new Map(); rawOver = {}; LOADED = loaded(); onChanged.mockReset();
  h.events.mockReset().mockResolvedValue({ rows: [], available: true });
});

describe('the Financials tab, redesigned', () => {
  it('the six figures are the loader’s, each with its XAF line', async () => {
    const s = strings(await settle());
    expect(s).toContain(L('admin.workspace.financialsView.standsTitle'));
    expect(s).toContain('$50,000.00');
    expect(s.some(x => /XAF$/.test(x))).toBe(true);
  });

  it('every stage row opens that stage in the Stages tab', async () => {
    const to = (await settle()).filter(n => n.type === 'a').map(n => n.props.to);
    for (const id of ['s1', 's2', 's3', 's4']) expect(to).toContain(`/admin/projects/p1?tab=stages&stage=${id}`);
  });

  it('a releasable stage offers Authorise release in its row, which opens the authorise dialog', async () => {
    rawOver = { payments: { rows: releasable(), available: true } }; LOADED = loaded();
    let view = await settle();
    const auth = button(view, L('admin.ledger.authorise'));
    expect(auth).toHaveLength(1);
    auth[0].props.onClick(); view = render();
    expect(view.find(n => n.type === 'mock-ledger')?.props.modal).toMatchObject({ kind: 'authorise', stage: { id: 's1' } });
    view.find(n => n.type === 'mock-ledger')!.props.onDone();
    expect(onChanged).toHaveBeenCalled();
  });

  it('an expected tranche offers Confirm received, which opens the confirm dialog', async () => {
    let view = await settle();
    button(view, L('admin.ledger.confirmFunding'))[0].props.onClick(); view = render();
    expect(view.find(n => n.type === 'mock-ledger')?.props.modal.kind).toBe('confirm');
  });

  it('a failed release offers Open reconciliation', async () => {
    rawOver = { payments: { rows: [pay({ direction: 'out', state: 'failed', amount: 5000, stageId: 's1', failureReason: 'Account closed' })], available: true } }; LOADED = loaded();
    let view = await settle();
    button(view, L('admin.ledger.openReconciliation'))[0].props.onClick(); view = render();
    expect(view.find(n => n.type === 'mock-ledger')?.props.modal.kind).toBe('reconcile');
  });

  it('a long funding list shows nine, then Show all', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...pay({ direction: 'in', state: 'funded', amount: 100 + i, stageId: 's1' }), id: `in${i}` }));
    rawOver = { payments: { rows: many, available: true } }; LOADED = loaded();
    let view = await settle();
    expect(button(view, 'Show all 12')).toHaveLength(1);
    button(view, 'Show all 12')[0].props.onClick(); view = render();
    expect(button(view, 'Show all 12')).toHaveLength(0);
  });

  it('the provider banner still points at Integrations, and the costing still opens the take-off', async () => {
    const to = (await settle()).filter(n => n.type === 'a').map(n => n.props.to);
    expect(to).toContain('/admin/integrations');
    expect(to).toContain('/admin/projects/p1/takeoff');
  });

  it('the new strings exist in both languages', () => {
    for (const k of ['standsTitle', 'notFunded', 'paid', 'showAll', 'actionNote']) {
      expect(lookup(fr as never, `admin.workspace.financialsView.${k}`), k).not.toBe(L(`admin.workspace.financialsView.${k}`));
    }
  });
});
