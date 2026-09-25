import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ledgerLine } from './finance-ledger';
import type { Payment } from '@/lib/supabase/payments';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Migration 098 — when a payout entered processing.
 *
 * Before it, a row in `initiated` fell back to `authorised_at` and read "Approved 25 Sep ·
 * Processing": two true facts whose combination is misleading, because the date a person
 * takes from that line is the approval. The point of the column is that the date and the
 * status finally describe the same event — and that when the moment is genuinely unknown,
 * nothing is shown at all.
 *
 * Proven against PostgreSQL 16 with all 99 migrations: the initiated transition sets it,
 * a later failed transition preserves it, a direct write to it is refused (set or
 * cleared), an unrelated update on the same row still succeeds, and the backfill finds
 * its evidence in the `payment.initiated` audit row.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const sql = src('supabase/migrations/098_payment_initiated_at.sql');
const code = sql.replace(/^\s*--.*$/gm, '');

const P = (over: Partial<Payment>): Payment => ({
  id: 'p1', projectId: 'j1', stageId: null, direction: 'out', state: 'initiated', amount: 100,
  currency: 'USD', beneficiaryId: 'abc', fundingSource: null,
  confirmedBy: null, confirmedAt: null, authorisedBy: 'staff', authorisedAt: '2026-09-25T10:00:00Z',
  initiatedAt: null, note: null, provider: 'swychr', providerRef: 'tx1',
  failureReason: null, settledAt: null,
  createdAt: '2026-09-25T09:00:00Z', updatedAt: '2026-09-27T00:00:00Z', ...over,
});
const line = (p: Partial<Payment>) => ledgerLine(P(p), {
  projectName: () => 'P', ownerOf: () => 'mary', nameOf: () => 'Name', stageOf: () => null,
});

describe('one writer, once', () => {
  it('only the initiated transition sets it', () => {
    expect(code).toContain("initiated_at    = CASE WHEN v_next = 'initiated' THEN COALESCE(initiated_at, now()) ELSE initiated_at END");
  });

  it('COALESCE is what makes it write-once', () => {
    expect(code).toMatch(/COALESCE\(initiated_at, now\(\)\)/);
  });

  it('it lives in record_payment_event, the only thing 090 lets move a state', () => {
    expect(code).toContain('FUNCTION public.record_payment_event');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.record_payment_event');
  });

  it('nothing in the application writes it', () => {
    for (const f of [
      'src/lib/supabase/payments.ts', 'src/lib/supabase/finance-ledger.ts',
      'api/_handlers/swychr-poll.ts', 'api/_handlers/swychr-callback.ts',
    ]) {
      expect(src(f), `${f} must not set initiated_at`).not.toMatch(/initiated_at\s*[:=]\s*(now|new Date)/);
    }
  });
});

describe('it never changes once recorded', () => {
  it('a guard refuses any later value, including null', () => {
    expect(code).toContain('IF OLD.initiated_at IS NOT NULL AND NEW.initiated_at IS DISTINCT FROM OLD.initiated_at THEN');
    expect(code).toContain('immutable: initiated_at is recorded once and does not change');
    // `IS DISTINCT FROM` so clearing it to NULL is caught too, not just replacing it.
    expect(code).not.toMatch(/NEW\.initiated_at <> OLD\.initiated_at/);
  });

  it('the guard runs before the write', () => {
    expect(code).toContain('BEFORE UPDATE ON public.payments');
    expect(code).toContain('trg_payments_initiated_at');
  });
});

describe('unknown stays unknown', () => {
  it('the backfill reads the audit row and nothing else', () => {
    expect(code).toContain("WHERE a.action = 'payment.initiated'");
    expect(code).toContain("AND a.entity_type = 'payment'");
    expect(code).toContain('min(a.created_at) AS first_initiated');
    expect(code).toContain('AND p.initiated_at IS NULL');
  });

  it('no nearby timestamp is borrowed', () => {
    const backfill = code.slice(code.indexOf('WITH evidence'), code.indexOf('-- ── Verify'));
    for (const nearby of ['authorised_at', 'created_at AS', 'updated_at', 'settled_at']) {
      expect(backfill, `${nearby} is nearby, not the fact`).not.toContain(nearby);
    }
  });

  it('the verify block counts what stayed unknown rather than hiding it', () => {
    expect(sql).toContain("state = 'initiated' AND initiated_at IS NULL");
  });
});

