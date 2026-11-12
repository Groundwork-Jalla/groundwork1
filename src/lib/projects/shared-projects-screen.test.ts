import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ hooks: [] as any[], index: 0, effects: [] as (() => void)[],
  projects: vi.fn(), user: { id: 'contractor' }, refresh: null as null | (() => void) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const at = h.index++; if (!(at in h.hooks)) h.hooks[at] = typeof initial === 'function' ? initial() : initial;
    return [h.hooks[at], (value: any) => { h.hooks[at] = typeof value === 'function' ? value(h.hooks[at]) : value; }]; },
  useEffect: (effect: () => any, deps: any[]) => { const at = h.index++, old = h.hooks[at];
    if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) h.effects.push(() => { old?.cleanup?.(); h.hooks[at] = { deps, cleanup: effect() }; }); },
}));
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user, isContractor: true }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/supabase/projects', () => ({ fetchClientProjects: h.projects }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  channel: () => ({ on(_event: any, _filter: any, refresh: () => void) { h.refresh = refresh; return this; }, subscribe() { return this; } }), removeChannel: vi.fn(),
} }));
import { SharedProjects } from '@/components/contractor/SharedProjects';
function nodes(value: any): any[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function render(assignedIds: string[] = []) {
  h.index = 0; h.effects = []; const tree = SharedProjects({ assignedIds }); for (const effect of h.effects) effect(); return nodes(tree);
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const row = (id: string, status = 'active') => ({ id, name: id, status });
beforeEach(() => {
  h.hooks = []; h.index = 0; h.effects = []; h.user = { id: 'contractor' }; h.refresh = null;
  h.projects.mockReset().mockResolvedValue({ shared: [row('shared'), row('assigned'), row('archived', 'archived')] });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { for (const hook of h.hooks) hook?.cleanup?.(); vi.unstubAllGlobals(); });
describe('shared projects in the contractor workspace', () => {
  it('finds observer memberships on every sign-in and links to the participant view', async () => {
    render(); await flush(); const view = render(['assigned']);
    expect(h.projects).toHaveBeenCalledWith('contractor');
    expect(view.filter(node => node.type === 'a').map(node => node.props.to)).toEqual(['/projects/shared']);
    expect(view.some(node => node.type === 'button')).toBe(false);
  });
  it('refreshes on membership changes and removes revoked memberships', async () => {
    render(); await flush(); expect(render().some(node => node.props.to === '/projects/shared')).toBe(true);
    h.projects.mockResolvedValue({ shared: [] }); h.refresh?.(); await flush();
    expect(render().filter(node => node.type === 'a')).toEqual([]);
  });
  it('does not show a previous account’s projects or apply an old request after account switching', async () => {
    let finish!: (rows: any) => void; h.projects.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(); h.user = { id: 'different-contractor' }; h.projects.mockResolvedValue({ shared: [row('new')] }); render(); await flush();
    finish({ shared: [row('old')] }); await flush();
    expect(render().filter(node => node.type === 'a').map(node => node.props.to)).toEqual(['/projects/new']);
  });
  it('offers retry when the membership list fails', async () => {
    h.projects.mockRejectedValueOnce(new Error('offline')); render(); await flush();
    const view = render(); expect(view.some(node => node.props.role === 'alert')).toBe(true);
    view.find(node => node.type === 'button').props.onClick(); render(); await flush();
    expect(render().some(node => node.props.to === '/projects/shared')).toBe(true);
  });
});
