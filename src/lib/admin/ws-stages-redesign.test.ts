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
 * The redesigned workspace Stages tab (18 Nov, ws-stages-desktop.png): ladder with progress
 * and milestones, the six-step rail, the Next action card and the 2×3 step grid. Every act
 * is pressed and must reach the same function it always did.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  request: vi.fn(), record: vi.fn(), approve: vi.fn(), rework: vi.fn(), markPaid: vi.fn(),
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
vi.mock('@/lib/supabase/verifications', () => ({ requestVerification: h.request, recordVerification: h.record }));
vi.mock('@/lib/supabase/approvals', () => ({ adminApproveStage: h.approve, adminRequestRework: h.rework }));
vi.mock('@/lib/supabase/payout-destinations', () => ({ fetchPayoutBlocker: async () => null }));
vi.mock('@/lib/supabase/payments', () => ({ markStagePaid: h.markPaid }));
vi.mock('@/components/admin/ledger/LedgerModal', () => ({ LedgerModal: 'mock-ledger' }));
vi.mock('@/components/admin/stages/RecordVerificationModal', () => ({ RecordVerificationModal: 'mock-record' }));
vi.mock('@/components/admin/stages/ReworkModal', () => ({ ReworkModal: 'mock-rework' }));
vi.mock('@/components/ui/ConfirmModal', () => ({ ConfirmModal: 'mock-confirm' }));
vi.mock('./../../components/admin/workspace/EvidenceList', () => ({ EvidenceList: 'mock-evidence' }));
vi.mock('@/components/admin/workspace/EvidenceList', () => ({ EvidenceList: 'mock-evidence' }));
import { StagesTab } from '@/components/admin/workspace/StagesTab';

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
let stageId: string | null = 's2';
const onChanged = vi.fn();
function loaded() { return { workspace: assembleWorkspace(raw(rawOver), now), errors: {} }; }
let LOADED = loaded();
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: StagesTab, props: { loaded: LOADED, stageId, onChanged }, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }
const button = (view: Node[], label: string) => view.find(n => n.type === 'button' && text(n.props.children).includes(label));

beforeEach(() => {
  h.store = new Map(); rawOver = {}; stageId = 's2'; LOADED = loaded(); onChanged.mockReset();
  for (const f of [h.request, h.record, h.approve, h.rework, h.markPaid]) f.mockReset().mockResolvedValue(undefined);
});

describe('the Stages tab, redesigned', () => {
  it('the ladder card shows progress and each stage selects within the Stages tab', async () => {
    const view = await settle();
    const strings = view.map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain('1 of 4 complete');
    const ladder = view.filter(n => n.type === 'a' && String(n.props.to).includes('tab=stages&stage='));
    expect(ladder.map(l => l.props.to)).toEqual(['s1', 's2', 's3', 's4'].map(id => `/admin/projects/p1?tab=stages&stage=${id}`));
  });

  it('the six-step rail runs Work, Evidence, Verification, Approval, Funding, Release', async () => {
    const view = await settle();
    const rail = view.find(n => n.type === 'ol' && String(n.props.className).includes('sm:grid-cols-6'))!;
    const titles = expand(rail.props.children, 'r').filter(n => n.type === 'p' && String(n.props.className).includes('font-semibold')).map(n => text(n.props.children));
    expect(titles).toEqual([L('admin.workspace.stages.work'), L('admin.workspace.stage.evidence'), L('admin.workspace.stages.verification'),
      L('admin.workspace.stages.approval'), L('admin.workspace.stage.tranche'), L('admin.workspace.stage.release')]);
  });

  it('Next action names the open verification and its button opens the record dialog', async () => {
    let view = await settle();
    const strings = view.map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain('Vanessa Gwanvoma has an open verification on this stage');
    button(view, L('admin.verification.recordDecision'))!.props.onClick();
    view = render();
    expect(view.find(n => n.type === 'mock-record')?.props.open).toBe(true);
    await view.find(n => n.type === 'mock-record')!.props.onConfirm({ decision: 'verified', findings: '', reason: 'phone call', visited: true });
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ decision: 'verified', reason: 'phone call', onBehalfOf: 'ver' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('a held act is a locked line with its reason, not a silent disabled button', async () => {
    const view = await settle();
    expect(button(view, L('admin.workspace.stages.approve'))).toBeUndefined();
    const lines = view.filter(n => n.type === 'p' && String(n.props.className).includes('border-dashed')).map(n => text(n.props.children));
    expect(lines.some(l => l.startsWith(L('admin.workspace.stages.approve')))).toBe(true);
  });

  it('Request changes opens the dialog and sends the reason', async () => {
    let view = await settle();
    button(view, L('admin.requestChanges'))!.props.onClick(); view = render();
    const rework = view.find(n => n.type === 'mock-rework')!;
    expect(rework.props.open).toBe(true);
    rework.props.onConfirm('Lintel not level'); await flush();
    expect(h.rework).toHaveBeenCalledWith('p1', 's2', 2, 'admin', 'Lintel not level');
  });

  it('Open in Overview keeps the stage', async () => {
    const view = await settle();
    expect(view.filter(n => n.type === 'a').map(n => n.props.to)).toContain('/admin/projects/p1?stage=s2');
  });

  it('a stage paid in parts lists every part and links to Financials', async () => {
    const pays = [
      pay({ direction: 'in', state: 'funded', amount: 5000, stageId: 's1' }),
      { ...pay({ direction: 'in', state: 'funded', amount: 2000, stageId: 's2' }), id: 'part1', createdAt: '2026-08-20T00:00:00Z' },
      { ...pay({ direction: 'in', state: 'expected', amount: 3000, stageId: 's2' }), id: 'part2', createdAt: '2026-08-21T00:00:00Z' },
    ];
    rawOver = { payments: { rows: pays, available: true } }; LOADED = loaded();
    const view = await settle();
    const lines = view.filter(n => n.type === 'span').map(n => text(n.props.children));
    expect(lines.some(l => l.startsWith('Part 1 · $2,000'))).toBe(true);
    expect(lines.some(l => l.startsWith('Part 2 · $3,000'))).toBe(true);
    expect(view.filter(n => n.type === 'a').map(n => n.props.to)).toContain('/admin/projects/p1?tab=financials');
  });

  it('the new strings exist in both languages', () => {
    for (const k of ['complete', 'openOverview', 'nextAction', 'next.record_verification', 'rail.approvalLocked', 'part', 'openFinancials']) {
      expect(lookup(fr as never, `admin.workspace.stagesView.${k}`), k).not.toBe(L(`admin.workspace.stagesView.${k}`));
    }
  });
});
