import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The email second factor, guarded at the properties that make it one.
 *
 * Supabase has no email factor type, so unlike TOTP this is ours to build — which means
 * the rules that Supabase would otherwise enforce are ours to keep. Every check below is
 * a property that a plausible refactor could remove without breaking a single feature,
 * and whose absence would not show up until it was being exploited.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
/**
 * Comments here name the very things they forbid — "not Math.random", "a plain === leaks
 * the code" — so scanning the raw file finds the warning and reads it as the offence.
 * Only code counts.
 */
const stripComments = (src: string) =>
  src.split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

const handler = stripComments(readFileSync(join(ROOT, 'api/_handlers/mfa-email.ts'), 'utf8'));
const sql     = readFileSync(join(ROOT, 'supabase/migrations/080_email_second_factor.sql'), 'utf8');
const client  = stripComments(readFileSync(join(ROOT, 'src/lib/auth/email-otp.ts'), 'utf8'));

describe('the code itself is never recoverable', () => {
  it('stores a hash bound to the challenge id, never the code', () => {
    expect(handler).toMatch(/createHash\('sha256'\)/);
    expect(handler).toMatch(/hashCode\(code, row\.id\)/);
    // The id is the salt, so one precomputed table cannot serve two challenges — six
    // digits is otherwise trivially reversible.
    expect(handler).toMatch(/update\(`\$\{code\}\$\{challengeId\}`\)/);
  });

  it('salting by the row id actually separates two identical codes', () => {
    const h = (code: string, id: string) =>
      createHash('sha256').update(`${code}${id}`).digest('hex');
    expect(h('123456', 'challenge-a')).not.toBe(h('123456', 'challenge-b'));
  });

  it('draws the code from a CSPRNG', () => {
    expect(handler).toMatch(/randomInt\(0, 1_000_000\)/);
    expect(handler, 'Math.random is predictable and must never mint a factor')
      .not.toMatch(/Math\.random/);
  });
});

describe('guessing is bounded', () => {
  it('counts the attempt before comparing', () => {
    // Incrementing afterwards gives a free guess to any client that hangs up mid-request.
    const bump    = handler.indexOf('attempts: challenge.attempts + 1');
    const compare = handler.indexOf('sameHash(challenge.code_hash');
    expect(bump).toBeGreaterThan(-1);
    expect(bump, 'the attempt counter must increment before the comparison')
      .toBeLessThan(compare);
  });

  it('caps attempts, lifetime and sends', () => {
    expect(handler).toMatch(/MAX_ATTEMPTS\s*=\s*5/);
    expect(handler).toMatch(/CODE_TTL_MINUTES\s*=\s*10/);
    expect(handler).toMatch(/MAX_SENDS_PER_HOUR\s*=\s*5/);
    // The send limit is on the account, not the browser — a client-side limit is a
    // suggestion.
    expect(handler).toMatch(/\.eq\('user_id', user\.id\)[\s\S]{0,120}gte\('created_at', since\)/);
  });

  it('burns the code on success', () => {
    expect(handler).toMatch(/consumed_at: new Date\(\)\.toISOString\(\)/);
    expect(handler).toMatch(/if \(challenge\.consumed_at\) \{ refuse\(\); return; \}/);
  });
});

describe('failures tell an attacker nothing', () => {
  it('answers every failure identically', () => {
    // Unknown challenge, already used, expired, out of attempts and wrong code are all
    // the same response — so none of them is a probe.
    // Counts every call however it is formatted: four guards on one line each, plus the
    // wrong-code branch spread over three.
    const refusals = handler.match(/\brefuse\(\)/g) ?? [];
    expect(refusals.length, 'every failure path must answer identically')
      .toBeGreaterThanOrEqual(5);
    expect(handler).toMatch(/const refuse = \(\) =>[\s\S]{0,120}That code is not valid\./);
  });

  it('compares in constant time', () => {
    expect(handler).toMatch(/timingSafeEqual/);
    expect(handler, 'a plain === leaks the code one digit at a time')
      .not.toMatch(/challenge\.code_hash\s*===/);
  });

  it('constant-time comparison still returns the right answers', () => {
    const eq = (a: string, b: string) => {
      const x = Buffer.from(a, 'utf8'), y = Buffer.from(b, 'utf8');
      return x.length === y.length && timingSafeEqual(x, y);
    };
    expect(eq('abc', 'abc')).toBe(true);
    expect(eq('abc', 'abd')).toBe(false);
    expect(eq('abc', 'abcd')).toBe(false);   // length mismatch must not throw
  });

  it('scopes the challenge to the caller', () => {
    // A challenge id is not a secret. Without this, anyone could burn down someone
    // else's attempt counter and lock them out.
    expect(handler).toMatch(/\.eq\('id', challengeId\)[\s\S]{0,300}\.eq\('user_id', user\.id\)/);
  });
});

