import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectTeamAccess } from '@/lib/supabase/project-team';

const h = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], si: 0, ri: 0, request: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = initial;
    return [h.state[i], (value: any) => { h.state[i] = typeof value === 'function' ? value(h.state[i]) : value; }]; },
  useRef: (initial: any) => h.refs[h.ri++] ?? (h.refs[h.ri - 1] = { current: initial }),
  useEffect: () => {},
}));
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/supabase/support', () => ({ requestProjectContractor: h.request }));
import { ProjectContractorConnection } from '@/components/project/ProjectContractorConnection';

const access: ProjectTeamAccess = { primaryClient: true, primaryContractor: false, canInvite: true, canEditBoq: true,
  assignedContractor: false, canInviteClient: false, canInviteContractor: true, hasClientInvitation: false,
  hasContractor: false, hasPendingContractor: false, hasPrimaryContractor: false, contractorRequestStatus: null,
  canChangeRoles: false, needsPrimaryReview: false };
type Node = { type: any; props: any };
const nodes = (value: any): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
const text = (value: any): string => Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : '';
function render(overrides: Partial<ProjectTeamAccess> = {}, projectId = 'home') {
  h.si = h.ri = 0;
  const tree = ProjectContractorConnection({ projectId, access: { ...access, ...overrides }, onRequested: h.refresh });
  return { tree, all: nodes(tree), text: text(tree) };
}
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.request.mockResolvedValue({ id: 'ticket', status: 'open' }); h.refresh.mockResolvedValue(undefined); });
afterEach(() => vi.restoreAllMocks());

describe('a client connects the payee before receiving a payment request', () => {
  it('offers the exact project contractor invitation and a real Jalla request', async () => {
    const view = render();
    expect(view.all.find(node => node.type === 'a')?.props.to).toBe('/projects/home?tab=team&invite=contractor');
    expect(view.text).toContain('project.contractorConnection.find');
    await view.all.find(node => node.type === 'button')!.props.onClick();
    expect(h.request).toHaveBeenCalledWith('home');
    expect(render().text).toContain('project.contractorConnection.requested');
    expect(h.refresh).toHaveBeenCalledOnce();
  });
  it('keeps a pending invitation visible without asking for payment', () => {
    const view = render({ hasPendingContractor: true });
    expect(view.text).toContain('project.contractorConnection.pending');
    expect(view.text).toContain('project.contractorConnection.viewInvitation');
    expect(view.text).not.toContain('receiptChoose');
  });
  it.each(['open', 'in_progress'] as const)('shows a saved %s request after reloading instead of duplicating it', contractorRequestStatus => {
    const view = render({ contractorRequestStatus });
    expect(view.text).toContain('project.contractorConnection.requested');
    expect(view.all.filter(node => node.type === 'button')).toHaveLength(0);
  });
  it.each([{ primaryClient: false }, { hasPrimaryContractor: true }])('offers no connection mutations when they do not apply (%j)', changes => {
    expect(render(changes).tree).toBeNull(); expect(h.request).not.toHaveBeenCalled();
  });
  it('retains a saved request when its follow-up screen refresh fails', async () => {
    h.refresh.mockRejectedValue(new Error('offline'));
    render().all.find(node => node.type === 'button')!.props.onClick();
    await Promise.resolve(); await Promise.resolve();
    expect(render().text).toContain('project.contractorConnection.requested');
    expect(render().text).not.toContain('project.contractorConnection.failed');
  });
  it('reports a failed save and allows retry without claiming Jalla received it', async () => {
    h.request.mockRejectedValue(new Error('offline'));
    render().all.find(node => node.type === 'button')!.props.onClick();
    await Promise.resolve(); await Promise.resolve();
    expect(render().text).toContain('project.contractorConnection.failed');
    expect(render().text).not.toContain('project.contractorConnection.requested');
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it('deduplicates fast clicks and ignores an earlier request after switching projects', async () => {
    let finish!: (value: any) => void;
    h.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const click = render().all.find(node => node.type === 'button')!.props.onClick;
    click(); click(); expect(h.request).toHaveBeenCalledOnce();
    expect(render().all.find(node => node.type === 'button')?.props.disabled).toBe(true);
    render({}, 'other-home'); finish({ id: 'ticket', status: 'open' });
    await Promise.resolve(); await Promise.resolve();
    expect(render({}, 'other-home').text).not.toContain('project.contractorConnection.requested');
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
