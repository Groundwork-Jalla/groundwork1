import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApproveStageResult } from '@/lib/supabase/verifications';

const h = vi.hoisted(() => ({
  index: 0, refIndex: 0, state: [] as any[], refs: [] as { current: any }[], effects: [] as (() => unknown)[],
  route: { id: 'project' }, approve: vi.fn(), mark: vi.fn(), project: vi.fn(), stages: vi.fn(),
  substages: vi.fn(), payments: vi.fn(), fees: vi.fn(), params: new URLSearchParams('tab=stages'),
  primaryClient: true,
  assignedContractor: false, primaryContractor: false, role: 'client',
  canInviteContractor: true, setParams: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { h.effects.push(effect); },
  useRef: (initial: unknown) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current: initial });
  },
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.state)) h.state[index] = typeof initial === 'function' ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === 'function' ? value(h.state[index]) : value; }];
  },
}));
vi.mock('react-router', () => ({ Link: 'a', useParams: () => h.route, useNavigate: () => vi.fn(),
  useSearchParams: () => [h.params, h.setParams] }));
vi.mock('framer-motion', () => ({ motion: { div: 'div' } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'client' }, accountRole:h.role,isContractor: h.role==='contractor' }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/domain-labels', () => ({ useDomainLabels: () => ({ buildingType: String, country: String, roofType: String }) }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: () => 'Stage', substageLabel: () => 'Update' }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/approvals', () => ({ approveStage: h.approve, markSubstageComplete: h.mark }));
vi.mock('@/lib/supabase/projects', () => ({ fetchProject: h.project, fetchProjectStages: h.stages,
  fetchProjectSubstages: h.substages, fetchProjectFees: h.fees }));
vi.mock('@/lib/supabase/verifications', () => ({ fetchStagePayments: h.payments }));
vi.mock('@/lib/budget', () => ({ projectBudget: () => ({ total: 100 }), formatUSDFull: String }));
vi.mock('@/lib/budget/project-money-context', () => ({ ProjectMoneyProvider: 'money-provider', useMoney: () => String }));
vi.mock('@/components/project/StageTracker', () => ({ StageTracker: 'stage-tracker' }));
vi.mock('@/components/project/EvidenceUpload', () => ({ default: 'evidence-upload' }));
vi.mock('@/components/project/BudgetView', () => ({ default: 'budget-view' }));
vi.mock('@/components/project/ClientDocuments', () => ({ ClientDocuments: 'client-documents' }));
vi.mock('@/components/project/ProjectConversations', () => ({ ProjectConversations: 'conversations' }));
vi.mock('@/components/project/ProjectTeam', () => ({ ProjectTeam: 'project-team' }));
vi.mock('@/hooks/useProjectTeamAccess', () => ({ useProjectTeamAccess: () => ({ access: {
  primaryClient: h.primaryClient, canInviteContractor: h.primaryClient && h.canInviteContractor,
  assignedContractor: h.assignedContractor, primaryContractor:h.primaryContractor,
} }) }));
vi.mock('@/components/project/OverviewTab', () => ({ default: 'overview' }));
vi.mock('@/components/project/TimelineTab', () => ({ default: 'timeline' }));
vi.mock('@/components/project/StartTrackingGate', () => ({ default: 'tracking-gate' }));

import ProjectDetail from '@/app/routes/projects/detail';

type Element = { type: unknown; props: Record<string, any> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}
const project = { id: 'project', user_id: 'client', name: 'Home', country: 'CM', tier: 'jalla_verify',
  tracking_started_at: '2026-11-12', created_at: '2026-11-01', num_floors: 1, sqm: 100,
  bedrooms: 1, bathrooms: 1, status: 'active', current_stage: 4 };
const stages = [
  { id: 'foundation', stage_number: 4, status: 'active', payment_status: 'paid' },
  { id: 'structure', stage_number: 5, status: 'locked', payment_status: 'unpaid' },
];
const progression: ApproveStageResult = { projectId: 'project', stageId: 'foundation', stageNumber: 4,
  nextStageId: 'structure', nextStageNumber: 5, isFinal: false, awaitingPayment: true, verificationId: null };
