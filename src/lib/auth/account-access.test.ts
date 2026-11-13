import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
import { readAccountAccess } from './account-access';
import { ACCOUNT_ROLES, accountRoleOf, dashboardForRole, roleAssignmentMatches } from './account-role';
import { setUserRole } from '@/lib/supabase/admin-users';

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('window', { dispatchEvent: h.dispatch }); });
afterEach(() => vi.unstubAllGlobals());

describe('canonical account role snapshots', () => {
  it.each(ACCOUNT_ROLES)('reads %s from one authenticated snapshot', async role => {
    h.rpc.mockResolvedValue({ data: { user_id: 'user', role, roles: role === 'client' ? 'homeowner' : role,
      is_admin: role === 'admin', is_verifier: role === 'verifier', is_contractor: role === 'contractor' } });
    expect(await readAccountAccess('user')).toMatchObject({ ok: true, access: { role } });
    expect(h.rpc).toHaveBeenCalledWith('my_account_access');
  });
  it('keeps unknown, failed and mismatched-session reads unresolved', async () => {
    h.rpc.mockResolvedValueOnce({ error: { message: 'offline' } }).mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { user_id: 'someone-else', role: 'admin', roles: 'admin', is_admin: true, is_verifier: false, is_contractor: false } });
    for (let i = 0; i < 3; i++) expect((await readAccountAccess('user')).ok).toBe(false);
  });
  it('rejects mixed or nonboolean flags instead of routing on a guess', async () => {
    h.rpc.mockResolvedValueOnce({ data: { user_id: 'user', role: 'admin', roles: 'admin', is_admin: false, is_verifier: false, is_contractor: false } })
      .mockResolvedValueOnce({ data: { user_id: 'user', role: 'admin', roles: 'admin', is_admin: 'true', is_verifier: false, is_contractor: false } });
    expect((await readAccountAccess('user')).ok).toBe(false); expect((await readAccountAccess('user')).ok).toBe(false);
  });
});

describe('admin role editing boundary', () => {
  it.each(ACCOUNT_ROLES)('saves %s with optimistic concurrency and notifies the current browser', async role => {
    const roles = role === 'client' ? 'homeowner' : role;
    h.rpc.mockResolvedValue({ data: { user_id: 'user', role, roles } });
    expect(await setUserRole('user', role, 'contractor')).toBe(roles);
    expect(h.rpc).toHaveBeenCalledWith('admin_set_user_role', { p_user: 'user', p_role: role, p_expected_roles: 'contractor' });
    expect(h.dispatch.mock.calls[0][0].detail).toEqual({ userId: 'user' });
  });
  it('does not announce a failed or inconsistent role save', async () => {
    h.rpc.mockResolvedValueOnce({ error: new Error('last_admin') }).mockResolvedValueOnce({ data: { user_id: 'user', role: 'client', roles: 'admin' } });
    await expect(setUserRole('user', 'client', 'admin')).rejects.toThrow('last_admin');
    await expect(setUserRole('user', 'client', 'admin')).rejects.toThrow('account_role_update_failed');
    expect(h.dispatch).not.toHaveBeenCalled();
  });
  it('normalizes the selected role while supporting legacy multi-role displays', () => {
    expect(accountRoleOf('contractor,verifier,admin')).toBe('admin');
    expect(roleAssignmentMatches('', 'client')).toBe(false);
    expect(roleAssignmentMatches('homeowner', 'client')).toBe(true);
    expect(roleAssignmentMatches('admin,verifier', 'admin')).toBe(false);
    expect(ACCOUNT_ROLES.map(dashboardForRole)).toEqual(['/dashboard', '/work', '/verifiers', '/admin']);
  });
});
