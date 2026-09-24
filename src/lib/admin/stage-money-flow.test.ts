import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageFlow, providerConnected, liveRelease, legsDone } from './stage-money-flow';
import type { Payment } from '@/lib/supabase/payments';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Where a stage's money actually is, for admin.
 *
 * The fact these pins exist to protect: `initiated` and `disbursed` are reachable only
 * through `record_payment_event`, and NOTHING calls it. So an authorised release does not
 * move, and a view that drew legs 3 and 4 as "pending" would tell an operator the money
 * is on its way when nothing is carrying it.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const view = code('src/components/admin/workspace/MoneyFlow.tsx');
const ddl  = src('supabase/migrations/090_payments_ledger.sql');

const P = (over: Partial<Payment>): Payment => ({
  id: 'p1', projectId: 'j1', stageId: 's1', direction: 'in', state: 'funded', amount: 1000,
  currency: 'USD', beneficiaryId: null, fundingSource: 'staff_confirmed',
  confirmedBy: null, confirmedAt: null, authorisedBy: null, authorisedAt: null, note: null,
  provider: null, providerRef: null, failureReason: null, settledAt: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
const stage = (milestone: number | null = 5000) => ({ id: 's1', payment_milestone_usd: milestone });
const legs = (rows: Payment[], connected = false, s = stage()) => stageFlow(rows, s, connected).legs.map(l => l.state);

describe('the provider legs tell the truth about why nothing moves', () => {
  it('only record_payment_event can produce initiated or disbursed', () => {
    // The transition table in 090. If this ever widens, the comment above is stale.
    expect(ddl).toContain("('release_authorised','initiated'), ('initiated','disbursed')");
  });

  it('and nothing in the application calls it', () => {
    const app = [
      'src/lib/supabase/payments.ts', 'src/components/admin/workspace/FinancialsTab.tsx',
      'src/components/admin/ledger/LedgerModal.tsx',
    ].filter(f => { try { src(f); return true; } catch { return false; } })
     .map(f => src(f)).join('\n');
    expect(app).not.toContain('record_payment_event');
  });

  it('an authorised release with no provider says so, rather than "pending"', () => {
    const rows = [
      P({ id: 'in', direction: 'in', state: 'funded', confirmedAt: '2026-09-01T00:00:00Z' }),
      P({ id: 'out', direction: 'out', state: 'release_authorised', amount: 4000, authorisedAt: '2026-09-02T00:00:00Z' }),
    ];
    expect(legs(rows, false)).toEqual(['done', 'done', 'noProvider', 'noProvider']);
    expect(String(lookup(en, 'admin.flow.state.noProvider'))).toBe('No provider connected');
  });

  it('the same rows read as merely waiting once a provider has written', () => {
    const rows = [
      P({ id: 'in', direction: 'in', state: 'funded' }),
      P({ id: 'out', direction: 'out', state: 'release_authorised', amount: 4000 }),
    ];
    expect(legs(rows, true)).toEqual(['done', 'done', 'waiting', 'waiting']);
  });

  it('connectedness is derived from the rows, never asserted', () => {
    expect(providerConnected([P({})])).toBe(false);
    expect(providerConnected([P({ provider: 'swychr' })])).toBe(true);
    expect(providerConnected([P({ providerRef: 'tx_1' })])).toBe(true);
    expect(providerConnected([P({ settledAt: '2026-09-01T00:00:00Z' })])).toBe(true);
    expect(view).toContain('providerConnected(payments)');
  });

  it('the banner appears only when no provider has ever written', () => {
    expect(view).toContain('{!connected && (');
    expect(view).toContain('admin.flow.noProviderNote');
    expect(String(lookup(en, 'admin.flow.noProviderNote'))).toMatch(/cannot move/i);
  });
});

describe('each leg reads its own ledger fact', () => {
  it('funding is the incoming row', () => {
    expect(legs([P({ direction: 'in', state: 'expected' })])[0]).toBe('waiting');
    expect(legs([P({ direction: 'in', state: 'funded' })])[0]).toBe('done');
    expect(legs([P({ direction: 'in', state: 'reconciled' })])[0]).toBe('done');
  });

  it('authorisation exists exactly when an out row does — 090 guarantees it', () => {
    expect(ddl).toContain('CONSTRAINT payments_out_authorised');
    expect(legs([P({ direction: 'in', state: 'funded' })])[1]).toBe('waiting');
    expect(legs([P({ direction: 'out', state: 'release_authorised' })])[1]).toBe('done');
  });

  it('in flight and paid are distinguished', () => {
    expect(legs([P({ direction: 'out', state: 'initiated' })], true)).toEqual(['waiting', 'done', 'inFlight', 'waiting']);
    expect(legs([P({ direction: 'out', state: 'disbursed' })], true)).toEqual(['waiting', 'done', 'done', 'done']);
  });

  it('a failure stops both provider legs', () => {
    expect(legs([P({ direction: 'out', state: 'failed' })], true)).toEqual(['waiting', 'done', 'failed', 'failed']);
    expect(legs([P({ direction: 'out', state: 'reconciling' })], true)).toEqual(['waiting', 'done', 'review', 'review']);
  });

  it('a stage with no milestone and no rows is not scheduled, not waiting', () => {
    expect(legs([], false, stage(null))).toEqual(['notScheduled', 'notScheduled', 'notScheduled', 'notScheduled']);
    expect(legs([], false, stage(0))).toEqual(['notScheduled', 'notScheduled', 'notScheduled', 'notScheduled']);
    // A milestone with no row yet IS scheduled.
    expect(legs([], false, stage(5000))[0]).toBe('waiting');
  });
});

describe('the live release is the one that matters', () => {
  it('a failed release does not mask a live one', () => {
    const rows = [
      P({ id: 'dead', direction: 'out', state: 'failed', amount: 100 }),
      P({ id: 'live', direction: 'out', state: 'initiated', amount: 200 }),
    ];
    expect(liveRelease(rows, 's1')!.id).toBe('live');
  });

  it('with only a failed release, that is what is shown', () => {
    expect(liveRelease([P({ id: 'dead', direction: 'out', state: 'failed' })], 's1')!.id).toBe('dead');
  });

  it('another stage\'s rows are never read', () => {
    expect(liveRelease([P({ direction: 'out', state: 'disbursed', stageId: 'other' })], 's1')).toBeNull();
    expect(legs([P({ direction: 'in', state: 'funded', stageId: 'other' })])[0]).toBe('waiting');
  });
});

describe('nothing is shown that the ledger does not hold', () => {
  it('a leg with no timestamp shows none', () => {
    const flow = stageFlow([P({ direction: 'out', state: 'release_authorised', authorisedAt: null })], stage(), true);
    expect(flow.legs[1].at).toBeNull();
    expect(view).toContain('{leg.at && ');
  });

  it('no provider reference or payload reaches the screen', () => {
    for (const banned of ['providerRef', 'provider_ref', 'providerStatus', 'providerPayload', 'provider_payload', 'payment_events']) {
      expect(view, `${banned} is internal`).not.toContain(banned);
    }
  });

  it('it reads, and writes nothing', () => {
    for (const banned of ['.insert(', '.update(', '.rpc(', 'authoriseRelease', 'confirmFunding']) {
      expect(view, banned).not.toContain(banned);
    }
  });

  it('legsDone counts only completed legs', () => {
    expect(legsDone(stageFlow([P({ direction: 'in', state: 'funded' })], stage(), false))).toBe(1);
    expect(legsDone(stageFlow([P({ direction: 'out', state: 'disbursed' })], stage(), true))).toBe(3);
  });
});

describe('EN and FR parity', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'admin.flow.title', 'admin.flow.subtitle', 'admin.flow.noProviderNote',
      'admin.flow.openIntegrations', 'admin.flow.noMilestone',
      'admin.flow.leg.authorised', 'admin.flow.leg.toProvider', 'admin.flow.leg.toContractor',
      'admin.flow.state.waiting', 'admin.flow.state.inFlight', 'admin.flow.state.done',
      'admin.flow.state.failed', 'admin.flow.state.noProvider', 'admin.flow.state.notScheduled',
    ];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} is not translated`).not.toBe(f);
    }
    // The two arrow legs are the same words in both languages by design.
    expect(lookup(en, 'admin.flow.leg.funding')).toBe('Client → Groundwork');
  });
});
