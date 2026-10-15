import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIAL_COUNTRIES, countryOfE164, dialCountry, nationalPart, normalisePhone, isE164,
} from './phone';

/**
 * Picking the country instead of assuming it.
 *
 * Every phone input in the product used to normalise against Cameroon. That is right
 * for most numbers and silently wrong for the rest: a partner running their firm from
 * Paris, or a next of kin in London, had "+237" prefixed to a national number and
 * ended up with a number that reaches nobody — stored, canonical-looking, and useless.
 */

const ROOT = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the dialling list', () => {
  it('covers every dialling code the normaliser knows, and nothing it does not', () => {
    // DIAL_COUNTRIES is built from DIAL_CODES and throws on a missing name, so the one
    // direction is enforced at import. This is the other: a country offered in the
    // dropdown that normalisePhone cannot place would produce an unusable number.
    for (const c of DIAL_COUNTRIES) {
      expect(normalisePhone('670000000', c.code), `${c.code} is offered but not placeable`)
        .toMatch(/^\+/);
    }
    expect(DIAL_COUNTRIES.length).toBeGreaterThan(30);
  });

  it('is not the build-country list', () => {
    // COUNTRIES is where you can BUILD, and is Africa-only for that reason. A phone is
    // about where a handset is. Conflating them makes a London next of kin unenterable.
    const codes = DIAL_COUNTRIES.map(c => c.code);
    for (const diaspora of ['GB', 'FR', 'US', 'CA', 'DE', 'BE']) {
      expect(codes, `${diaspora} must be dialable`).toContain(diaspora);
    }
    const countries = read('src/lib/countries.ts');
    expect(countries, 'countries.ts is the build list and should stay Africa-only')
      .not.toMatch(/code: 'GB'/);
  });

  it('puts Cameroon first, then alphabetical', () => {
    expect(DIAL_COUNTRIES[0].code).toBe('CM');
    const rest = DIAL_COUNTRIES.slice(1).map(c => c.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('every entry carries a flag and a dialling code', () => {
    for (const c of DIAL_COUNTRIES) {
      expect(c.dial, `${c.code} has no dial code`).toMatch(/^[0-9]{1,4}$/);
      expect(c.flag.length, `${c.code} has no flag`).toBeGreaterThan(1);
      expect(c.name.length).toBeGreaterThan(2);
    }
  });
});

describe('reading a number back', () => {
  it('finds the country by the LONGEST matching code', () => {
    // +237 must not be read as +23. Shortest-match would file every Cameroonian number
    // under whatever country owns the shorter prefix.
    expect(countryOfE164('+237670000000')).toBe('CM');
    expect(countryOfE164('+447700900000')).toBe('GB');
    expect(countryOfE164('+33612345678')).toBe('FR');
  });

  it('a shared code resolves to one of its countries, which is harmless', () => {
    // +1 is both US and CA. Either answer normalises back to the same E.164.
    expect(['US', 'CA']).toContain(countryOfE164('+12125550123'));
  });

  it('returns nothing for a number that is not E.164', () => {
    expect(countryOfE164('670000000')).toBeUndefined();
    expect(countryOfE164('')).toBeUndefined();
    expect(countryOfE164(null)).toBeUndefined();
  });

  it('splits the national part off for display', () => {
    expect(nationalPart('+237670000000', 'CM')).toBe('670000000');
    expect(nationalPart('+447700900000', 'GB')).toBe('7700900000');
    expect(nationalPart('', 'CM')).toBe('');
  });

  it('round-trips: split it, re-normalise it, get the same number', () => {
    for (const e164 of ['+237670000000', '+447700900000', '+33612345678', '+15551234567']) {
      const iso = countryOfE164(e164)!;
      expect(normalisePhone(nationalPart(e164, iso), iso)).toBe(e164);
    }
  });
});

describe('the field is used wherever a number is asked for', () => {
  const uses = [
    ['contractor / verifier signup', 'src/components/auth/RoleSignup.tsx'],
    ['client signup',                'src/app/routes/auth/signup.tsx'],
    ['client onboarding',            'src/app/routes/onboarding.tsx'],
    ['contractor onboarding',        'src/app/routes/work/onboarding.tsx'],
    ['payout details',               'src/components/contractor/PayoutDialog.tsx'],
  ] as const;

  it.each(uses)('%s uses PhoneField, not a bare tel input', (_name, file) => {
    const src = strip(read(file));
    expect(src).toMatch(/<PhoneField/);
    expect(src, 'a bare tel input assumes the default country')
      .not.toMatch(/type="tel"/);
  });

  it('the contractor APPLICATION form is deliberately left alone', () => {
    // Favour's instruction: do not touch the apply flow. It is a separate door for
    // people who do not have an account yet.
    const apply = read('src/components/contractor/ContractorApplicationForm.tsx');
    expect(apply).toMatch(/type="tel"/);
  });
});

describe('a payout number is not an emergency contact', () => {
  const dialog = strip(read('src/components/contractor/PayoutDialog.tsx'));
  const work   = strip(read('src/app/routes/work/onboarding.tsx'));

  it('emergency contacts may be anywhere in the world', () => {
    // No `countries` prop means the full list.
    const panel = work.slice(work.indexOf('function ContactPanel'));
    const field = panel.slice(panel.indexOf('<PhoneField'));
    expect(field.slice(0, field.indexOf('/>'))).not.toMatch(/countries=/);
  });

  it('a payout number is restricted to corridors we can actually pay into', () => {
    // Offering Kenya would promise a payment we cannot make, discovered at release.
    expect(dialog).toMatch(/countries=\{payoutCountries\}/);
    expect(dialog).toMatch(/PAYOUT_COUNTRY_CODES\.includes/);
  });

  it('and that list is derived from the banks, so a corridor cannot be half-opened', () => {
    const banks = read('src/lib/payments/banks.ts');
    expect(banks).toMatch(/PAYOUT_COUNTRY_CODES[\s\S]{0,120}BANKS\.map\(b => b\.countryCode\)/);
  });

  it('the corridor drives the bank list, the dialling code and the stored country', () => {
    // Three things that must not disagree. PhoneField owns its country privately, so
    // the dialog re-keys it on the corridor rather than letting the two drift.
    expect(dialog).toMatch(/const banks = banksFor\(country\)/);
    expect(dialog).toMatch(/key=\{country\}/);
    expect(dialog).toMatch(/countryCode: country/);
  });
});