function render() {
  h.index = 0; h.refIndex = 0; h.effects = [];
  return nodes(ProjectDetail());
}
function tracker() { return render().find(element => element.type === 'stage-tracker')!.props; }
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); }
function tabs() {
  const bar = render().find(element => (element.type as any)?.name === 'TabBar')!;
  return nodes((bar.type as any)(bar.props));
}
beforeEach(() => {
  vi.clearAllMocks(); h.primaryClient = true; h.assignedContractor=false;h.primaryContractor=false;h.role='client'; h.refs = []; h.state = [{ ...project }, stages.map(stage => ({ ...stage })),
    [{ id: 'last-update', stage_id: 'foundation', status: 'pending_review', evidence_urls: ['photo.jpg'] }],
    new Map(), [], false, null];
  h.params = new URLSearchParams('tab=stages'); h.canInviteContractor = true;
  h.setParams.mockImplementation((update: any) => { h.params = typeof update === 'function' ? update(h.params) : new URLSearchParams(update); });
  h.route.id = 'project';
  h.project.mockReturnValue(new Promise(() => {}));
  h.stages.mockResolvedValue(stages); h.substages.mockResolvedValue([]);
  h.payments.mockResolvedValue(new Map()); h.fees.mockResolvedValue([]);
});

describe('project team navigation', () => {
  it.each([['client','/projects'],['contractor','/work/projects'],['verifier','/verifiers#projects'],['admin','/admin/projects']])('Back follows the current %s account instead of the project creator', (role,path)=>{
    h.role=role;
    expect(render().find(node=>node.type==='a'&&node.props.to===path)).toBeDefined();
  });
  it('updates contractor responsibilities immediately after a project-role refresh',()=>{
    h.primaryClient=false;h.assignedContractor=true;h.primaryContractor=true;
    expect(tracker()).toMatchObject({isContractor:true,canConfirmPayments:true,canUploadEvidence:true});
    h.assignedContractor=false;h.primaryContractor=false;
    expect(tracker()).toMatchObject({isContractor:false,canConfirmPayments:false,canUploadEvidence:false,canApprove:false});
  });
  it('opens a link to Team on the same project, including an invited primary client', () => {
    h.state[0].user_id = 'different-creator'; h.params = new URLSearchParams('tab=team');
    expect(render().find(element => element.type === 'project-team')!.props.project.id).toBe('project');
    expect(render().some(element => element.type === 'stage-tracker')).toBe(false);
  });

  it('moves invitation entry points out of Overview and Stages', () => {
    for (const tab of ['overview', 'stages']) {
      h.params = new URLSearchParams({ tab });
      expect(render().some(element => ['project-team', 'contractor-invite', 'share-project'].includes(element.type as string))).toBe(false);
    }
  });

  it('switches to Team from the tab bar while preserving other URL parameters', () => {
    h.params.set('attachment', 'failed');
    tabs().find(element => element.type === 'button' && element.props.children === 'project.tabs.team')!.props.onClick();
    expect(h.params.get('tab')).toBe('team'); expect(h.params.get('attachment')).toBe('failed');
    expect(render().some(element => element.type === 'project-team')).toBe(true);
  });

  it('follows URL changes back to Stages rather than retaining the previous Team selection', () => {
    h.params = new URLSearchParams('tab=team'); render();
    h.params = new URLSearchParams('tab=stages');
    expect(render().some(element => element.type === 'stage-tracker')).toBe(true);
    expect(render().some(element => element.type === 'project-team')).toBe(false);
  });

  it('falls back to Overview for an unknown tab', () => {
    h.params = new URLSearchParams('tab=unknown');
    expect(render().some(element => element.type === 'overview')).toBe(true);
  });

  it('points setup at Team only while the client can invite their initial contractor', () => {
    const cue = () => tabs().find(element => element.props['data-tour'] === 'invite-contractor');
    expect(cue()!.props.children).toBe('project.tabs.team');
    h.canInviteContractor = false; expect(cue()).toBeUndefined();
    h.canInviteContractor = true; h.primaryClient = false; expect(cue()).toBeUndefined();
  });

  it('keeps Team available on the contractor variant of this project page', () => {
    h.primaryClient=false;h.assignedContractor=true;h.primaryContractor=true;
    expect(tabs().some(element => element.props.children === 'project.tabs.team')).toBe(true);
  });
});

