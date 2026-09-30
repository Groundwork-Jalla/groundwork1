import { beforeEach, describe, expect, it, vi } from 'vitest';
import { holdsContractorAccess } from './roles';
import { postAuthPath } from './post-auth-path';

const db = vi.hoisted(() => ({
  roles: [] as Record<string, string>[],
  assignments: [] as Record<string, string>[],
  errors: new Set<string>(),
  from: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: db.from } }));

beforeEach(() => {
  db.roles = [];
  db.assignments = [];
  db.errors.clear();
  db.from.mockReset().mockImplementation((table: string) => {
    let rows = table === 'user_roles' ? db.roles : db.assignments;
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { rows = rows.filter(row => row[key] === value); return query; },
      limit: (n: number) => Promise.resolve({
        data: db.errors.has(table) ? null : rows.slice(0, n),
        error: db.errors.has(table) ? { message: 'unavailable' } : null,
      }),
    };
    return query;
  });
});

describe('contractor dashboard access', () => {
  it('admits a new contractor with no assignments and skips client onboarding', async () => {
    db.roles = [{ user_id: 'new', role: 'contractor' }];
    const isContractor = await holdsContractorAccess('new');
    expect(isContractor).toBe(true);
    expect(postAuthPath({ isContractor, onboardingComplete: false })).toBe('/work');
  });

  it('retains access for an assigned contractor without a role row', async () => {
    db.assignments = [{ contractor_user_id: 'legacy', status: 'accepted' }];
    expect(await holdsContractorAccess('legacy')).toBe(true);
  });

  it('denies clients, staff-only roles, pending invites, and other users’ assignments', async () => {
    db.roles = [{ user_id: 'staff', role: 'admin' }, { user_id: 'other', role: 'contractor' }];
    db.assignments = [
      { contractor_user_id: 'client', status: 'pending' },
      { contractor_user_id: 'other', status: 'accepted' },
    ];
    expect(await holdsContractorAccess('client')).toBe(false);
    expect(await holdsContractorAccess('staff')).toBe(false);
  });

  it('does not treat a failed role lookup as a grant', async () => {
    db.errors.add('user_roles');
    expect(await holdsContractorAccess('client')).toBe(false);
    db.assignments = [{ contractor_user_id: 'legacy', status: 'accepted' }];
    expect(await holdsContractorAccess('legacy')).toBe(true);
  });

  it('still admits a registered contractor if the assignment lookup fails', async () => {
    db.errors.add('contractor_invites');
    db.roles = [{ user_id: 'new', role: 'contractor' }];
    expect(await holdsContractorAccess('new')).toBe(true);
  });

  it('fails closed when both sources fail', async () => {
    db.errors.add('user_roles');
    db.errors.add('contractor_invites');
    expect(await holdsContractorAccess('new')).toBe(false);
  });

  it('does not query without a session user', async () => {
    expect(await holdsContractorAccess(undefined)).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });
});
