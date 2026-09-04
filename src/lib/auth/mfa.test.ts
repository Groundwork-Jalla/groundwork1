import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The parts of the MFA wrapper that are decisions rather than passthrough.
 *
 * Most of `mfa.ts` hands straight to `supabase.auth.mfa` and testing that would only
 * assert the mocks. These are the four places it does NOT, and each one fails silently
 * in a different direction:
 *
 *   · challengeRequired() decides whether ANYONE is asked for a code. Wrong in one
 *     direction it lets a stolen password walk past 2FA; wrong in the other it locks the
 *     whole product behind a factor nobody has.
 *   · getMfaStatus() decides whether the profile says "On". An unverified factor
 *     counting as enabled would tell someone they are protected when they are not.
 *   · clearUnverified() is what makes a SECOND enrolment attempt possible at all.
 *   · verifyCode() normalises what people paste.
 */

const h = vi.hoisted(() => ({
  calls:   [] as string[],
  factors: { data: null as unknown, error: null as unknown },
  aal:     { data: null as unknown, error: null as unknown },
  enroll:  { data: null as unknown, error: null as unknown },
  verify:  { data: {} as unknown, error: null as unknown },
  unenroll:{ error: null as unknown },
  lastVerifyArgs: null as any,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      mfa: {
        listFactors: async () => { h.calls.push('listFactors'); return h.factors; },
        getAuthenticatorAssuranceLevel: async () => {
          h.calls.push('getAAL');
          if (h.aal.error) throw_if_asked();
          return h.aal;
        },
        enroll: async (args: any) => { h.calls.push(`enroll:${args.factorType}`); return h.enroll; },
        challengeAndVerify: async (args: any) => {
          h.calls.push('challengeAndVerify');
          h.lastVerifyArgs = args;
          return h.verify;
        },
        unenroll: async (args: any) => { h.calls.push(`unenroll:${args.factorId}`); return h.unenroll; },
      },
    },
  },
}));

/** Lets a test make getAuthenticatorAssuranceLevel throw rather than return an error. */
let shouldThrow = false;
function throw_if_asked() { if (shouldThrow) throw new Error('network'); }

import {
  challengeRequired, getMfaStatus, enrollTotp, verifyCode, verifiedFactorId, disableTotp,
} from './mfa';

const totpVerified   = { id: 'f_ok',   factor_type: 'totp',  status: 'verified'   };
const totpUnverified = { id: 'f_half', factor_type: 'totp',  status: 'unverified' };
const phoneVerified  = { id: 'f_sms',  factor_type: 'phone', status: 'verified'   };

beforeEach(() => {
  h.calls.length = 0;
  h.factors  = { data: { all: [] }, error: null };
  h.aal      = { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null };
  h.enroll   = { data: null, error: null };
  h.verify   = { data: {}, error: null };
  h.unenroll = { error: null };
  h.lastVerifyArgs = null;
  shouldThrow = false;
});

describe('challengeRequired', () => {
  it('asks for a code when the account has a factor this session has not used', () => {
    h.aal = { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null };
    return expect(challengeRequired()).resolves.toBe(true);
  });

  it('does not ask when the account has no second factor', () => {
    h.aal = { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null };
    return expect(challengeRequired()).resolves.toBe(false);
  });

  it('does not ask again once the session has already passed', () => {
    // Otherwise the challenge screen would reappear forever after a correct code.
    h.aal = { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null };
    return expect(challengeRequired()).resolves.toBe(false);
  });

  it('treats a null currentLevel as not yet satisfied', () => {
    h.aal = { data: { currentLevel: null, nextLevel: 'aal2' }, error: null };
    return expect(challengeRequired()).resolves.toBe(true);
  });

  it('fails open when the AAL lookup errors', async () => {
    // This runs on the login path. A failed lookup must not be able to lock every user
    // out of the product — the worst case of answering "no" is the behaviour that
    // existed before 2FA shipped.
    h.aal = { data: null, error: { message: 'boom' } };
    expect(await challengeRequired()).toBe(false);
  });

  it('fails open when the AAL lookup throws', async () => {
    shouldThrow = true;
    expect(await challengeRequired()).toBe(false);
  });
});

