import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({ rpc: vi.fn(), row: { data: null as unknown, error: null as unknown } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: h.rpc,
  from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => h.row }; return q; } } }));
import { askLaterThisSession, askedLaterThisSession, contactPermissionNext, contactPermissionOf, fetchContactPermission, setContactPermission } from './contact-permission';
import { signupMetadata } from './signup-account';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

function memoryStorage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; }
beforeEach(() => { vi.clearAllMocks(); h.row = { data: null, error: null }; vi.stubGlobal('sessionStorage', memoryStorage()); });
afterEach(() => vi.unstubAllGlobals());

describe('the answer a signup form carries', () => {
  it('rides in the signup metadata as given, ticked or not', () => {
    expect(signupMetadata('Ada', '+237670000000', null, true)).toEqual({ full_name: 'Ada', phone: '+237670000000', contact_permission: true });
    expect(signupMetadata('Ada', null, 'contractor', false)).toEqual({ full_name: 'Ada', signup_intent: 'contractor', contact_permission: false });
  });
  it('is left out when the form did not ask, so "not asked" is never stored as a no', () => {
    expect(signupMetadata('Ada')).toEqual({ full_name: 'Ada' });
    expect(signupMetadata('Ada', null, null, null)).not.toHaveProperty('contact_permission');
  });
  it('is read back only when it is a real yes or no', () => {
    expect(contactPermissionOf(true)).toBe(true); expect(contactPermissionOf(false)).toBe(false);
    for (const odd of [undefined, null, 'true', 1, {}]) expect(contactPermissionOf(odd)).toBeNull();
  });
});

describe('what happens for a signed-in person', () => {
  it.each([
    [true, null, 'done'], [false, true, 'done'], [true, false, 'done'],
    [null, true, 'record_signup'], [null, false, 'record_signup'],
    [null, null, 'ask'],
  ] as const)('recorded %s, signup %s: %s', (recorded, fromSignup, expected) => {
    expect(contactPermissionNext(recorded, fromSignup)).toBe(expected);
  });
});

describe('reading and saving', () => {
  it('tells "never asked" apart from "could not tell"', async () => {
    h.row = { data: { contact_permission: null }, error: null }; expect(await fetchContactPermission('u')).toBeNull();
    h.row = { data: { contact_permission: false }, error: null }; expect(await fetchContactPermission('u')).toBe(false);
    // The column is missing until the migration is applied: never ask on that.
    h.row = { data: null, error: { code: '42703' } }; expect(await fetchContactPermission('u')).toBeUndefined();
    h.row = { data: { full_name: 'x' }, error: null }; expect(await fetchContactPermission('u')).toBeUndefined();
  });
  it('saves through the one database function, with where the answer was given', async () => {
    h.rpc.mockResolvedValue({ data: { contact_permission: true }, error: null });
    expect(await setContactPermission(true, 'sign_in')).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith('set_contact_permission', { p_allowed: true, p_source: 'sign_in' });
    h.rpc.mockResolvedValue({ data: null, error: { message: 'contact_permission_via_rpc' } });
    await expect(setContactPermission(false, 'profile')).rejects.toBeTruthy();
  });
  it('puts the question away for this sign-in only, and per person', () => {
    expect(askedLaterThisSession('a')).toBe(false);
    askLaterThisSession('a');
    expect(askedLaterThisSession('a')).toBe(true); expect(askedLaterThisSession('b')).toBe(false);
  });
});

describe('every place a person meets the question', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  it('is on both signup forms, optional and unticked', () => {
    for (const form of ['src/app/routes/auth/signup.tsx', 'src/components/auth/RoleSignup.tsx']) {
      const source = read(form);
      expect(source).toContain('<ContactPermissionCheckbox checked={contactAllowed}');
      expect(source).toMatch(/useState\(false\)/);
      expect(source).toMatch(/signupMetadata\(.*, contactAllowed\)/);
    }
    const box = read('src/components/auth/ContactPermissionCheckbox.tsx');
    expect(box).toContain('type="checkbox"'); expect(box).not.toMatch(/\brequired\b|defaultChecked/);
  });
  it('is asked after sign-in in every signed-in workspace', () => {
    for (const layout of ['src/app/routes/_layout.tsx', 'src/app/routes/work/_layout.tsx', 'src/app/routes/verifiers/_layout.tsx']) expect(read(layout)).toContain('<ContactPermissionPrompt />');
  });
  it('can be changed in every profile', () => {
    for (const page of ['src/app/routes/profile.tsx', 'src/app/routes/work/profile.tsx', 'src/app/routes/verifiers/settings.tsx']) expect(read(page)).toContain('<ContactPermissionSetting />');
  });
  it('is shown to staff where they decide whether to call', () => {
    expect(read('src/components/admin/PersonPreview.tsx')).toContain("t('admin.person.contactPermission')");
  });
  it('has every string in French as well', () => {
    for (const key of Object.keys((en as any).auth.contactPermission)) expect(typeof (fr as any).auth.contactPermission[key], key).toBe('string');
    for (const key of ['contactPermission', 'contactAllowed', 'contactRefused', 'contactNotAsked']) expect(typeof (fr as any).admin.person[key], key).toBe('string');
  });
});