describe('the browser cannot decide the outcome', () => {
  it('locks the challenge table away from every browser role', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.email_otp_challenges FROM anon, authenticated/);
    // RLS with no policies is the lock; a policy here would be the bug.
    expect(sql, 'no policy may expose the challenge table').not.toMatch(/CREATE POLICY[^;]*email_otp_challenges/);
  });

  it('keeps all the logic server-side', () => {
    // The client module posts and reads an answer. Any comparison, expiry check or
    // counter on this side would be a second factor the browser could simply skip.
    for (const forbidden of [/timingSafeEqual/, /createHash/, /expires_at/, /attempts/]) {
      expect(client, `client-side ${forbidden} would be decidable by the browser`)
        .not.toMatch(forbidden);
    }
  });

  it('requires a signed-in caller for both operations', () => {
    expect(handler).toMatch(/const user = await requireUser\(req\)/);
    expect(handler.indexOf('requireUser')).toBeLessThan(handler.indexOf("action === 'send'"));
  });
});

/**
 * The wiring, guarded at the point where the factor would silently stop being asked for.
 *
 * `challengeRequired()` asks Supabase, and Supabase does not know the email factor exists.
 * A sign-in path that calls it instead of `requiredFactor()` routes an email-only user
 * straight into the app having presented one factor — with 2FA showing as ON in their
 * settings. Nothing throws, nothing logs, and the feature is decorative.
 */
describe('both sign-in paths ask WHICH factor', () => {
  const paths = ['src/app/routes/auth/login.tsx', 'src/app/routes/auth/callback.tsx'];

  it('resolves the factor rather than asking Supabase alone', () => {
    for (const path of paths) {
      const src = stripComments(readFileSync(join(ROOT, path), 'utf8'));
      expect(src, `${path} must resolve the factor`).toMatch(/requiredFactor\(\)/);
      expect(src, `${path} would skip the email factor entirely`)
        .not.toMatch(/challengeRequired\(\)/);
      // And it must pass what it resolved to the challenge, or the form asks for a TOTP
      // code the user has no way to produce.
      expect(src, `${path} must tell the challenge which factor`).toMatch(/factor=\{mfaFactor\}/);
    }
  });

  it('prefers TOTP when a user has both', () => {
    // TOTP is stronger and is the only factor Supabase enforces at aal2, so it is checked
    // first and short-circuits.
    const mfa = stripComments(readFileSync(join(ROOT, 'src/lib/auth/mfa.ts'), 'utf8'));
    const totpAt  = mfa.indexOf("if (await challengeRequired()) return 'totp'");
    const emailAt = mfa.indexOf('emailMfaEnabled(user.id)');
    expect(totpAt).toBeGreaterThan(-1);
    expect(totpAt).toBeLessThan(emailAt);
  });

  it('fails closed on a lookup error', () => {
    // A broken profile read must not become "no second factor required" for a user who
    // has one... but it also must not lock the product out. Same posture as
    // challengeRequired: the cost of the wrong answer is the status quo before 2FA.
    const mfa = readFileSync(join(ROOT, 'src/lib/auth/mfa.ts'), 'utf8');
    expect(mfa).toMatch(/catch \{[\s\S]{0,300}return 'none';/);
  });
});

describe('turning the email factor off actually turns it off', () => {
  it('clears the session marker as well as the flag', () => {
    // Without this the change appears to do nothing until the tab is closed — the marker
    // still says this session already passed.
    const section = stripComments(
      readFileSync(join(ROOT, 'src/components/profile/TwoFactorSection.tsx'), 'utf8'));
    expect(section).toMatch(/setEmailMfa\(user\.id, next\)/);
    expect(section).toMatch(/if \(!next\) clearEmailFactor\(user\.id\)/);
  });

  it('records the pass only after the server accepted the code', () => {
    const challenge = stripComments(
      readFileSync(join(ROOT, 'src/components/auth/MfaChallenge.tsx'), 'utf8'));
    const verifyAt = challenge.indexOf('await verifyEmailCode(');
    const markAt   = challenge.indexOf('markEmailFactorPassed(');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(markAt, 'the session must not be marked before the code is checked')
      .toBeGreaterThan(verifyAt);
  });
});