describe('it is not, and must not be read as, a freshness signal', () => {
  it('the migration says so in terms', () => {
    expect(sql).toMatch(/Not "last checked"/);
    expect(sql).toMatch(/deduplicated/);
  });

  it('no screen calls it last-checked', () => {
    for (const f of ['src/app/routes/admin/finance.tsx', 'src/components/admin/FinanceLedger.tsx', 'src/lib/admin/finance-ledger.ts']) {
      expect(src(f).toLowerCase(), f).not.toContain('last checked');
      expect(src(f).toLowerCase(), f).not.toContain('lastchecked');
    }
  });
});

describe('the date and the status now describe the same event', () => {
  it('a processing payout is dated by when it started processing', () => {
    const l = line({ state: 'initiated', initiatedAt: '2026-09-27T08:00:00Z' });
    expect(l.atMeans).toBe('processing');
    expect(l.at).toBe('2026-09-27T08:00:00Z');
  });

  it('with no recorded moment it falls back, and says what that date means', () => {
    // The honest outcome for a pre-098 row: a status without a processing date, never an
    // approval date wearing the word "Processing since".
    const l = line({ state: 'initiated', initiatedAt: null });
    expect(l.atMeans).toBe('authorised');
    expect(l.at).toBe('2026-09-25T10:00:00Z');
  });

  it('an approved release still uses authorised_at', () => {
    expect(line({ state: 'release_authorised' }).atMeans).toBe('authorised');
  });

  it('a paid one still uses settled_at', () => {
    const l = line({ state: 'disbursed', settledAt: '2026-09-28T00:00:00Z', initiatedAt: '2026-09-27T00:00:00Z' });
    expect(l.atMeans).toBe('settled');
    expect(l.at).toBe('2026-09-28T00:00:00Z');
  });

  it('a payout that failed is not "processing since" — it has left that state', () => {
    const l = line({ state: 'failed', initiatedAt: '2026-09-27T00:00:00Z', failureReason: 'network' });
    expect(l.atMeans).toBe('authorised');
  });

  it('the label reads as a duration, in both languages', () => {
    expect(lookup(en, 'admin.finance.at.processing')).toBe('Processing since {date}');
    expect(lookup(fr, 'admin.finance.at.processing')).toBeTypeOf('string');
    expect(lookup(en, 'admin.finance.at.processing')).not.toBe(lookup(fr, 'admin.finance.at.processing'));
    // And it is still distinct from the other three.
    for (const k of ['settled', 'authorised', 'confirmed']) {
      expect(lookup(en, 'admin.finance.at.processing')).not.toBe(lookup(en, `admin.finance.at.${k}`));
    }
  });
});

describe('the column travels intact', () => {
  it('it is selected and mapped, not dropped on the way', () => {
    const payments = src('src/lib/supabase/payments.ts');
    expect(payments).toContain('initiated_at');
    expect(payments).toContain('initiatedAt:   (r.initiated_at as string | null) ?? null');
  });

  it('a ledger line carries it', () => {
    expect(line({ initiatedAt: '2026-09-27T00:00:00Z' }).initiatedAt).toBe('2026-09-27T00:00:00Z');
    expect(line({ initiatedAt: null }).initiatedAt).toBeNull();
  });

  it('classification and totals are untouched by this migration', () => {
    const fin = src('src/lib/admin/finance-ledger.ts');
    const totals = fin.slice(fin.indexOf('export function totalsFor'));
    expect(totals).not.toContain('initiatedAt');
  });

  it('ships with a rollback', () => {
    expect(sql).toContain('ALTER TABLE public.payments DROP COLUMN initiated_at;');
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_payments_initiated_at');
    expect(sql).toContain('Restore record_payment_event() from 090.');
  });
});
