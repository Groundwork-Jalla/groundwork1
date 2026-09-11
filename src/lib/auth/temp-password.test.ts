import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword } from './temp-password';
import { evaluatePassword } from './password-policy';

/** Deterministic LCG so the tests are repeatable; the default source is tested separately. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

describe('generateTemporaryPassword', () => {
  it('is four dash-separated groups of four', () => {
    const pw = generateTemporaryPassword(seeded(1));
    expect(pw).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
  });

  it('never contains a character that is mistranscribed when read aloud', () => {
    for (let seed = 0; seed < 200; seed++) {
      const pw = generateTemporaryPassword(seeded(seed));
      expect(pw).not.toMatch(/[0O1lI5S2Z8B]/);
    }
  });

  it('always satisfies the password policy the client will be held to', () => {
    for (let seed = 0; seed < 200; seed++) {
      const pw = generateTemporaryPassword(seeded(seed));
      const failed = evaluatePassword(pw).rules.filter(r => !r.passed).map(r => r.id);
      expect(failed).toEqual([]);
    }
  });

  it('redraws when a candidate collides with the person it is for', () => {
    // Force the first draw to embed the local part of the email, then prove the caller
    // never sees it: the generator must redraw rather than return a policy reject.
    let calls = 0;
    const scripted = (max: number) => { calls++; return calls < 40 ? 0 : (calls * 7) % max; };
    const first = generateTemporaryPassword(scripted);           // the "all zeros" draw
    const callsForOneDraw = calls;
    const ctx = { email: `${first.replace(/-/g, '').slice(0, 4).toLowerCase()}@x.test` };
    calls = 0;
    const pw = generateTemporaryPassword(scripted, ctx);
    expect(evaluatePassword(pw, ctx).valid).toBe(true);
    expect(pw).not.toBe(first);
    // More random draws than one attempt costs: the first candidate was thrown away.
    expect(calls).toBeGreaterThan(callsForOneDraw);
  });

  it('draws from the platform CSPRNG by default and does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateTemporaryPassword());
    expect(seen.size).toBe(50);
    for (const pw of seen) expect(evaluatePassword(pw).valid).toBe(true);
  });
});