describe('the client receives the saved progression without waiting for a refresh', () => {
  it('keeps observers from approving work or receiving approval controls', async () => {
    h.primaryClient = false;
    expect(tracker().canApprove).toBe(false);
    await tracker().onApproveStage('foundation', 4);
    await tracker().onMarkSubstageComplete('last-update');
    expect(h.approve).not.toHaveBeenCalled(); expect(h.mark).not.toHaveBeenCalled();
  });
  it('returns the last-substage result and marks its stage complete while the refresh is pending', async () => {
    h.mark.mockResolvedValue(progression);
    expect(await tracker().onMarkSubstageComplete('last-update')).toEqual(progression);
    const next = tracker();
    expect(next.stages[0].status).toBe('complete');
    expect(next.substages[0].status).toBe('complete');
    expect(h.project).toHaveBeenCalledWith('project');
  });

  it('returns explicit stage approval progression through the same callback', async () => {
    h.approve.mockResolvedValue(progression);
    expect(await tracker().onApproveStage('foundation', 4)).toEqual(progression);
    expect(tracker().stages[0].status).toBe('complete');
  });

  it('keeps all legacy tiers in direct-complete mode for a nonfinal update', async () => {
    h.mark.mockResolvedValue(undefined);
    await tracker().onMarkSubstageComplete('last-update');
    expect(tracker().substages[0].status).toBe('complete');
    expect(tracker().stages[0].status).toBe('active');
  });

  it('does not apply an approval result after navigating to a different project', async () => {
    let finish!: (result: ApproveStageResult) => void;
    h.approve.mockReturnValue(new Promise<ApproveStageResult>(resolve => { finish = resolve; }));
    const pending = tracker().onApproveStage('foundation', 4);
    h.route.id = 'other-project'; h.state[0] = { ...project, id: 'other-project' };
    render(); finish(progression);
    expect(await pending).toBeUndefined();
    expect(h.state[1][0].status).toBe('active');
    expect(h.project).not.toHaveBeenCalled();
  });

  it('retains the saved stage transition and shows retry guidance when refresh fails', async () => {
    h.approve.mockResolvedValue(progression);
    h.project.mockRejectedValue(new Error('offline'));
    expect(await tracker().onApproveStage('foundation', 4)).toEqual(progression);
    await flush();
    const elements = render();
    expect(elements.some(element => element.type === 'stage-tracker')).toBe(true);
    expect(elements.some(element => element.props.role === 'alert')).toBe(true);
    expect(tracker().stages[0].status).toBe('complete');
  });

  it('does not replace the current project with a late refresh of the previous one', async () => {
    let finish!: (value: unknown) => void;
    h.project.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    h.approve.mockResolvedValue(progression);
    await tracker().onApproveStage('foundation', 4);
    h.route.id = 'other-project'; h.state[0] = { ...project, id: 'other-project' };
    render(); finish(project); await flush();
    expect(h.state[0].id).toBe('other-project');
  });

  it('ignores an old realtime refresh without cancelling the new project’s request', async () => {
    const oldRefresh = tracker().onPaymentChanged;
    h.route.id = 'other-project'; h.state[0] = { ...project, id: 'other-project' };
    let finish!: (value: unknown) => void;
    h.project.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const current = tracker().onPaymentChanged();
    await oldRefresh();
    expect(h.project).toHaveBeenCalledTimes(1);
    expect(h.project).toHaveBeenCalledWith('other-project');
    finish({ ...project, id: 'other-project', name: 'Current project' });
    await current;
    expect(h.state[0].name).toBe('Current project');
  });

  it('never visually resumes a paused project from an idempotent approval retry', async () => {
    h.state[0] = { ...project, status: 'on_hold' };
    h.approve.mockResolvedValue({ ...progression, alreadyApproved: true, awaitingPayment: false });
    await tracker().onApproveStage('foundation', 4);
    expect(h.state[0].status).toBe('on_hold');
    expect(tracker().stages[1].status).toBe('locked');
  });
});
