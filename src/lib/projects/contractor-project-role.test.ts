import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ index: 0, state: [] as any[], access: null as any, error: false, refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const index = h.index++; return [index in h.state ? h.state[index] : initial, vi.fn()]; },
  useEffect: vi.fn(), useCallback: (callback: any) => callback, useMemo: (factory: () => any) => factory(),
}));
vi.mock('react-router', () => ({ Link: 'link', Navigate: 'navigate',
  useParams: () => ({ projectId: 'project' }), useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'contractor-account', user_metadata: { role: 'contractor' } } }) }));
vi.mock('@/hooks/useProjectTeamAccess', () => ({ useProjectTeamAccess: () => ({ access: h.access, error: h.error, refresh: h.refresh }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: String, substageLabel: String }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/project/ShareProject', () => ({ ShareProject: 'share-project' }));
vi.mock('@/components/project/StagePaymentGate', () => ({ StagePaymentGate: 'stage-payment-gate' }));
vi.mock('@/components/project/ProjectConversations', () => ({ ProjectConversations: 'conversation' }));
vi.mock('@/components/project/ProjectDocuments', () => ({ ProjectDocuments: 'documents' }));
vi.mock('@/components/project/ProjectPayoutSummary', () => ({ ProjectPayoutSummary: 'payout-summary' }));
import ContractorProjectDetail from '@/app/routes/work/projects.detail';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return value?.props ? [value, ...nodes(value.props.children)] : [];
}
function render() { h.index = 0; return nodes(ContractorProjectDetail()); }
beforeEach(() => {
  vi.clearAllMocks(); h.access = { assignedContractor: true, primaryContractor: true }; h.error = false;
  h.state = [{ project: { id: 'project', name: 'Home', user_id: 'client', country: 'CM', budget_source: 'boq' },
    stages: [], activeStage: null, completedStages: 0, totalStages: 0 }, [], [], [], null, new Map(), 'work'];
});
describe('the contractor work page requires an actual project assignment', () => {
  it('routes an observer contractor account to the read-only project view', () => {
    h.access = { assignedContractor: false, primaryContractor: false };
    expect(render()).toEqual([expect.objectContaining({ type: 'navigate', props: { to: '/projects/project', replace: true } })]);
  });
  it('keeps controls hidden while project permissions load', () => {
    h.access = null;
    expect(render().some(node => node.type?.name === 'WorkTab')).toBe(false);
  });
  it('offers retry on a role read failure without exposing work controls', () => {
    h.access = null; h.error = true; const elements = render();
    expect(elements.some(node => node.props.role === 'alert')).toBe(true);
    expect(elements.some(node => node.type?.name === 'WorkTab')).toBe(false);
    elements.find(node => node.type === 'button')!.props.onClick(); expect(h.refresh).toHaveBeenCalledOnce();
  });
  it.each([true, false])('preserves accepted primary and staff-assigned secondary work access (primary=%s)', primary => {
    h.access = { assignedContractor: true, primaryContractor: primary };
    const elements = render();
    expect(elements.some(node => node.type === 'navigate')).toBe(false);
    expect(elements.some(node => node.type?.name === 'WorkTab')).toBe(true);
  });
});
