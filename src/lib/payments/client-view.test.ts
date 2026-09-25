import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  totals, fundingRow, releaseRows, fundingLabel, releaseLabel, nextPayment, activity,
} from './client-view';
import type { Payment } from '@/lib/supabase/payments';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * The client's Payments tab, from the ledger.
 *
 * What it replaces was not a reading of anything: `EscrowWallet` computed
 * `budget_usd − milestones marked paid` and presented the result as an escrow balance.
 * Groundwork records and governs; it does not hold funds. So the pins here are about the
 * two ways this screen could lie — showing money that is not there, and showing an
 * authorised decision as a completed payment.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const screen = code('src/components/project/ProjectPaymentsLedger.tsx');
const pure   = code('src/lib/payments/client-view.ts');
const detail = code('src/app/routes/projects/detail.tsx');

const P = (over: Partial<Payment>): Payment => ({
  id: 'p1', projectId: 'j1', stageId: 's1', direction: 'in', state: 'funded', amount: 100,
  currency: 'USD', beneficiaryId: null, fundingSource: 'staff_confirmed',
  confirmedBy: null, confirmedAt: null, authorisedBy: null, authorisedAt: null, initiatedAt: null, note: null,
  provider: null, providerRef: null, failureReason: null, settledAt: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
const stage = (n: number, id: string, milestone: number | null = 1000) =>
  ({ id, stage_number: n, payment_milestone_usd: milestone });

describe('the four figures come from the ledger and nowhere else', () => {
  const rows = [
    P({ id: 'a', direction: 'in',  state: 'funded',     amount: 50_000 }),
    P({ id: 'b', direction: 'in',  state: 'reconciled', amount: 22_000 }),
    P({ id: 'c', direction: 'in',  state: 'expected',   amount: 18_500 }),
    P({ id: 'd', direction: 'out', state: 'disbursed',  amount: 28_000 }),
    P({ id: 'e', direction: 'out', state: 'release_authorised', amount: 16_000 }),
    P({ id: 'f', direction: 'out', state: 'failed',     amount:  9_000 }),
  ];

  it('funded counts only money whose receipt was established', () => {
    expect(totals(rows)!.funded).toBe(72_000);      // expected is not funding
  });

  it('paid counts only what the provider reported as moved', () => {
    expect(totals(rows)!.disbursed).toBe(28_000);
  });

  it('approved is the decision, and is counted apart from paid', () => {
    expect(totals(rows)!.approved).toBe(16_000);
    // A failed release is money that never left; it is in neither figure.
    expect(totals(rows)!.approved).not.toContain?.(9_000);
  });

  it('an authorised release reduces what is available', () => {
    // 72,000 − (28,000 disbursed + 16,000 authorised). Without the second term the same
    // money would read as spendable twice.
    expect(totals(rows)!.available).toBe(28_000);
  });

  it('an unreadable ledger is null, never a column of zeroes', () => {
    expect(totals(null)).toBeNull();
    expect(screen).toContain('rows === null || !sums');
    expect(screen).toContain('project.pay.unavailable');
    // An empty-but-readable ledger is a real zero, which is different.
    expect(totals([])!.funded).toBe(0);
  });

  it('reuses the admin helper rather than a second arithmetic', () => {
    expect(pure).toContain('availableFunds(rows)');
  });
});

describe('budget is not money', () => {
  it('the screen never reads budget_usd', () => {
    expect(screen).not.toContain('budget_usd');
    expect(pure).not.toContain('budget_usd');
  });

  it('no escrow or wallet language survives in the client path', () => {
    for (const banned of ['escrow', 'Escrow', 'wallet', 'Wallet', 'balance', 'Balance', 'platform fee']) {
      expect(screen, `${banned} must not appear`).not.toContain(banned);
    }
    expect(detail).not.toContain('EscrowWallet');
    // And the retired component is no longer on the client's route.
    expect(detail).toContain('ProjectPaymentsLedger');
    expect(detail).not.toMatch(/from '@\/components\/project\/ProjectPayments'/);
  });
});

describe('funding and release are read from their own rows', () => {
  it('funding comes from the incoming row only', () => {
    const rows = [P({ direction: 'in', state: 'expected', stageId: 's1' })];
    expect(fundingLabel(fundingRow(rows, 's1'), stage(1, 's1'))).toBe('awaiting');
    expect(fundingLabel(fundingRow([P({ direction: 'in', state: 'funded', stageId: 's1' })], 's1'), stage(1, 's1'))).toBe('confirmed');
    expect(fundingLabel(fundingRow([P({ direction: 'in', state: 'reconciled', stageId: 's1' })], 's1'), stage(1, 's1'))).toBe('confirmed');
  });

  it('a stage with no milestone is "not scheduled", never zero funding', () => {
    expect(fundingLabel(null, stage(1, 's1', null))).toBe('notScheduled');
    expect(fundingLabel(null, stage(1, 's1', 0))).toBe('notScheduled');
    // A milestone with no row yet is still awaiting.
    expect(fundingLabel(null, stage(1, 's1', 5000))).toBe('awaiting');
  });

  it('release comes from the outgoing rows only, worst state first', () => {
    const at = (state: Payment['state']) => [P({ direction: 'out', state, stageId: 's1' })];
    expect(releaseLabel([])).toBe('none');
    expect(releaseLabel(at('release_authorised'))).toBe('approved');
    expect(releaseLabel(at('initiated'))).toBe('processing');
    expect(releaseLabel(at('disbursed'))).toBe('paid');
    expect(releaseLabel(at('failed'))).toBe('issue');
    expect(releaseLabel(at('reconciling'))).toBe('review');
    // A stage with an old paid release and a new failed one is not "paid".
    expect(releaseLabel([
      P({ id: 'x', direction: 'out', state: 'disbursed' }),
      P({ id: 'y', direction: 'out', state: 'failed' }),
    ])).toBe('issue');
  });

  it('approved is never labelled paid', () => {
    expect(lookup(en, 'project.pay.releaseApproved')).toBe('Release approved');
    expect(lookup(en, 'project.pay.cardApprovedNote')).toBe('Not yet paid');
    expect(String(lookup(en, 'project.pay.releaseApproved'))).not.toMatch(/paid/i);
  });

  it('incoming and outgoing are never mixed up', () => {
    const mixed = [
      P({ id: 'in',  direction: 'in',  state: 'funded',    stageId: 's1' }),
      P({ id: 'out', direction: 'out', state: 'disbursed', stageId: 's1' }),
    ];
    expect(fundingRow(mixed, 's1')!.id).toBe('in');
    expect(releaseRows(mixed, 's1').map(r => r.id)).toEqual(['out']);
  });
});

describe('the legacy projection drives nothing', () => {
  it('payment_status is not read by the new screen or its derivation', () => {
    expect(screen).not.toContain('payment_status');
    expect(pure).not.toContain('payment_status');
  });
});

describe('next payment follows construction order', () => {
  const stages = [stage(1, 's1'), stage(2, 's2'), stage(3, 's3'), stage(4, 's4')];

  it('picks the earliest STAGE awaiting funding, not the earliest row written', () => {
    const rows = [
      // Stage 4's tranche was written first; stage 3's is the one that is due.
      P({ id: 'r4', direction: 'in', state: 'expected', stageId: 's4', amount: 12_000, createdAt: '2026-01-01T00:00:00Z' }),
      P({ id: 'r3', direction: 'in', state: 'expected', stageId: 's3', amount: 18_500, createdAt: '2026-06-01T00:00:00Z' }),
      P({ id: 'r1', direction: 'in', state: 'funded',   stageId: 's1' }),
      P({ id: 'r2', direction: 'in', state: 'funded',   stageId: 's2' }),
    ];
    const got = nextPayment(rows, stages);
    expect(got.kind).toBe('due');
    if (got.kind !== 'due') throw new Error('unreachable');
    expect(got.stage.id).toBe('s3');
    expect(got.amount).toBe(18_500);
  });

  it('no milestones anywhere is its own state, not $0 due', () => {
    expect(nextPayment([], [stage(1, 's1', null), stage(2, 's2', 0)]).kind).toBe('noMilestones');
    expect(String(lookup(en, 'project.pay.noMilestones'))).toMatch(/No funding milestones/i);
  });

  it('everything funded is its own state, not $0 due', () => {
    const rows = stages.map((s, i) => P({ id: `f${i}`, direction: 'in', state: 'funded', stageId: s.id }));
    expect(nextPayment(rows, stages).kind).toBe('allFunded');
    expect(String(lookup(en, 'project.pay.allFunded'))).toMatch(/All currently scheduled/i);
  });

  it('neither empty state shows an amount', () => {
    for (const key of ['project.pay.noMilestones', 'project.pay.allFunded']) {
      expect(String(lookup(en, key)), key).not.toMatch(/\$|0\b/);
    }
  });
});

describe('reporting a payment changes no money', () => {
  it('it notifies staff and nothing else', () => {
    expect(screen).toContain('notifyAdmins');
    for (const banned of ['confirmFunding', 'confirm_funding', 'authoriseRelease', 'authorise_release', '.insert(', '.update(', '.rpc(']) {
      expect(screen, `${banned} would let a client move their own ledger`).not.toContain(banned);
    }
  });

  it('090 gives the ledger SELECT policies only', () => {
    const ddl = src('supabase/migrations/090_payments_ledger.sql');
    const policies = ddl.match(/CREATE POLICY "[^"]+" ON public\.(payments|payment_events) FOR (\w+)/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) expect(p).toMatch(/FOR SELECT$/);
  });
});

describe('activity is built from payment rows, never provider events', () => {
  it('each row contributes the event its state represents, with the ledger\'s own timestamp', () => {
    const rows = [
      P({ id: 'a', direction: 'in',  state: 'funded',    amount: 18_000, confirmedAt: '2026-09-22T00:00:00Z' }),
      P({ id: 'b', direction: 'out', state: 'release_authorised', amount: 16_000, authorisedAt: '2026-09-23T00:00:00Z' }),
      P({ id: 'c', direction: 'out', state: 'disbursed', amount: 20_000, authorisedAt: '2026-09-17T00:00:00Z', settledAt: '2026-09-18T00:00:00Z' }),
      P({ id: 'd', direction: 'in',  state: 'expected',  amount: 12_000 }),
    ];
    const feed = activity(rows);
    // `expected` is not an event — nothing has happened yet.
    expect(feed.map(f => f.key)).toEqual(['b', 'a', 'c']);
    expect(feed.find(f => f.key === 'c')!.at).toBe('2026-09-18T00:00:00Z');   // settled, not authorised
    expect(feed.find(f => f.key === 'a')!.kind).toBe('funded');
  });

  it('a row with no timestamp sinks rather than claiming to be recent', () => {
    const feed = activity([
      P({ id: 'dated',   direction: 'in', state: 'funded', confirmedAt: '2026-09-01T00:00:00Z' }),
      P({ id: 'undated', direction: 'in', state: 'funded', confirmedAt: null }),
    ]);
    expect(feed.map(f => f.key)).toEqual(['dated', 'undated']);
    expect(feed[1].at).toBeNull();
  });

  it('payment_events are never read by the client', () => {
    expect(screen).not.toContain('listPaymentEvents');
    expect(screen).not.toContain('payment_events');
    expect(pure).not.toContain('payment_events');
    for (const banned of ['providerPayload', 'provider_payload', 'providerRef', 'provider_ref', 'providerStatus']) {
      expect(screen, `${banned} is internal`).not.toContain(banned);
    }
  });
});

describe('fees are a separate domain', () => {
  it('rendered apart, and summed into nothing', () => {
    expect(screen).toContain('fetchProjectFees');
    expect(screen).toContain('project.pay.feesTitle');
    // The four card figures come from `sums`, which only ever sees payment rows.
    expect(pure).not.toContain('fee');
    expect(String(lookup(en, 'project.pay.feesNote'))).toMatch(/not part of the stage funding/i);
  });
});

describe('EN and FR parity', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'project.pay.title', 'project.pay.subtitle', 'project.pay.unavailable',
      'project.pay.cardFunding', 'project.pay.cardPaid', 'project.pay.cardApproved', 'project.pay.cardAvailable',
      'project.pay.cardAvailableNote', 'project.pay.nextTitle', 'project.pay.reportAction',
      'project.pay.noMilestones', 'project.pay.allFunded', 'project.pay.scheduleTitle',
      'project.pay.fundingAwaiting', 'project.pay.fundingConfirmed', 'project.pay.notScheduled',
      'project.pay.releaseApproved', 'project.pay.releaseProcessing', 'project.pay.releasePaid',
      'project.pay.releaseIssue', 'project.pay.releaseReview', 'project.pay.activityTitle',
      'project.pay.feesTitle', 'project.pay.feesNote', 'project.pay.event.paid', 'project.pay.event.funded',
    ];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} is not translated`).not.toBe(f);
    }
  });
});
