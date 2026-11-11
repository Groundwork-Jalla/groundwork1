import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  actor: 'first-user', state: [] as any[], refs: [] as any[], callbacks: [] as any[], deps: [] as any[], cleanups: [] as any[],
  si: 0, ri: 0, ci: 0, ei: 0, effects: [] as { i: number; effect: () => any }[],
  fetch: vi.fn(), channel: vi.fn(), remove: vi.fn(), changes: [] as (() => void)[],
}));
vi.mock('react', () => ({
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = initial;
    return [h.state[i], (value: any) => { h.state[i] = value; }]; },
  useRef: (initial: any) => h.refs[h.ri++] ?? (h.refs[h.ri - 1] = { current: initial }),
  useCallback: (callback: any, deps: any[]) => { const i = h.ci++; if (!h.callbacks[i] || deps.some((v, k) => v !== h.callbacks[i].deps[k])) h.callbacks[i] = { callback, deps }; return h.callbacks[i].callback; },
  useEffect: (effect: () => any, deps: any[]) => { const i = h.ei++; if (!h.deps[i] || deps.some((v, k) => v !== h.deps[i][k])) { h.deps[i] = deps; h.effects.push({ i, effect }); } },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: h.actor } }) }));
vi.mock('@/lib/supabase/project-team', () => ({ fetchProjectTeamAccess: h.fetch }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { channel: h.channel, removeChannel: h.remove } }));
import { useProjectTeamAccess } from './useProjectTeamAccess';

function render(project = 'project') {
  h.si = h.ri = h.ci = h.ei = 0;
  const result = useProjectTeamAccess(project);
  for (const { i, effect } of h.effects.splice(0)) { h.cleanups[i]?.(); h.cleanups[i] = effect(); }
  return result;
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(() => {
  for (const cleanup of h.cleanups) cleanup?.();
  vi.clearAllMocks(); h.actor = 'first-user'; h.state = []; h.refs = []; h.callbacks = []; h.deps = []; h.cleanups = []; h.effects = []; h.changes = [];
  h.fetch.mockResolvedValue({ canInvite: true });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const channel: any = { on: vi.fn((_event, _filter, callback) => { h.changes.push(callback); return channel; }), subscribe: vi.fn(() => channel) };
  h.channel.mockReturnValue(channel);
});

describe('project role capabilities stay with the current session and project', () => {
  it('starts closed and refreshes accepted/revoked role changes from realtime', async () => {
    expect(render().access).toBeNull(); await flush(); expect(render().access?.canInvite).toBe(true);
    h.fetch.mockResolvedValue({ canInvite: false }); h.changes[0](); await flush();
    expect(render().access?.canInvite).toBe(false);
    expect(h.channel.mock.results[0].value.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ table: 'project_viewers', filter: 'project_id=eq.project' }), expect.any(Function));
  });
  it('clears previously granted permissions if a refresh fails', async () => {
    render(); await flush(); h.fetch.mockRejectedValue(new Error('not_permitted'));
    await render().refresh(); expect(render()).toMatchObject({ access: null, error: true });
  });
  it('never shows the previous account permissions while a new account loads', async () => {
    render(); await flush(); expect(render().access?.canInvite).toBe(true);
    h.actor = 'different-user'; h.fetch.mockReturnValue(new Promise(() => {}));
    expect(render()).toMatchObject({ access: null, scope: 'different-user:project' });
    expect(h.remove).toHaveBeenCalledTimes(1);
  });
  it('ignores a late response from a different project', async () => {
    let finish!: (access: unknown) => void;
    h.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render('old'); h.fetch.mockResolvedValue({ canInvite: false }); render('new'); await flush();
    finish({ canInvite: true }); await flush();
    expect(render('new')).toMatchObject({ access: { canInvite: false }, scope: 'first-user:new' });
  });
  it('keeps the newest response if realtime and a manual refresh overlap', async () => {
    render(); await flush(); let finish!: (access: unknown) => void;
    h.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = render().refresh(); h.fetch.mockResolvedValueOnce({ canInvite: false }); await render().refresh();
    finish({ canInvite: true }); await old;
    expect(render().access?.canInvite).toBe(false);
  });
});
