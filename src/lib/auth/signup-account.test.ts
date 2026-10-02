import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  signupAccountType, signupMetadata, signupGoesToApplication, CONTRACTOR_APPLY_PATH,
} from './signup-account';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Nothing a visitor types may grant a role.
 *
 * The first draft of this flow stored `{ account_type: 'contractor', role: 'contractor' }`
 * in the signup metadata and had a trigger on `auth.users` read it back. `options.data`
 * in signUp() is set by the browser, so that was a self-service role grant — harmless
 * only for as long as the role opened nothing.
 *
 * Migration 100 replaced it: contractor standing comes from an application an admin
 * accepted, claimed with a token we emailed. These pins exist so the metadata path
 * cannot quietly come back.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page      = code('src/app/routes/auth/signup.tsx');
const migration = src('supabase/migrations/100_contractor_account_claim.sql');

describe('signup metadata carries contact details and nothing privileged', () => {
  // 102 added a phone number, which the product needs to reach anybody on WhatsApp. The rule
  // this block enforces was never "one key" — it is that nothing here may confer standing.
  // A phone number is a contact detail the account holder asserts about themselves, which
  // `/profile` has always let them set; a role would be a privilege the browser chose.
  it('stores full_name, and a phone number when one was given', () => {
    expect(signupMetadata('Ada Njoku')).toEqual({ full_name: 'Ada Njoku' });
    expect(signupMetadata('Ada Njoku', '+237670000000'))
      .toEqual({ full_name: 'Ada Njoku', phone: '+237670000000' });
  });

  it('omits the phone rather than sending an empty one', () => {
    expect(signupMetadata('Ada Njoku', '')).toEqual({ full_name: 'Ada Njoku' });
    expect(signupMetadata('Ada Njoku', '  ')).toEqual({ full_name: 'Ada Njoku' });
  });

  it('has no role-shaped key, whatever the account type', () => {
    const keys = Object.keys(signupMetadata('Ada Njoku', '+237670000000'));
    for (const banned of ['role', 'account_type', 'is_admin', 'roles', 'claims', 'tier']) {
      expect(keys, `${banned} must never be browser-set`).not.toContain(banned);
    }
    expect(keys.sort()).toEqual(['full_name', 'phone']);
  });

  it('the page sends exactly that to signUp', () => {
    expect(page).toContain('data: signupMetadata(fullName, canonicalPhone),');
    expect(page).not.toContain("account_type");
    // Normalised before it is sent. `handle_new_user` drops anything that is not E.164, so a
    // page that passed the raw value would lose numbers silently.
    expect(page).toMatch(/normalisePhone\(phone/);
  });

  it('no trigger reads signup metadata for a role any more', () => {
    // 100 drops the draft trigger rather than leaving it to rot.
    expect(migration).toContain('DROP TRIGGER  IF EXISTS on_auth_contractor_signup ON auth.users;');
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.register_contractor_signup();');
    expect(migration).not.toMatch(/raw_user_meta_data[^\n]*account_type[^\n]*\n\s*INSERT INTO public\.user_roles/);
  });
});

describe('what the account-type choice actually does', () => {
  it('defaults to a client', () => {
    expect(signupAccountType(new URLSearchParams())).toBe('homeowner');
    expect(signupGoesToApplication(new URLSearchParams())).toBe(false);
  });

  it('the contractor radio leads to the application, not to an account', () => {
    const params = new URLSearchParams('role=contractor');
    expect(signupAccountType(params)).toBe('contractor');
    expect(signupGoesToApplication(params)).toBe(true);
    expect(CONTRACTOR_APPLY_PATH).toBe('/contractor-apply');
  });

  it('an invite link still creates an account', () => {
    // They already have a project waiting; their standing comes from accepting the
    // invite, which carries its own admin-issued token.
    const params = new URLSearchParams('invite=abc&role=contractor');
    expect(signupAccountType(params)).toBe('contractor');
    expect(signupGoesToApplication(params), 'an invited contractor must still sign up').toBe(false);
  });

  it('the page hides the form and the OAuth buttons when it is sending them to apply', () => {
    expect(page).toContain('{sendToApplication ? (');
    expect(page).toContain('{!sendToApplication && (');
    expect(page).toContain('{!isContractorSignup && !sendToApplication && (');
    expect(page).toContain('to={CONTRACTOR_APPLY_PATH}');
  });
});

describe('the explainer is translated', () => {
  it.each(['contractorReviewed', 'contractorReviewedBody', 'contractorApplyCta'])(
    'auth.signup.%s exists in both languages', key => {
      for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
        const hit = lookup(dict as never, `auth.signup.${key}`);
        expect(hit, `${key} missing in ${lang}`).toBeTypeOf('string');
        expect(String(hit).trim().length).toBeGreaterThan(0);
      }
    });

  it('does not promise an account the applicant will not get', () => {
    const body = String(lookup(en as never, 'auth.signup.contractorReviewedBody')).toLowerCase();
    expect(body).toMatch(/approv|review/);
  });
});
