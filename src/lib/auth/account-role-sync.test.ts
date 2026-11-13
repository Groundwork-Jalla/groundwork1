import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], memos: [] as any[], deps: [] as any[], cleanups: [] as any[],
  effects: [] as { index: number; effect: () => any }[], si: 0, ri: 0, mi: 0, ei: 0,
  read: vi.fn(), refreshSession: vi.fn(), removeChannel: vi.fn(), listeners: [] as { table: string; callback: () => void }[],
  auth: {} as any, location: { pathname: '/dashboard', search: '',hash:'' }, navigate: vi.fn(), save: vi.fn(), saved: vi.fn(), close: vi.fn(),
  projectAccess: vi.fn(), onboarding: vi.fn(), passwordGate:vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = typeof initial === 'function' ? initial() : initial;
    return [h.state[i], (next: any) => { h.state[i] = typeof next === 'function' ? next(h.state[i]) : next; }]; },
  useRef: (initial: any) => h.refs[h.ri++] ?? (h.refs[h.ri - 1] = { current: initial }),
  useCallback: (callback: any, deps: any[]) => { const i = h.mi++; if (!h.memos[i] || deps.some((value, key) => !Object.is(value, h.memos[i].deps[key]))) h.memos[i] = { callback, deps }; return h.memos[i].callback; },
  useEffect: (effect: () => any, deps: any[]) => { const i = h.ei++; if (!h.deps[i] || deps.some((value, key) => !Object.is(value, h.deps[i][key]))) { h.deps[i] = deps; h.effects.push({ index: i, effect }); } },
  useId: () => 'role-editor',
}));
vi.mock('@/lib/auth/account-access', () => ({ readAccountAccess: h.read }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { refreshSession: h.refreshSession }, removeChannel: h.removeChannel,
  channel: () => { const channel = { on: (_: any, filter: any, callback: () => void) => { h.listeners.push({ table: filter.table, callback }); return channel; }, subscribe: () => channel }; return channel; } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('react-router', () => ({ useLocation: () => h.location, useNavigate: () => h.navigate, Outlet: 'outlet' }));
vi.mock('@/lib/supabase/admin-users', () => ({ setUserRole: h.save }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/supabase/project-team', () => ({ fetchProjectTeamAccess: h.projectAccess }));
vi.mock('@/lib/supabase/contractor-onboarding', () => ({ onboardingAvailable: h.onboarding, fetchOnboardingStatus: vi.fn() }));
vi.mock('@/lib/auth/provisioned',()=>({mustChangePassword:h.passwordGate,FORCED_PASSWORD_PATH:'/auth/new-password?reason=provisioned'}));
vi.mock('@/components/shell/AppShell', () => ({ AppShell: 'app-shell' }));
vi.mock('@/components/shell/WorkShell', () => ({ WorkShell: 'work-shell' }));
vi.mock('@/components/verifier/VerifierShell', () => ({ VerifierShell: 'verifier-shell' }));
vi.mock('@/components/ui/NotificationBell', () => ({ NotificationBell: 'notification-bell' }));
vi.mock('@/components/tour/RoleTour', () => ({ RoleTour: 'role-tour' }));
import WorkLayout from '@/app/routes/work/_layout';
import ProtectedLayout from '@/app/routes/_layout';
import { useAccountAccess } from '@/hooks/useAccountAccess';
import { AccountRoleSync } from '@/components/auth/AccountRoleSync';
import { UserRoleEditor } from '@/components/admin/UserRoleEditor';
import { ACCOUNT_ROLE_CHANGED } from './account-role';

function render<T>(component: () => T): T {
  h.si = h.ri = h.mi = h.ei = 0;
  const value = component();
  for (const { index, effect } of h.effects.splice(0)) { h.cleanups[index]?.(); h.cleanups[index] = effect(); }
  return value;
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const access = (role: string, userId = 'user') => ({ ok: true, access: { userId, role, roles: role === 'client' ? 'homeowner' : role,
  isAdmin: role === 'admin', isVerifier: role === 'verifier', isContractor: role === 'contractor' } });
function nodes(value: any): any[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'string' ? value : value?.props ? text(value.props.children) : ''; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); h.state = []; h.refs = []; h.memos = []; h.deps = []; h.cleanups = []; h.effects = []; h.listeners = [];
  const windowEvents = new EventTarget(); const documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', windowEvents); vi.stubGlobal('document', documentEvents);
  h.read.mockResolvedValue(access('client')); h.refreshSession.mockResolvedValue({}); h.removeChannel.mockResolvedValue(undefined);
  h.auth = { user: { id: 'user' }, accountRole: 'client', loading: false, rolesChecked: true };
  h.location.pathname = '/dashboard'; h.location.search='';h.location.hash='';h.save.mockResolvedValue('contractor');h.passwordGate.mockResolvedValue(false);
  h.projectAccess.mockResolvedValue({ assignedContractor: true }); h.onboarding.mockResolvedValue(false);
});
afterEach(() => { h.cleanups.forEach(cleanup => cleanup?.()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('live role synchronization', () => {
  it('refreshes a signed-in user after a realtime role change, with no sign-out', async () => {
    const component = () => useAccountAccess('user', false, 'token');
    render(component); await flush(); expect(render(component).access?.role).toBe('client');
    h.read.mockResolvedValue(access('contractor'));
    h.listeners.find(listener => listener.table === 'user_roles')!.callback();
    expect(render(component).checked).toBe(false);
    await vi.advanceTimersByTimeAsync(50); await flush();
    expect(render(component)).toMatchObject({ checked: true, access: { role: 'contractor' } });
    expect(h.refreshSession).toHaveBeenCalledOnce();
  });
  it('uses polling and focus recovery when a realtime event is missed', async () => {
    const component = () => useAccountAccess('user', false);
    render(component); await flush(); render(component);
    h.read.mockResolvedValue(access('verifier'));
    await vi.advanceTimersByTimeAsync(15_000); await flush(); expect(render(component).access?.role).toBe('verifier');
    h.read.mockResolvedValue(access('admin')); window.dispatchEvent(new Event('focus')); await flush();
    expect(render(component).access?.role).toBe('admin');
  });
  it('stays unresolved on failed reads and recovers without guessing client', async () => {
    h.read.mockResolvedValue({ ok: false, error: 'offline' });
    const component = () => useAccountAccess('user', false);
    render(component); await vi.advanceTimersByTimeAsync(2800);
    expect(render(component)).toMatchObject({ checked: false, access: null });
    h.read.mockResolvedValue(access('contractor')); window.dispatchEvent(new Event('focus')); await flush();
    expect(render(component).access?.role).toBe('contractor');
  });
  it('ignores an older account’s role response after switching users', async () => {
    let finish!: (value: any) => void;
    h.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    let id = 'old'; const component = () => useAccountAccess(id, false);
    render(component); id = 'new'; h.read.mockResolvedValue(access('verifier', 'new')); render(component); await flush();
    finish(access('admin', 'old')); await flush();
    expect(render(component).access).toMatchObject({ userId: 'new', role: 'verifier' });
  });
  it('ignores a stale earlier refresh for the same account', async () => {
    const component = () => useAccountAccess('user', false);
    render(component); await flush(); const current = render(component);
    let finish!: (value: any) => void;
    h.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const old = current.refresh();
    h.read.mockResolvedValue(access('admin')); window.dispatchEvent(new Event('focus')); await flush();
    finish(access('client')); await old; expect(render(component).access?.role).toBe('admin');
  });
  it('refreshes self-edits immediately and removes subscriptions on unmount', async () => {
    const component = () => useAccountAccess('user', false);
    render(component); await flush(); render(component); h.read.mockResolvedValue(access('verifier'));
    window.dispatchEvent(new CustomEvent(ACCOUNT_ROLE_CHANGED, { detail: { userId: 'user' } }));
    await vi.advanceTimersByTimeAsync(50); await flush(); expect(render(component).access?.role).toBe('verifier');
    h.cleanups.forEach(cleanup => cleanup?.()); h.cleanups = [];
    const count = h.read.mock.calls.length; window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(15_000);
    expect(h.read).toHaveBeenCalledTimes(count); expect(h.removeChannel).toHaveBeenCalled();
  });
});

describe('the dashboard follows the current role', () => {
  it('moves through all four dashboards when an admin changes the active role', () => {
    h.location.pathname = '/projects/project'; render(AccountRoleSync); expect(h.navigate).not.toHaveBeenCalled();
    for (const [role, path] of [['contractor', '/work'], ['verifier', '/verifiers'], ['admin', '/admin'], ['client', '/dashboard']]) {
      h.auth.accountRole = role; render(AccountRoleSync); expect(h.navigate).toHaveBeenLastCalledWith(path, { replace: true });
    }
  });
  it('preserves an initial project deep link but corrects a wrong dashboard bookmark', () => {
    h.location.pathname = '/work/projects/assigned'; render(AccountRoleSync); expect(h.navigate).not.toHaveBeenCalled();
    h.auth.accountRole = 'admin'; h.location.pathname = '/dashboard'; render(AccountRoleSync);
    expect(h.navigate).toHaveBeenLastCalledWith('/admin', { replace: true });
  });
  it('does not redirect while the role remains unknown', () => {
    h.auth.rolesChecked = false; h.auth.accountRole = null; render(AccountRoleSync); expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe('four-role editor', () => {
  const user: any = { id: 'user', email: 'user@example.test', roles: 'homeowner' };
  const component = () => UserRoleEditor({ user, onSaved: h.saved, onClose: h.close });
  it('offers each requested role and saves the complete expected role snapshot', async () => {
    expect(nodes(render(component)).filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['client', 'contractor', 'verifier', 'admin']);
    nodes(render(component)).find(node => node.type === 'select')!.props.onChange({ target: { value: 'contractor' } });
    const submit = nodes(render(component)).find(node => node.type === 'form')!.props.onSubmit;
    submit({ preventDefault() {} }); submit({ preventDefault() {} }); await flush();
    expect(h.save).toHaveBeenCalledOnce(); expect(h.save).toHaveBeenCalledWith('user', 'contractor', 'homeowner');
    expect(h.saved).toHaveBeenCalledWith('contractor');
  });
  it('shows the last-admin refusal without claiming a role changed', async () => {
    h.save.mockRejectedValue({ message: 'last_admin' });
    nodes(render(component)).find(node => node.type === 'select')!.props.onChange({ target: { value: 'admin' } });
    nodes(render(component)).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} }); await flush();
    expect(text(render(component))).toContain('admin.roleEdit.lastAdmin'); expect(h.saved).not.toHaveBeenCalled();
  });
});

describe('project responsibilities after an account correction', () => {
  beforeEach(() => {
    h.auth.session = { access_token: 'token' }; h.auth.isContractor = false;
    h.location.pathname = '/work/projects/assigned';
  });
  it.each(['client', 'verifier', 'admin'])('keeps the assigned project accessible under the current %s account shell', async role => {
    h.auth.accountRole = role;
    render(WorkLayout); await flush(); render(WorkLayout);
    expect(render(WorkLayout).type).toBe(role === 'verifier' ? 'verifier-shell' : 'app-shell');
    expect(h.projectAccess).toHaveBeenCalledWith('assigned');
    expect(h.onboarding).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled();
  });
  it('denies an unassigned project even when that account previously was a contractor', async () => {
    h.projectAccess.mockResolvedValue({ assignedContractor: false });
    render(WorkLayout); await flush(); render(WorkLayout);
    expect(h.navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });
  it('keeps an unavailable membership check unresolved and allows a retry', async () => {
    h.projectAccess.mockRejectedValueOnce(new Error('offline'));
    render(WorkLayout); await flush(); const failed = render(WorkLayout);
    expect(text(failed)).toContain('teamAccess.loadFailed'); expect(h.navigate).not.toHaveBeenCalled();
    nodes(failed).find(node => node.type === 'button')!.props.onClick();
    render(WorkLayout); await flush(); render(WorkLayout);
    expect(render(WorkLayout).type).toBe('app-shell'); expect(h.navigate).not.toHaveBeenCalled();
  });
  it('does not apply a previous project’s delayed access response', async () => {
    let finish!: (value: any) => void;
    h.projectAccess.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(WorkLayout); h.location.pathname = '/work/projects/other'; render(WorkLayout); await flush(); render(WorkLayout);
    finish({ assignedContractor: false }); await flush();
    expect(render(WorkLayout).type).toBe('app-shell'); expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe('a client or observer project uses the current account workspace',()=>{
  it.each(['client','contractor','verifier','admin'])('keeps the %s navigation while opening an existing project responsibility',async role=>{
    h.auth.accountRole=role;h.auth.session={user:{id:'user'},access_token:'token'};
    h.location.pathname='/projects/existing';
    render(ProtectedLayout);await flush();
    const page=render(ProtectedLayout);
    expect(page.type).toBe(role==='contractor'?'work-shell':role==='verifier'?'verifier-shell':'app-shell');
    if(role==='admin')expect(page.props.nav.some((item:any)=>item.to==='/admin/projects')).toBe(true);
    expect(h.navigate).not.toHaveBeenCalled();
  });
  it.each([ProtectedLayout,WorkLayout])('keeps the requested project/tab when authentication is needed',Layout=>{
    h.auth.session=null;h.location.pathname=Layout===WorkLayout?'/work/projects/p':'/projects/p';h.location.search='?tab=team';h.location.hash='#members';
    render(Layout);
    expect(h.navigate).toHaveBeenCalledWith('/auth/login?redirect='+encodeURIComponent(h.location.pathname+h.location.search+h.location.hash),{replace:true});
  });
});
