import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const accept = vi.hoisted(() => ({ viewer: vi.fn(), contractor: vi.fn() }));
vi.mock('@/lib/supabase/project-viewers', () => ({ acceptProjectViewer: accept.viewer }));
vi.mock('@/lib/supabase/invites', () => ({ acceptInvite: accept.contractor }));

import { completeProjectInvitation } from './complete-project-invitation';
import { readProjectInvitation, rememberProjectInvitation } from './project-invitation';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  accept.viewer.mockReset().mockResolvedValue('same-project');
  accept.contractor.mockReset().mockResolvedValue('same-project');
});
afterEach(() => vi.unstubAllGlobals());

describe('authenticated membership acceptance', () => {
  it.each([
    ['viewer', '/projects/same-project'],
    ['contractor', '/work/projects/same-project'],
  ] as const)('completes %s membership and returns its role-specific project', async (kind, path) => {
    const invitation = { kind, token: 'token' };
    rememberProjectInvitation(invitation);
    expect(await completeProjectInvitation(invitation)).toBe(path);
    expect(accept[kind]).toHaveBeenCalledWith('token');
    expect(readProjectInvitation()).toBeNull();
  });

  it('retains a failed invitation so login, MFA or password setup can retry it', async () => {
    const invitation = { kind: 'viewer' as const, token: 'token' };
    accept.viewer.mockRejectedValueOnce(new Error('temporary network error'));
    await expect(completeProjectInvitation(invitation)).rejects.toThrow('temporary network error');
    expect(readProjectInvitation()).toEqual(invitation);
    expect(await completeProjectInvitation(invitation)).toBe('/projects/same-project');
    expect(readProjectInvitation()).toBeNull();
  });

  it('does not navigate or clear context when the wrong account attempts acceptance', async () => {
    const invitation = { kind: 'contractor' as const, token: 'token' };
    accept.contractor.mockRejectedValue(new Error('invite_email_mismatch'));
    await expect(completeProjectInvitation(invitation)).rejects.toThrow('invite_email_mismatch');
    expect(readProjectInvitation()).toEqual(invitation);
  });

  it('keeps a newer invitation opened while an earlier request is in flight', async () => {
    let finish!: (project: string) => void;
    accept.viewer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const work = completeProjectInvitation({ kind: 'viewer', token: 'earlier' });
    rememberProjectInvitation({ kind: 'viewer', token: 'later' });
    finish('same-project');
    await work;
    expect(readProjectInvitation()?.token).toBe('later');
  });
});
