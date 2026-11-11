import { describe, expect, it } from 'vitest';
import {
  contractorProjectReturn, forgetProjectInvitation, projectAuthCallbackUrl,
  projectInvitationError, projectInvitationPath, readProjectInvitation,
  rememberProjectInvitation, safeAuthReturn, withProjectInvitation,
} from './project-invitation';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('project invitation continuation', () => {
  it.each(['viewer', 'contractor'] as const)('carries a %s invitation through confirmation on another device', kind => {
    const invitation = { kind, token: 'd50dd06c-467e-4225-8c16-eabc9131fb73' };
    const signup = withProjectInvitation('/auth/signup', invitation);
    const callback = projectAuthCallbackUrl('https://groundwork.test', signup.split('?')[1]);
    expect(readProjectInvitation(new URL(callback).search, storage())).toEqual(invitation);
    const password = withProjectInvitation('/auth/new-password?reason=google', invitation);
    expect(readProjectInvitation(new URL(password, 'https://groundwork.test').search, storage())).toEqual(invitation);
    expect(new URL(password, 'https://groundwork.test').searchParams.get('reason')).toBe('google');
  });

  it('uses the explicit invitation instead of another invitation remembered by this browser', () => {
    const store = storage();
    rememberProjectInvitation({ kind: 'viewer', token: 'previous' }, store);
    expect(readProjectInvitation('?invite=current', store)).toEqual({ kind: 'contractor', token: 'current' });
  });

  it('restores the project from an invitation redirect', () => {
    expect(readProjectInvitation('?redirect=%2Fshare%2Fclient-token', storage()))
      .toEqual({ kind: 'viewer', token: 'client-token' });
  });

  it('keeps the URL usable when browser storage is blocked', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const invitation = { kind: 'viewer' as const, token: 'token' };
    expect(() => rememberProjectInvitation(invitation, blocked)).not.toThrow();
    expect(readProjectInvitation('?share=token', blocked)).toEqual(invitation);
    expect(() => forgetProjectInvitation(invitation, blocked)).not.toThrow();
  });

  it('does not clear a newer invitation when an earlier acceptance completes', () => {
    const store = storage();
    const earlier = { kind: 'viewer' as const, token: 'first' };
    rememberProjectInvitation(earlier, store);
    rememberProjectInvitation({ ...earlier, token: 'second' }, store);
    forgetProjectInvitation(earlier, store);
    expect(readProjectInvitation('', store)?.token).toBe('second');
  });

  it('clears both the accepted context and a stale invitation of the other kind', () => {
    const store = storage();
    rememberProjectInvitation({ kind: 'contractor', token: 'contractor-token' }, store);
    const client = { kind: 'viewer' as const, token: 'viewer-token' };
    rememberProjectInvitation(client, store);
    expect(store.getItem('pendingInvite')).toBeNull();
    forgetProjectInvitation(client, store);
    expect(readProjectInvitation('', store)).toBeNull();
  });

  it.each(['https://outside.test', '//outside.test', '/\\outside.test', '/work\n/other'])('rejects unsafe auth return %s', path => {
    expect(safeAuthReturn(path)).toBeNull();
    const callback = new URL(projectAuthCallbackUrl('https://groundwork.test', `?redirect=${encodeURIComponent(path)}`));
    expect(callback.searchParams.has('redirect')).toBe(false);
  });

  it('returns an assigned contractor to the invited project after onboarding', () => {
    expect(contractorProjectReturn('/work/projects/project-1?tab=work')).toBe('/work/projects/project-1?tab=work');
    for (const path of ['/work/onboarding', '/admin', '//outside.test', '/work']) {
      expect(contractorProjectReturn(path)).toBeNull();
    }
  });

  it('provides a retry destination and a specific account mismatch error', () => {
    expect(projectInvitationPath({ kind: 'viewer', token: 'token' })).toBe('/share/token');
    expect(projectInvitationPath({ kind: 'contractor', token: 'token' })).toBe('/invite/token');
    expect(projectInvitationError({ code: 'invite_email_mismatch' })).toBe('invite.emailMismatch');
    expect(projectInvitationError(new Error('invite_email_mismatch: wrong account'))).toBe('invite.emailMismatch');
    expect(projectInvitationError(new Error('network failed'))).toBe('invite.acceptError');
  });
});
