import { describe, expect, it } from 'vitest';
import {
  MIN_LENGTH, evaluatePassword, isPasswordAcceptable, firstFailure,
} from './password-policy';

/**
 * The policy is the only thing standing between the signup form and "aaaaaaaa".
 *
 * It is pinned hard because it is shared: `/auth/signup` and `/auth/new-password` used to
 * carry different rules, and the weaker of the two was on the password RESET page — so
 * the way to get a bad password onto an account was to set a good one and then reset it.
 * Any future divergence has to break a test rather than a user.
 */

const OK = 'Chantier7Buea';          // long, mixed case, digit, nothing personal
const ctx = { email: 'favour@tryjalla.com', fullName: 'Favour Nwachukwu' };

const failing = (pw: string, c = {}) =>
  evaluatePassword(pw, c).rules.filter(r => !r.passed).map(r => r.id);

describe('composition rules', () => {
  it('accepts a password that meets every rule', () => {
    const a = evaluatePassword(OK);
    expect(a.valid).toBe(true);
    expect(a.rules.every(r => r.passed)).toBe(true);
  });

  it(`requires at least ${MIN_LENGTH} characters`, () => {
    // The old bar was 8. Anything that quietly lowers it again fails here.
    expect(MIN_LENGTH).toBe(10);
    expect(failing('Ab3defgh')).toContain('length');
    expect(failing('Ab3defghij')).not.toContain('length');
  });

  it('requires upper, lower and a digit', () => {
    expect(failing('chantier7buea')).toEqual(['upper']);
    expect(failing('CHANTIER7BUEA')).toEqual(['lower']);
    expect(failing('ChantierBueaX')).toEqual(['number']);
  });

  it('does not require a symbol', () => {
    // NIST-style: length and a blocklist beat symbol mandates, which mostly produce
    // "Password1!". The symbol still moves the meter — see the scoring tests.
    expect(isPasswordAcceptable(OK)).toBe(true);
  });

  it('reports an empty password as failing everything it can', () => {
    const ids = failing('');
    expect(ids).toContain('length');
    expect(ids).toContain('notCommon');
    expect(ids).toContain('notPersonal');
  });
});

describe('blocklist', () => {
  it('rejects the passwords everybody tries first', () => {
    for (const pw of ['Password12', 'QWERTYUIOP1', 'Letmein123', 'Welcome123']) {
      expect(failing(pw), pw).toContain('notCommon');
    }
  });

  it('sees through trailing digits and symbols', () => {
    // `Password123!` is `password` with decoration, and is guessed as fast.
    expect(failing('Password123!')).toContain('notCommon');
    expect(failing('Qwerty2026!')).toContain('notCommon');
  });

  it('rejects the words this product invites', () => {
    expect(failing('Groundwork1')).toContain('notCommon');
    expect(failing('Jalla12345')).toContain('notCommon');
  });

  it('rejects a single repeated character however long', () => {
    expect(failing('aaaaaaaaaaaaaaaaaaaa')).toContain('notCommon');
  });

  it('rejects a straight run off the number line', () => {
    expect(failing('1234567890')).toContain('notCommon');
  });

  it('does not reject a password that merely contains a common word', () => {
    // 'password' inside a longer passphrase is not the same as being 'password'.
    expect(failing('MyOldPasswordShed7')).not.toContain('notCommon');
  });
});

describe('personal information', () => {
  it('rejects the local part of the email', () => {
    expect(failing('Favour123456', ctx)).toContain('notPersonal');
  });

  it('rejects a word from the name', () => {
    expect(failing('Nwachukwu99', ctx)).toContain('notPersonal');
  });

  it('is case-insensitive', () => {
    expect(failing('FAVOUR123456', ctx)).toContain('notPersonal');
  });

  it('ignores fragments too short to mean anything', () => {
    // A two-letter name part would reject half of everything.
    expect(failing('Chantier7Buea', { fullName: 'Al Di', email: 'al@x.com' }))
      .not.toContain('notPersonal');
  });

  it('passes when there is nothing to compare against', () => {
    // No profile to hand is not evidence of a bad password.
    expect(failing(OK, {})).not.toContain('notPersonal');
    expect(evaluatePassword(OK, { email: null, fullName: null }).valid).toBe(true);
  });
});

describe('strength score', () => {
  it('floors a blocklisted password at zero however long it is', () => {
    // A meter reading "strong" beside "this password is on every list" would be the
    // screen contradicting itself.
    const a = evaluatePassword('passwordpasswordpassword');
    expect(a.score).toBe(0);
    expect(a.label).toBe('weak');
  });

  it('floors a password containing the user’s own name at zero', () => {
    expect(evaluatePassword('Favour1234567890', ctx).score).toBe(0);
  });

  it('rises with length', () => {
    const short = evaluatePassword('Ab3defghij').score;
    const long  = evaluatePassword('Ab3defghijklmnopqr').score;
    expect(long).toBeGreaterThan(short);
  });

  it('rises with character variety', () => {
    const without = evaluatePassword('Chantier7Buea').score;
    const withSym = evaluatePassword('Chantier7Buea!').score;
    expect(withSym).toBeGreaterThanOrEqual(without);
  });

  it('scores an empty password zero', () => {
    expect(evaluatePassword('').score).toBe(0);
  });

  it('stays inside 0–4 for anything thrown at it', () => {
    for (const pw of ['', 'a', OK, 'x'.repeat(200), 'Tr0ub4dor&3xkcd-horse-battery']) {
      const { score } = evaluatePassword(pw);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(4);
    }
  });

  it('separates valid from strong', () => {
    // Barely compliant is still compliant — the meter says weak, the form still submits.
    const barely = evaluatePassword('Abcdefghi1');
    expect(barely.valid).toBe(true);
    expect(barely.score).toBeLessThan(4);
  });
});

describe('firstFailure', () => {
  it('names one rule rather than six', () => {
    expect(firstFailure('short')).toBe('length');
    expect(firstFailure('chantier7buea')).toBe('upper');
  });

  it('is null for an acceptable password', () => {
    expect(firstFailure(OK)).toBeNull();
  });
});