describe('getMfaStatus', () => {
  it('reports enabled for a verified TOTP factor', async () => {
    h.factors = { data: { all: [totpVerified] }, error: null };
    h.aal = { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null };
    const s = await getMfaStatus();
    expect(s.enabled).toBe(true);
    expect(s.factor?.id).toBe('f_ok');
    expect(s.challengeRequired).toBe(false);
  });

  it('does NOT report enabled for an abandoned, unverified factor', async () => {
    // The dangerous one: telling somebody their account is protected when the factor was
    // never confirmed and raises nobody's assurance level.
    h.factors = { data: { all: [totpUnverified] }, error: null };
    const s = await getMfaStatus();
    expect(s.enabled).toBe(false);
    expect(s.factor).toBeNull();
  });

  it('ignores a phone factor — this build is TOTP only', async () => {
    h.factors = { data: { all: [phoneVerified] }, error: null };
    expect((await getMfaStatus()).enabled).toBe(false);
  });

  it('picks the verified factor out of a mixed list', async () => {
    h.factors = { data: { all: [totpUnverified, phoneVerified, totpVerified] }, error: null };
    expect((await getMfaStatus()).factor?.id).toBe('f_ok');
  });

  it('surfaces a challenge still owed', async () => {
    h.factors = { data: { all: [totpVerified] }, error: null };
    h.aal = { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null };
    const s = await getMfaStatus();
    expect(s.challengeRequired).toBe(true);
    expect(s.satisfied).toBe(false);
  });

  it('throws when factors cannot be listed at all', async () => {
    // MFA disabled at the project level answers this way. The panel says so rather than
    // rendering an empty box that reads as a bug in the page.
    h.factors = { data: null, error: { message: 'MFA is not enabled' } };
    await expect(getMfaStatus()).rejects.toBeTruthy();
  });
});

describe('enrollTotp', () => {
  it('sweeps abandoned factors before enrolling', async () => {
    // Without this, closing the setup dialog once leaves an unverified factor holding the
    // friendly name, and every later attempt fails on the duplicate — so a user who
    // backed out could never turn 2FA on again.
    h.factors = { data: { all: [totpUnverified] }, error: null };
    h.enroll = { data: { id: 'f_new', type: 'totp', totp: { qr_code: 'data:image/svg+xml,x', secret: 'S3CRET' } }, error: null };

    await enrollTotp();

    expect(h.calls.indexOf('unenroll:f_half')).toBeGreaterThan(-1);
    expect(h.calls.indexOf('unenroll:f_half')).toBeLessThan(h.calls.indexOf('enroll:totp'));
  });

  it('never sweeps a verified factor', async () => {
    h.factors = { data: { all: [totpVerified] }, error: null };
    h.enroll = { data: { id: 'f_new', type: 'totp', totp: { qr_code: 'q', secret: 's' } }, error: null };
    await enrollTotp();
    expect(h.calls.some(c => c.startsWith('unenroll:'))).toBe(false);
  });

  it('returns the QR and the secret', async () => {
    h.enroll = { data: { id: 'f_new', type: 'totp', totp: { qr_code: 'data:image/svg+xml,QR', secret: 'S3CRET' } }, error: null };
    expect(await enrollTotp()).toEqual({ factorId: 'f_new', qrCode: 'data:image/svg+xml,QR', secret: 'S3CRET' });
  });

  it('refuses a non-TOTP factor rather than reading totp off it', async () => {
    h.enroll = { data: { id: 'f_p', type: 'phone' }, error: null };
    await expect(enrollTotp()).rejects.toThrow(/TOTP/);
  });

  it('propagates an enrolment refusal', async () => {
    h.enroll = { data: null, error: { message: 'factor limit reached' } };
    await expect(enrollTotp()).rejects.toBeTruthy();
  });
});

describe('verifyCode', () => {
  it('strips whatever the authenticator app put around the digits', async () => {
    // Codes get pasted as "123 456" from a phone. Sending that verbatim is a wrong code.
    await verifyCode('f_ok', '123 456');
    expect(h.lastVerifyArgs).toEqual({ factorId: 'f_ok', code: '123456' });
  });

  it('uses challengeAndVerify, not a separate challenge', async () => {
    // One round trip: a separate challenge() can be left dangling if the tab closes.
    await verifyCode('f_ok', '000000');
    expect(h.calls).toContain('challengeAndVerify');
  });

  it('propagates a rejected code', async () => {
    h.verify = { data: null, error: { message: 'Invalid TOTP code entered' } };
    await expect(verifyCode('f_ok', '111111')).rejects.toBeTruthy();
  });
});

describe('verifiedFactorId', () => {
  it('finds the factor a login challenge answers against', async () => {
    h.factors = { data: { all: [totpUnverified, totpVerified] }, error: null };
    expect(await verifiedFactorId()).toBe('f_ok');
  });

  it('is null when listing fails, rather than throwing on the login path', async () => {
    h.factors = { data: null, error: { message: 'boom' } };
    expect(await verifiedFactorId()).toBeNull();
  });

  it('is null when only an unverified factor exists', async () => {
    h.factors = { data: { all: [totpUnverified] }, error: null };
    expect(await verifiedFactorId()).toBeNull();
  });
});

describe('disableTotp', () => {
  it('surfaces the refusal when the session has not cleared its factor', async () => {
    // Supabase requires aal2 to unenroll, which is the right rule: a stolen session that
    // never passed the second factor must not be able to remove it. The UI shows this
    // rather than a button that silently does nothing.
    h.unenroll = { error: { message: 'AAL2 required to unenroll' } };
    await expect(disableTotp('f_ok')).rejects.toBeTruthy();
  });

  it('unenrolls the given factor', async () => {
    await disableTotp('f_ok');
    expect(h.calls).toContain('unenroll:f_ok');
  });
});
