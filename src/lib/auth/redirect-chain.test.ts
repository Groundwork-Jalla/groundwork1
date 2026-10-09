import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PENDING_REDIRECT, isSafeInternalPath, postAuthPath, signupHref } from './post-auth-path';

/**
 * A tester sent to /verifiers with no account was bounced to sign-in, clicked "Sign up",
 * and landed on a bare client sign-up that had forgotten where they were going. They read
 * that as "it resets" and stopped.
 *
 * The destination now survives three hops, each of which loses something the one before it
 * had:
 *
 *   1. /auth/login?redirect=… → the sign-up link       (a URL the component builds)
 *   2. /auth/signup?redirect=… → localStorage          (sign-up ends on "check your email")
 *   3. /auth/callback → postAuthPath                   (a DIFFERENT TAB; no URL to read)
 *
 * Hop 1 is a pure function and is tested as one. Hops 2 and 3 live inside route components
 * whose behaviour only appears in a browser, so what is pinned there is the shape that
 * makes them safe: written only after a safety check, taken once, cleared, and re-checked
 * on the way out.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments explain these very properties, so a scan of them proves nothing. */
const stripComments = (src: string) =>
  src.split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

describe('hop 1 — the sign-up link carries the destination', () => {
  it('passes a safe internal path through', () => {
    expect(signupHref({ redirect: '/verifiers' })).toBe('/auth/signup?redirect=%2Fverifiers');
    expect(signupHref({ redirect: '/work/projects/abc' })).toBe('/auth/signup?redirect=%2Fwork%2Fprojects%2Fabc');
  });

  it('carries an invite token, and both together', () => {
    expect(signupHref({ invite: 'tok123' })).toBe('/auth/signup?invite=tok123');
    expect(signupHref({ redirect: '/work', invite: 'tok123' }))
      .toBe('/auth/signup?redirect=%2Fwork&invite=tok123');
  });

  it('is the bare sign-up page when there is nothing to carry', () => {
    expect(signupHref({})).toBe('/auth/signup');
    expect(signupHref({ redirect: null, invite: null })).toBe('/auth/signup');
    expect(signupHref({ redirect: '', invite: '' })).toBe('/auth/signup');
  });

  it('drops an off-site destination instead of forwarding it', () => {
    // Dropped at the first hop, so no later hop has to decide whether to trust it.
    for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', 'work']) {
      expect(signupHref({ redirect: bad })).toBe('/auth/signup');
    }
  });

  it('encodes a query of its own rather than letting it merge into the outer one', () => {
    // A redirect with its own ?stage=2 must not arrive at sign-up as a sibling parameter.
    const href = signupHref({ redirect: '/work/projects/abc?stage=2' });
    expect(href).toBe('/auth/signup?redirect=%2Fwork%2Fprojects%2Fabc%3Fstage%3D2');
    expect(new URLSearchParams(href.split('?')[1]).get('redirect')).toBe('/work/projects/abc?stage=2');
  });
});

describe('hop 2 — sign-up parks it for the other tab', () => {
  const code = stripComments(read('src/app/routes/auth/signup.tsx'));

  it('writes the parked destination only after the safety check', () => {
    expect(code).toMatch(/isSafeInternalPath\(wanted\)\s*&&?\s*localStorage\.setItem\(PENDING_REDIRECT|if \(isSafeInternalPath\(wanted\)\) localStorage\.setItem\(PENDING_REDIRECT, wanted\)/);
    // Never the raw parameter: the check is what makes the stored value worth reading back.
    expect(code).not.toMatch(/setItem\(PENDING_REDIRECT,\s*searchParams\.get/);
  });

  it('uses the shared key rather than a second spelling of it', () => {
    expect(code).toMatch(/PENDING_REDIRECT/);
    expect(code).not.toMatch(/['"]pendingRedirect['"]/);
  });
});

describe('hop 3 — the callback spends it once', () => {
  const code = stripComments(read('src/app/routes/auth/callback.tsx'));

  it('removes the parked value in the same breath as reading it', () => {
    const got = code.indexOf('getItem(PENDING_REDIRECT)');
    const gone = code.indexOf('removeItem(PENDING_REDIRECT)');
    expect(got).toBeGreaterThan(-1);
    expect(gone).toBeGreaterThan(got);
    // Cleared before the navigation it feeds, so a failed landing cannot leave a value
    // behind to hijack an unrelated sign-in later.
    expect(code.indexOf('redirect: wanted')).toBeGreaterThan(gone);
  });

  it('survives storage being unavailable instead of failing the sign-in', () => {
    // Private mode throws on getItem. A missing destination is a worse landing page, not
    // a broken sign-in.
    //
    // The catch has to be the one enclosing the read. A looser pattern matched an earlier
    // try block in this same file and went on passing with the guard deleted, so the path
    // from `try {` to the read, and on to `} catch`, must cross no other `} catch`.
    expect(code).toMatch(/try \{(?:(?!\} catch)[\s\S])*?getItem\(PENDING_REDIRECT\)(?:(?!\} catch)[\s\S])*?\} catch/);
  });

  it('hands it to postAuthPath, which checks it again', () => {
    expect(code).toMatch(/postAuthPath\(\{[^}]*redirect: wanted/);
  });
});

describe('the far end — what postAuthPath does with a parked value', () => {
  const done = { onboardingComplete: true };

  it('honours it over the role surface it would otherwise choose', () => {
    expect(postAuthPath({ isVerifier: true, redirect: '/verifiers/stages/abc', ...done }))
      .toBe('/verifiers/stages/abc');
    expect(postAuthPath({ isAdmin: true, redirect: '/work', ...done })).toBe('/work');
  });

  it('refuses a value that reached storage by some other route', () => {
    // The stored string is re-checked here, so a value written by anything other than
    // hop 2 still cannot send a signed-in user off-site.
    expect(postAuthPath({ isVerifier: true, redirect: '//evil.example', ...done })).toBe('/verifiers');
    expect(postAuthPath({ isVerifier: true, redirect: 'https://evil.example', ...done })).toBe('/verifiers');
  });

  it('falls back to the role surface when nothing was parked', () => {
    expect(postAuthPath({ isVerifier: true, redirect: null, ...done })).toBe('/verifiers');
    expect(postAuthPath({ isContractor: true, redirect: '', ...done })).toBe('/work');
    expect(postAuthPath({ ...done })).toBe('/dashboard');
  });

  it('sends an unfinished client to onboarding, but not away from a deep link they asked for', () => {
    expect(postAuthPath({ onboardingComplete: false })).toBe('/onboarding');
    expect(postAuthPath({ onboardingComplete: false, redirect: '/projects/abc' })).toBe('/projects/abc');
  });
});

describe('the key itself', () => {
  it('is the one string both tabs agree on', () => {
    expect(PENDING_REDIRECT).toBe('pendingRedirect');
  });

  it('guards the shapes that matter', () => {
    expect(isSafeInternalPath('/work')).toBe(true);
    expect(isSafeInternalPath('//evil.example')).toBe(false);
    expect(isSafeInternalPath('https://evil.example')).toBe(false);
    expect(isSafeInternalPath('')).toBe(false);
    expect(isSafeInternalPath(null)).toBe(false);
    expect(isSafeInternalPath(undefined)).toBe(false);
  });
});
