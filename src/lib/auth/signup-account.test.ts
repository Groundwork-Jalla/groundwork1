import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  signupAccountType, signupMetadata, signupGoesToPartnerDoor, CONTRACTOR_SIGNUP_PATH,
  isExistingAccount,
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
    expect(signupGoesToPartnerDoor(new URLSearchParams())).toBe(false);
  });

  it('the contractor radio leads to the contractor door, which creates a real account', () => {
    // Reversed from the original order: a contractor no longer has to be accepted before
    // holding an account. The application became a step inside the product (133), so this
    // radio points at the door that signs them up — not at a form that reviews them.
    const params = new URLSearchParams('role=contractor');
    expect(signupAccountType(params)).toBe('contractor');
    expect(signupGoesToPartnerDoor(params)).toBe(true);
    expect(CONTRACTOR_SIGNUP_PATH).toBe('/contractor-signup');
  });

  it('nobody is sent to the retired apply-first flow', () => {
    // The whole point of the change. If this path reappears as a destination anywhere in
    // the app, a contractor is being asked for an application before they have an
    // account, which is the order Groundwork moved away from.
    const doors = [
      'src/app/routes/auth/signup.tsx',
      'src/components/auth/RoleSignup.tsx',
      'src/components/landing/CTASection.tsx',
      'src/components/shell/SiteNav.tsx',
      'src/app/routes/contractors.tsx',
    ];
    for (const door of doors) {
      const src = readFileSync(resolve(process.cwd(), door), 'utf8');
      expect(src, `${door} still sends somebody to /contractor-apply`)
        .not.toMatch(/to=["'{]\s*["']?\/contractor-apply|href=["']\/contractor-apply/);
    }
  });

  it('an invite link still creates an account', () => {
    // They already have a project waiting; their standing comes from accepting the
    // invite, which carries its own admin-issued token.
    const params = new URLSearchParams('invite=abc&role=contractor');
    expect(signupAccountType(params)).toBe('contractor');
    expect(signupGoesToPartnerDoor(params), 'an invited contractor must still sign up').toBe(false);
  });

  /**
   * Philip's flow, point 4: "When someone checks the Contractor box, it should simply
   * load the Signup Form on the same page (Not a redirect, Not a Pop up, Not a
   * different page opened)."
   *
   * This used to assert the opposite — that the page handed off to /contractor-signup.
   * The account is still created by `register_contractor_account` and not by the client
   * form; what changed is that the contractor form is now drawn here.
   */
  it('loads the contractor form in place rather than handing off', () => {
    expect(page).toContain('{sendToPartnerDoor ? (');
    expect(page).toContain('<RoleSignup role="contractor" embedded onSubmitted={handleRoleFormSent} />');
    expect(page).toContain('{!isContractorSignup && !sendToPartnerDoor && (');
  });

  // Once the embedded form says "check your email" the account exists, so the heading
  // and the Client/Contractor radio above it are answering a settled question. Offering
  // the radio there invites somebody to switch role after signing up.
  it('the heading and the role radio go away once the form has been sent', () => {
    expect(page).toContain('{!roleFormSent && (');
    expect(page).toContain('{!isInviteFlow && !roleFormSent && (');
    expect(code('src/components/auth/RoleSignup.tsx'))
      .toContain('useEffect(() => { onSubmitted?.(submitted); }, [submitted, onSubmitted]);');
  });

  /**
   * The two branches are SIBLINGS, never one inside the other.
   *
   * RoleSignup renders its own <form>. Nested inside this page's, React builds the
   * invalid markup anyway through the DOM, the inner submit escapes as a native GET,
   * and the browser reloads /auth/signup? — role stripped, every field cleared, no
   * error. Reported from a live onboarding call: "it takes us back to the beginning",
   * twice, with the contractor giving up.
   */
  it('never puts one form inside another', () => {
    const open = page.indexOf('<form onSubmit={handleSubmit}');
    const close = page.indexOf('</form>', open);
    expect(open).toBeGreaterThan(-1);
    // RoleSignup must not fall between this form's open and close tags.
    const role = page.indexOf('<RoleSignup');
    expect(role === -1 || role < open || role > close, 'RoleSignup is inside the form').toBe(true);
  });

  it('and the role radio sits outside the form, since it only rewrites the URL', () => {
    const radio = page.indexOf("name=\"accountType\"");
    const open = page.indexOf('<form onSubmit={handleSubmit}');
    expect(radio).toBeGreaterThan(-1);
    expect(radio).toBeLessThan(open);
  });

  it('and never sends them to another page to do it', () => {
    expect(page).not.toContain('CONTRACTOR_SIGNUP_PATH');
    expect(page).not.toMatch(/to=["'{]\s*["']?\/contractor-signup/);
  });

  /**
   * Point 2: "it should take them to the same page as when someone clicks on Join for
   * Free." The two CTAs sit beside each other, so they have to share a destination —
   * the contractor one only adds which option is already chosen.
   */
  it('the nav CTA lands on the signup page with the role chosen', () => {
    const nav = code('src/components/shell/SiteNav.tsx');
    expect(nav).toContain('to="/auth/signup?role=contractor"');
    expect(nav).not.toContain('to="/contractor-signup"');
  });
});

