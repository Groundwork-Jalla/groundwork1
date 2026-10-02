import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { resolveRecipient, type ProjectPeople } from '@/lib/admin/whatsapp-shortcut';
import { signupMetadata } from '@/lib/auth/signup-account';
import { normalisePhone, isE164 } from '@/lib/phone';

/**
 * Reaching the people on a project over WhatsApp.
 *
 * Two halves. Choosing WHO a message goes to is pure and tested directly, because the cost
 * of getting it wrong is a project's details reaching the wrong professional. Collecting the
 * phone number that makes any of it possible is checked at each of the three doors people
 * arrive through — signup, onboarding, and the contractor claim.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');

const CLIENT = 'client-1';
const people = (over: Partial<ProjectPeople> = {}): ProjectPeople =>
  ({ clientId: CLIENT, contractors: [], verifiers: [], ...over });

describe('who on the project is being messaged', () => {
  it('reaches the client, which is what the button always meant', () => {
    expect(resolveRecipient('client', people())).toEqual({ kind: 'person', personId: CLIENT });
  });

  it('says so plainly when nobody holds the role', () => {
    expect(resolveRecipient('contractor', people())).toEqual({ kind: 'none', role: 'contractor' });
    expect(resolveRecipient('verifier', people())).toEqual({ kind: 'none', role: 'verifier' });
    expect(resolveRecipient('client', people({ clientId: null }))).toEqual({ kind: 'none', role: 'client' });
  });

  it('reaches the primary contractor, who is already the project’s point of contact', () => {
    const r = resolveRecipient('contractor', people({ contractors: [
      { userId: 'c-other', isPrimary: false },
      { userId: 'c-main',  isPrimary: true  },
    ] }));
    expect(r).toEqual({ kind: 'person', personId: 'c-main' });
  });

  it('reaches a lone contractor even with no primary named', () => {
    expect(resolveRecipient('contractor', people({ contractors: [{ userId: 'c-only', isPrimary: false }] })))
      .toEqual({ kind: 'person', personId: 'c-only' });
  });

  it('asks rather than picking when several contractors and no primary', () => {
    const r = resolveRecipient('contractor', people({ contractors: [
      { userId: 'c-1', isPrimary: false }, { userId: 'c-2', isPrimary: false },
    ] }));
    expect(r).toEqual({ kind: 'choose', role: 'contractor', candidates: ['c-1', 'c-2'] });
  });

  it('never guesses between verifiers, because disciplines are different people', () => {
    // Two verifiers on one project is the normal case per the Sep 11 decision (a civil
    // engineer and an electrical engineer). Neither is "the" verifier.
    const r = resolveRecipient('verifier', people({ verifiers: [
      { userId: 'v-civil', discipline: 'civil' },
      { userId: 'v-elec',  discipline: 'electrical' },
    ] }));
    expect(r).toEqual({ kind: 'choose', role: 'verifier', candidates: ['v-civil', 'v-elec'] });
  });

  it('reaches a lone verifier without asking', () => {
    expect(resolveRecipient('verifier', people({ verifiers: [{ userId: 'v-1', discipline: 'civil' }] })))
      .toEqual({ kind: 'person', personId: 'v-1' });
  });

  it('honours an explicit choice that really holds the role', () => {
    const p = people({ verifiers: [
      { userId: 'v-1', discipline: 'civil' }, { userId: 'v-2', discipline: 'electrical' },
    ] });
    expect(resolveRecipient('verifier', p, 'v-2')).toEqual({ kind: 'person', personId: 'v-2' });
  });

  it('refuses a named person who is not on the project in that role', () => {
    // Otherwise the endpoint would open a WhatsApp thread with anybody whose id was posted
    // to it, on the strength of a project the person has nothing to do with.
    const p = people({ verifiers: [{ userId: 'v-1', discipline: 'civil' }] });
    expect(resolveRecipient('verifier', p, 'a-stranger')).toEqual({ kind: 'none', role: 'verifier' });
    expect(resolveRecipient('contractor', p, CLIENT)).toEqual({ kind: 'none', role: 'contractor' });
  });

  it('will not message the client by asking for a contractor', () => {
    const p = people({ contractors: [{ userId: 'c-1', isPrimary: true }] });
    expect(resolveRecipient('contractor', p)).toEqual({ kind: 'person', personId: 'c-1' });
    expect(resolveRecipient('contractor', p, CLIENT)).toEqual({ kind: 'none', role: 'contractor' });
  });
});

describe('the server keeps the decision', () => {
  const H = 'api/_handlers/project-whatsapp.ts';

  it('resolves the recipient through the shared function, not its own logic', () => {
    const src = code(H);
    expect(src).toMatch(/resolveRecipient\(/);
    // The old hard-wiring. If this comes back, contractor and verifier silently become the
    // client again and nobody notices until a message goes to the wrong person.
    expect(src).not.toMatch(/const personId = \(project\.user_id/);
  });

  it('defaults to the client, so every existing caller means what it meant', () => {
    expect(code(H)).toMatch(/:\s*'client';/);
  });

  it('reads only the assignment table the chosen role needs', () => {
    const src = code(H);
    expect(src).toMatch(/if \(role === 'contractor'\)[\s\S]{0,200}contractor_invites/);
    expect(src).toMatch(/if \(role === 'verifier'\)[\s\S]{0,200}project_verifiers/);
    // Only accepted assignments and active verifiers are messageable.
    expect(src).toMatch(/\.eq\('status', 'accepted'\)/);
    expect(src).toMatch(/\.eq\('status', 'active'\)/);
  });

  it('still refuses to create a thread it cannot deliver to', () => {
    const src = code(H);
    expect(src).toMatch(/reason: 'no_phone'/);
    expect(src).toMatch(/isDeliverablePhone/);
  });

  it('still never moves a thread between projects', () => {
    // A conversation belongs to the person and spans their projects; 091's rule, unchanged.
    expect(code(H)).not.toMatch(/conversations[\s\S]{0,200}project_id:/);
  });

  it('has wording for every refusal the handler can return, in both languages', () => {
    const reasons = ['no_client', 'no_contractor', 'no_verifier', 'choose_person', 'no_phone',
                     'not_configured', 'contact_failed', 'provider_failed', 'record_failed',
                     'conversations_unavailable', 'ambiguous', 'error'];
    for (const r of reasons) {
      const e = (en.admin as Record<string, any>).workspace.header.whatsappFail[r];
      const f = (fr.admin as Record<string, any>).workspace.header.whatsappFail[r];
      expect(e, `en lacks ${r}`).toBeTypeOf('string');
      expect(f, `fr lacks ${r}`).toBeTypeOf('string');
    }
  });
});

describe('a phone number is collected at every door', () => {
  it('signup asks for one and sends it normalised', () => {
    const src = code('src/app/routes/auth/signup.tsx');
    expect(src).toMatch(/id="phone"/);
    expect(src).toMatch(/normalisePhone\(phone/);
    // Refused at the form, not silently dropped by the trigger — a person who typed a number
    // and was told nothing would believe we had it.
    expect(src).toMatch(/isE164\(canonicalPhone\)/);
    expect(src).toMatch(/signupMetadata\(fullName, canonicalPhone\)/);
  });

  it('onboarding asks the clients who never went through that form', () => {
    const src = code('src/app/routes/onboarding.tsx');
    expect(src).toMatch(/loadClientContact/);
    expect(src).toMatch(/saveClientPhone/);
    // Only when we do not already have one.
    expect(src).toMatch(/if \(c\.phone\)/);
  });

  it('the claim brings over the number the contractor already gave us', () => {
    const src = code('src/lib/supabase/contractor-claim.ts');
    expect(src).toMatch(/carryOverApplicationPhone/);
    expect(src).toMatch(/from\('contractor_applications'\)[\s\S]{0,120}phone/);
    // Never overwrites a number already on the profile.
    expect(src).toMatch(/if \(profile\?\.phone\) return;/);
  });

  it('the claim cannot fail because of it', () => {
    const src = code('src/lib/supabase/contractor-claim.ts');
    // Fire-and-forget, and the function swallows its own errors: the account IS claimed.
    expect(src).toMatch(/void carryOverApplicationPhone/);
    expect(src).toMatch(/catch \{/);
  });
});

describe('signup metadata stays free of anything privileged', () => {
  it('carries a name and a phone, and nothing else', () => {
    expect(signupMetadata('Ada Lovelace', '+237670000000'))
      .toEqual({ full_name: 'Ada Lovelace', phone: '+237670000000' });
    expect(Object.keys(signupMetadata('Ada', '+237670000000')).sort()).toEqual(['full_name', 'phone']);
  });

  it('omits the phone entirely rather than sending a blank', () => {
    expect(signupMetadata('Ada')).toEqual({ full_name: 'Ada' });
    expect(signupMetadata('Ada', '   ')).toEqual({ full_name: 'Ada' });
    expect(signupMetadata('Ada', null)).toEqual({ full_name: 'Ada' });
  });

  it('still contains no role-shaped key, which was the original rule', () => {
    const keys = Object.keys(signupMetadata('Ada', '+237670000000'));
    for (const forbidden of ['role', 'account_type', 'tier', 'is_admin', 'roles']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('the database only ever stores a messageable number', () => {
  const SQL = read('supabase/migrations/102_contact_phone_capture.sql');

  it('drops a signup number that is not already E.164 rather than storing it', () => {
    expect(SQL).toMatch(/IF NOT public\.is_e164\(v_phone\) THEN v_phone := NULL; END IF;/);
  });

  it('never overwrites a number the person has already given', () => {
    expect(SQL).toMatch(/phone = COALESCE\(public\.profiles\.phone, EXCLUDED\.phone\)/);
    expect(SQL).toMatch(/SET phone = COALESCE\(phone, v_phone\)/);
  });

  it('refuses to guess the country of a bare local number', () => {
    // src/lib/phone.ts is the only thing that knows dial codes and trunk-prefix rules. A
    // second implementation in plpgsql would drift, and a wrong number reaches a stranger.
    const fn = SQL.match(/FUNCTION public\.normalised_phone[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(fn).toMatch(/RETURN NULL;/);
    // Comments stripped first: the function DOCUMENTS that it will not reach for a dial
    // code, and reading that sentence as the breach would teach us to delete the sentence.
    const body = fn.replace(/--[^\n]*/g, ' ');
    expect(body).not.toMatch(/237|dial_code|trunk/i);
  });

  it('keeps everything 047 put in handle_new_user', () => {
    // This trigger must never be the reason a signup fails, so the name fallback chain, the
    // avatar claim and the email mirror all have to survive being rewritten.
    const fn = SQL.match(/FUNCTION public\.handle_new_user[\s\S]*?END \$\$;/)?.[0] ?? '';
    for (const kept of ['given_name', 'family_name', "meta->>'picture'", 'app.email_sync',
                        'ON CONFLICT (id) DO UPDATE']) {
      expect(fn, `handle_new_user lost ${kept}`).toContain(kept);
    }
  });

  it('keeps everything 100 put in the claim', () => {
    const fn = SQL.match(/FUNCTION public\.claim_contractor_account[\s\S]*?END \$\$;/)?.[0] ?? '';
    for (const kept of ['not_signed_in', 'invalid_token', 'not_accepted', 'already_claimed',
                        "VALUES (v_actor, 'contractor')", 'contractor.account_claimed']) {
      expect(fn, `the claim lost ${kept}`).toContain(kept);
    }
  });
});

describe('normalisation agrees with what the SQL will accept', () => {
  it('produces a value is_e164 would keep, for the numbers people actually type', () => {
    // The two sides have to agree or a number saves in the browser and is dropped by the
    // trigger — the exact failure this pair of rules exists to prevent.
    for (const typed of ['670 00 00 00', '+237 670 00 00 00', '00237670000000', '237670000000']) {
      const c = normalisePhone(typed, 'CM');
      expect(isE164(c), `${typed} → ${c}`).toBe(true);
      expect(c).toBe('+237670000000');
    }
  });

  it('does not turn nonsense into a plausible number', () => {
    expect(isE164(normalisePhone('12', 'CM'))).toBe(false);
    expect(isE164(normalisePhone('not a phone', 'CM'))).toBe(false);
    expect(normalisePhone('', 'CM')).toBeNull();
  });
});
