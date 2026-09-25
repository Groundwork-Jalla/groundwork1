import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isPayoutEligible, ineligibility, maskDestination, defaultDestination, payableDestinations,
  type PayoutDestination,
} from './payout-destination';

/**
 * Migration 099 — where a contractor is paid.
 *
 * The danger this guards is quiet: a table of account numbers becoming, by nobody's
 * decision, permission to send money to them. So `status` starts `unverified`, nothing in
 * the migration can change that on its own, and one function answers "may money go here".
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const sql = src('supabase/migrations/099_payout_destinations.sql');
const code = sql.replace(/^\s*--.*$/gm, '');

const D = (over: Partial<PayoutDestination> = {}): PayoutDestination => ({
  id: 'd1', ownerId: 'c1', countryCode: 'CM', method: 'mobile_money',
  mobileNo: '+237670000000', bankCode: null, accountNumber: null, accountName: null,
  status: 'unverified', isDefault: false, createdAt: '2026-09-01T00:00:00Z', verifiedAt: null, ...over,
});

describe('stored is not usable', () => {
  it('only a verified, dated destination may receive money', () => {
    expect(isPayoutEligible(D({ status: 'verified', verifiedAt: '2026-09-02T00:00:00Z' }))).toBe(true);
    expect(isPayoutEligible(D({ status: 'unverified' }))).toBe(false);
    expect(isPayoutEligible(D({ status: 'retired' }))).toBe(false);
    // `verified` with no date is not a claim anybody made. 099's CHECK makes the pair
    // inseparable in the database; this refuses it here too.
    expect(isPayoutEligible(D({ status: 'verified', verifiedAt: null }))).toBe(false);
  });

  it('the database answers the same question the same way', () => {
    expect(code).toContain('FUNCTION public.payout_destination_eligible');
    expect(code).toMatch(/status = 'verified'\s*\n\s*AND verified_at IS NOT NULL/);
  });

  it('nothing in the migration can make a row verified', () => {
    // No default, no trigger, no first-row special case — only the staff RPC.
    expect(code).toContain("status         text NOT NULL DEFAULT 'unverified'");
    expect(code).not.toMatch(/INSERT INTO public\.payout_destinations[\s\S]{0,300}'verified'/);
    const verify = code.slice(code.indexOf('FUNCTION public.verify_payout_destination'));
    expect(verify).toContain('IF NOT public.is_admin() THEN');
  });

  it('why it cannot be used is a reason, not a blank', () => {
    expect(ineligibility(D({ status: 'unverified' }))).toBe('unverified');
    expect(ineligibility(D({ status: 'retired' }))).toBe('retired');
    expect(ineligibility(D({ status: 'verified', verifiedAt: '2026-09-02T00:00:00Z' }))).toBeNull();
  });

  it('only eligible rows are offered to a payout', () => {
    const rows = [
      D({ id: 'a', status: 'verified', verifiedAt: '2026-09-02T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' }),
      D({ id: 'b', status: 'unverified' }),
      D({ id: 'c', status: 'retired' }),
      D({ id: 'd', status: 'verified', verifiedAt: '2026-09-05T00:00:00Z', createdAt: '2026-09-04T00:00:00Z' }),
    ];
    expect(payableDestinations(rows).map(d => d.id)).toEqual(['d', 'a']);
  });
});

describe('one live default per person', () => {
  it('the database enforces it, not the code path that happens to run', () => {
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS payout_destinations_one_default');
    expect(code).toMatch(/WHERE is_default = true AND status <> 'retired'/);
  });

  it('a retired row can never be the default', () => {
    expect(code).toContain('CONSTRAINT payout_destination_retired_not_default');
    expect(defaultDestination([D({ isDefault: true, status: 'retired' })])).toBeNull();
    expect(defaultDestination([D({ id: 'x', isDefault: true })])?.id).toBe('x');
    expect(defaultDestination([D({ isDefault: false })])).toBeNull();
  });

  it('the swap happens in one transaction, inside the RPC', () => {
    const add = code.slice(code.indexOf('FUNCTION public.add_payout_destination'), code.indexOf('FUNCTION public.set_default_payout_destination'));
    // The old default is stood down before the new row is written, so the unique index
    // never sees two.
    expect(add.indexOf('SET is_default = false')).toBeLessThan(add.indexOf('INSERT INTO public.payout_destinations'));
  });

  it('retiring clears the default in the same statement', () => {
    const retire = code.slice(code.indexOf('FUNCTION public.retire_payout_destination'));
    expect(retire).toMatch(/SET status = 'retired', retired_at = now\(\), is_default = false/);
  });
});

describe('a row is one method, never a blur of both', () => {
  it('the shape constraint pins each', () => {
    expect(code).toContain('CONSTRAINT payout_destination_shape');
    const shape = code.slice(code.indexOf('CONSTRAINT payout_destination_shape'), code.indexOf('CONSTRAINT payout_destination_mobile_e164'));
    // mobile: a number, and no bank fields.
    expect(shape).toMatch(/method = 'mobile_money'[\s\S]*mobile_no IS NOT NULL[\s\S]*bank_code IS NULL AND account_number IS NULL/);
    // bank: a code and an account, and no mobile.
    expect(shape).toMatch(/method = 'bank'[\s\S]*bank_code IS NOT NULL[\s\S]*account_number IS NOT NULL[\s\S]*mobile_no IS NULL/);
  });

  it('a mobile number must be reachable', () => {
    expect(code).toContain("mobile_no ~ '^\\+[0-9]{7,15}$'");
  });

  it('verified and retired each carry their timestamp', () => {
    expect(code).toContain("(status = 'verified') = (verified_at IS NOT NULL)");
    expect(code).toContain("(status = 'retired') = (retired_at IS NOT NULL)");
  });
});

describe('who may see and who may write', () => {
  it('the owner and staff read; nobody else', () => {
    expect(code).toContain('USING (owner_id = auth.uid())');
    expect(code).toContain('USING (public.is_admin())');
    // A client must never see a contractor's account number, nor one contractor another's.
    const policies = code.match(/CREATE POLICY "[^"]+" ON public\.payout_destinations\s+FOR (\w+)/g) ?? [];
    expect(policies).toHaveLength(2);
    for (const p of policies) expect(p).toMatch(/FOR SELECT$/);
  });

  it('there is no write policy at all — the RPCs are the only writers', () => {
    expect(code).not.toMatch(/ON public\.payout_destinations\s+FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(code).toContain('ALTER TABLE public.payout_destinations ENABLE ROW LEVEL SECURITY');
  });

  it('every act refuses somebody else\'s destination', () => {
    for (const fn of ['add_payout_destination', 'set_default_payout_destination', 'retire_payout_destination']) {
      const body = code.slice(code.indexOf(`FUNCTION public.${fn}`));
      expect(body.slice(0, 1400), fn).toContain('not_owner');
    }
  });

  it('verification is staff only — it is a statement that somebody checked', () => {
    const verify = code.slice(code.indexOf('FUNCTION public.verify_payout_destination'));
    expect(verify).toContain('not_admin: only staff verify a payout destination');
    expect(verify).toContain('verified_by = v_actor');
  });

  it('anon can execute none of them', () => {
    for (const fn of ['add_payout_destination', 'set_default_payout_destination', 'retire_payout_destination', 'verify_payout_destination', 'payout_destination_eligible']) {
      expect(code, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^;]*FROM PUBLIC, anon`));
    }
  });
});

describe('the numbers stay out of the log and off the screen', () => {
  it('audit records what changed, never what it changed to', () => {
    const logs = code.match(/log_activity\([\s\S]{0,400}?\);/g) ?? [];
    expect(logs.length).toBeGreaterThanOrEqual(4);
    for (const l of logs) {
      for (const secret of ['mobile_no', 'account_number', 'p_mobile', 'p_account_number', 'bank_code']) {
        expect(l, `${secret} must not reach the audit log`).not.toContain(secret);
      }
    }
  });

  it('masking shows enough to recognise, not enough to steal', () => {
    expect(maskDestination(D({ method: 'mobile_money', mobileNo: '+237670000123' }))).toBe('+237 ••••••123');
    expect(maskDestination(D({ method: 'bank', mobileNo: null, bankCode: '011', accountNumber: '0123456789' }))).toBe('011 · ••••••6789');
  });

  it('a value too short to mask is hidden entirely', () => {
    expect(maskDestination(D({ method: 'mobile_money', mobileNo: '+123' }))).toBe('•••');
    expect(maskDestination(D({ method: 'bank', mobileNo: null, bankCode: '011', accountNumber: '12' }))).toBe('•••');
    expect(maskDestination(D({ method: 'bank', mobileNo: null, bankCode: null, accountNumber: null }))).toBe('•••');
  });

  it('masking is presentation — the provider layer never reads it', () => {
    for (const f of ['api/swychr/_client.ts', 'api/_handlers/swychr-poll.ts']) {
      expect(src(f), f).not.toContain('maskDestination');
    }
  });
});

describe('it changes nothing else', () => {
  it('no primary contractor in this migration', () => {
    expect(code).not.toContain('primary_contractor');
    expect(code).not.toContain('contractor_invites');
  });

  it('no release approval, no OTP, no payout call', () => {
    for (const untouched of ['email_otp_challenges', 'payment_release_requests', 'authorise_release', 'stage_release_blocker', 'record_payment_event']) {
      expect(code, untouched).not.toContain(untouched);
    }
  });

  it('re-applying it is safe', () => {
    expect(code).toContain('CREATE TABLE IF NOT EXISTS public.payout_destinations');
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(code).toContain('DROP POLICY IF EXISTS');
    for (const fn of ['add_payout_destination', 'verify_payout_destination']) {
      expect(code, fn).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
  });

  it('ships with a rollback', () => {
    expect(sql).toContain('DROP TABLE IF EXISTS public.payout_destinations;');
  });
});