describe('the explainer is translated', () => {
  it.each(['contractorDoor', 'contractorDoorBody', 'contractorDoorCta'])(
    'auth.signup.%s exists in both languages', key => {
      for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
        const hit = lookup(dict as never, `auth.signup.${key}`);
        expect(hit, `${key} missing in ${lang}`).toBeTypeOf('string');
        expect(String(hit).trim().length).toBeGreaterThan(0);
      }
    });

  it('no longer makes an account conditional on being approved first', () => {
    // The inverse of what this test used to assert, because the flow inverted: the
    // account comes first and the partner application is a later, separate step. Copy
    // that still talked about approval would send a contractor away to wait for an
    // email that is never coming.
    const body = String(lookup(en as never, 'auth.signup.contractorDoorBody')).toLowerCase();
    expect(body).not.toMatch(/approv|once we|wait/);
    expect(body, 'it should say the partner step is separate').toMatch(/partner/);
  });
});

describe('an address that already has an account is not silence', () => {
  // Supabase answers a repeat sign-up as success with no identities, so that the form
  // cannot be used to discover who has an account. Both of our forms read that as
  // "sent" and showed "check your email" for mail that is never sent. A contractor
  // sat through two attempts and a call was ended over it on 28 October.
  it('an empty identities array means the address is taken', () => {
    expect(isExistingAccount({ identities: [] }, null)).toBe(true);
  });

  it('a real new account has an identity', () => {
    expect(isExistingAccount({ identities: [{ id: 'x' }] }, null)).toBe(false);
  });

  it('a session means they are through, whatever identities says', () => {
    // Confirmation disabled on the project: signUp returns a session and the page
    // sends them to /auth/callback. That must never be read as "already registered".
    expect(isExistingAccount({ identities: [] }, { access_token: 't' })).toBe(false);
  });

  it('says nothing when there is no user to judge', () => {
    expect(isExistingAccount(null, null)).toBe(false);
    expect(isExistingAccount(undefined, null)).toBe(false);
  });

  it('an absent identities field is not treated as taken', () => {
    // Only an explicit empty array carries the meaning. A missing field is a shape we
    // do not recognise, and guessing "taken" would block a genuine sign-up.
    expect(isExistingAccount({}, null)).toBe(false);
    expect(isExistingAccount({ identities: null }, null)).toBe(false);
  });

  it('both forms read it, so they cannot drift apart', () => {
    for (const f of ['src/app/routes/auth/signup.tsx', 'src/components/auth/RoleSignup.tsx']) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      expect(src, `${f} must refuse the dead end`).toMatch(/isExistingAccount\(data\.user, data\.session\)/);
      expect(src, `${f} must say so`).toMatch(/auth\.signup\.alreadyRegistered/);
    }
  });
});
