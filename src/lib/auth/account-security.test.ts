import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const h = vi.hoisted(() => ({
  factors: [] as { factor_type: string; status: string }[],
  emailMfa: false,
  updateCalls: [] as unknown[],
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      mfa: { listFactors: async () => ({ data: { all: h.factors }, error: null }) },
      updateUser: async (...args: unknown[]) => { h.updateCalls.push(args); return { data: {}, error: null }; },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email_mfa_enabled: h.emailMfa } }) }) }) }),
  },
}));

import { hasPassword, googleWithoutPassword, secondFactorEnabled, requestEmailChange } from './account-security';

const id = (provider: string) => ({ provider } as never);

describe('hasPassword / googleWithoutPassword', () => {
  it('an email sign-up has a password', () => {
    expect(hasPassword({ identities: [id('email')], user_metadata: {} })).toBe(true);
    expect(googleWithoutPassword({ identities: [id('email')], user_metadata: {} })).toBe(false);
  });
  it('a Google-only account has none', () => {
    const u = { identities: [id('google')], user_metadata: {} };
    expect(hasPassword(u)).toBe(false);
    expect(googleWithoutPassword(u)).toBe(true);
  });
  it('a Google account that set one is satisfied by either signal', () => {
    expect(googleWithoutPassword({ identities: [id('google'), id('email')], user_metadata: {} })).toBe(false);
    expect(googleWithoutPassword({ identities: [id('google')], user_metadata: { password_set_at: '2026-09-22T00:00:00Z' } })).toBe(false);
  });
  it('no user, no prompt', () => {
    expect(googleWithoutPassword(null)).toBe(false);
    expect(hasPassword(undefined)).toBe(false);
  });
});

describe('secondFactorEnabled', () => {
  beforeEach(() => { h.factors = []; h.emailMfa = false; });
  it('is false with nothing on', async () => { expect(await secondFactorEnabled('u')).toBe(false); });
  it('counts a verified authenticator', async () => {
    h.factors = [{ factor_type: 'totp', status: 'verified' }];
    expect(await secondFactorEnabled('u')).toBe(true);
  });
  it('does not count an abandoned enrolment', async () => {
    h.factors = [{ factor_type: 'totp', status: 'unverified' }];
    expect(await secondFactorEnabled('u')).toBe(false);
  });
  it('counts the email code', async () => {
    h.emailMfa = true;
    expect(await secondFactorEnabled('u')).toBe(true);
  });
});

describe('requestEmailChange', () => {
  beforeEach(() => { h.updateCalls = []; (globalThis as any).window = { location: { origin: 'https://app.example.test' } }; });
  it('refuses a malformed address before calling Supabase', async () => {
    await expect(requestEmailChange('nope')).rejects.toThrow('invalid_email');
    expect(h.updateCalls).toEqual([]);
  });
  it('asks Supabase to change the email, normalised, with the callback as the landing page', async () => {
    await requestEmailChange('  New@Example.CM ');
    expect(h.updateCalls).toEqual([[
      { email: 'new@example.cm' },
      { emailRedirectTo: 'https://app.example.test/auth/callback?flow=email_change' },
    ]]);
  });
});

describe('the flows are wired', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

  it('the sign-in callback sends a Google account without a password to add one', () => {
    const src = read('src/app/routes/auth/callback.tsx');
    expect(src).toMatch(/googleWithoutPassword\(session\.user\)/);
    expect(src).toMatch(/new-password\?reason=google/);
    // After the forced change for provisioned accounts, which is not optional.
    expect(src.indexOf('mustChangePassword(')).toBeLessThan(src.indexOf('googleWithoutPassword('));
  });

  it('the password page stamps the marker only when adding, and offers Not now', () => {
    const src = read('src/app/routes/auth/new-password.tsx');
    expect(src).toMatch(/if \(addingPassword\)[\s\S]*PASSWORD_SET_MARKER/);
    expect(src).toMatch(/dismissPasswordPrompt\(/);
  });

  it('the dashboard shows the warnings and the Account tab is deep-linkable', () => {
    expect(read('src/app/routes/dashboard.tsx')).toMatch(/<SecurityNudges user=\{user\} \/>/);
    expect(read('src/components/dashboard/SecurityNudges.tsx')).toMatch(/to="\/profile\?tab=account"/);
    expect(read('src/app/routes/profile.tsx')).toMatch(/searchParams\.get\('tab'\)/);
  });

  it('the Account tab edits the email through the confirmed-link path, not a plain save', () => {
    const src = read('src/app/routes/profile.tsx');
    expect(src).toMatch(/requestEmailChange\(/);
    expect(src).not.toMatch(/updateUser\(\{\s*email/);
    expect(src).not.toMatch(/emailComingSoon/);
  });
});
