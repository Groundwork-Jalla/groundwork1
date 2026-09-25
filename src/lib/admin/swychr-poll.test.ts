import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isPollable, payoutEventKey, mapPayoutStatus, tally, POLLABLE_STATES,
  type PayoutRow, type PollOutcome,
} from '../../../api/swychr/_payout-poll';

/**
 * The outgoing leg, which SwyChr does not push.
 *
 * Two things this must never become: a second writer of payment state, and a reason a
 * provider outage looks like a failed payout. Both are easy mistakes in a poller, and
 * both would be invisible until money was involved.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

const handler = src('api/_handlers/swychr-poll.ts');
const pure    = src('api/swychr/_payout-poll.ts');
const ddl     = src('supabase/migrations/090_payments_ledger.sql');

const row = (o: Partial<PayoutRow> = {}): PayoutRow => ({
  id: 'p1', direction: 'out', state: 'initiated', provider: 'swychr', providerRef: 'tx_1', ...o,
});
const outcome = (o: Partial<PollOutcome> = {}): PollOutcome => ({
  paymentId: 'p1', providerStatus: 'pending', eventType: 'initiated', recorded: true, ...o,
});

describe('only money genuinely with the provider is polled', () => {
  it('initiated and reconciling, and nothing else', () => {
    expect([...POLLABLE_STATES]).toEqual(['initiated', 'reconciling']);
    expect(isPollable(row({ state: 'initiated' }))).toBe(true);
    expect(isPollable(row({ state: 'reconciling' }))).toBe(true);
  });

  it('release_authorised is never polled — nothing has been sent yet', () => {
    expect(isPollable(row({ state: 'release_authorised' }))).toBe(false);
  });

  it('disbursed and failed are never polled', () => {
    expect(isPollable(row({ state: 'disbursed' }))).toBe(false);
    // Terminal until `open_reconciliation` deliberately moves it on.
    expect(isPollable(row({ state: 'failed' }))).toBe(false);
    expect(ddl).toContain("('failed','reconciling')");
  });

  it('incoming rows are never polled — they have a webhook', () => {
    expect(isPollable(row({ direction: 'in' }))).toBe(false);
    expect(isPollable(row({ direction: 'in', state: 'expected' }))).toBe(false);
  });

  it('another provider, or no provider reference, is not ours to ask about', () => {
    expect(isPollable(row({ provider: 'someone_else' }))).toBe(false);
    expect(isPollable(row({ provider: null }))).toBe(false);
    expect(isPollable(row({ providerRef: null }))).toBe(false);
    expect(isPollable(row({ providerRef: '' }))).toBe(false);
  });

  it('the query asks the database for exactly that', () => {
    expect(handler).toContain(".eq('direction', 'out')");
    expect(handler).toContain(".eq('provider', 'swychr')");
    expect(handler).toContain(".not('provider_ref', 'is', null)");
    expect(handler).toContain(".in('state', [...POLLABLE_STATES])");
  });

  it('an on-demand refresh narrows the same query rather than using another', () => {
    // A single payment must never be polled under rules the batch would not apply.
    expect(handler).toContain("if (only) query = query.eq('id', only)");
    expect(handler.indexOf('.in(\'state\', [...POLLABLE_STATES])')).toBeLessThan(handler.indexOf('if (only)'));
  });
});

describe('asking twice is free; a real change is not lost', () => {
  it('the key carries no clock', () => {
    expect(payoutEventKey('tx_1', 'pending')).toBe('payout:tx_1:pending');
    expect(payoutEventKey('tx_1', 'pending')).toBe(payoutEventKey('tx_1', 'pending'));
    // Case is theirs to vary; ours to normalise.
    expect(payoutEventKey('tx_1', 'PENDING')).toBe(payoutEventKey('tx_1', 'pending'));
    expect(payoutEventKey('tx_1', null)).toBe('payout:tx_1:unknown');
    for (const forbidden of ['Date.now', 'new Date', 'toISOString']) {
      expect(pure, `${forbidden} in the key would make every poll a new event`).not.toContain(forbidden);
    }
  });

  it('a later status is a different key, so the transition still records', () => {
    expect(payoutEventKey('tx_1', 'successful')).not.toBe(payoutEventKey('tx_1', 'pending'));
  });

  it('090 makes the repeat a no-op rather than a second application', () => {
    expect(ddl).toContain('ON CONFLICT (provider, provider_event_id) DO NOTHING');
    expect(ddl).toContain('IF v_event IS NULL THEN RETURN NULL; END IF;');
    // Which is why "recorded" is judged on the RPC returning an id.
    expect(handler).toContain('recorded: recorded !== null');
  });
});

describe('the ledger stays the only authority', () => {
  it('every outcome goes through record_payment_event', () => {
    expect(handler).toContain("svc.rpc('record_payment_event'");
  });

  it('the poller never writes a payment itself', () => {
    for (const banned of ["from('payments').update", "from('payments').insert", "from('payment_events')", 'payments_write']) {
      expect(handler, `${banned} would make this a second state writer`).not.toContain(banned);
    }
    expect(pure).not.toContain('from(');
  });

  it('both provider paths converge on the same RPC', () => {
    expect(src('api/_handlers/swychr-callback.ts')).toContain("db.rpc('record_payment_event'");
    expect(handler).toContain("svc.rpc('record_payment_event'");
  });

  it('a status it does not recognise is recorded, not dropped or guessed', () => {
    expect(mapPayoutStatus('something new')).toBeNull();
    expect(handler).toContain("p_event_type: eventType ?? 'unknown'");
  });

  it('the mapping is the one the webhook side already uses', () => {
    expect(pure).toContain("import { payoutEventType } from './_webhook.js'");
    expect(mapPayoutStatus('pending')).toBe('initiated');
    expect(mapPayoutStatus('successful')).toBe('disbursed');
    expect(mapPayoutStatus('failed')).toBe('failed');
  });
});

describe('a provider problem is never a payment problem', () => {
  it('an unreachable provider is counted as failed-to-check, not failed-to-pay', () => {
    const s = tally([outcome({ error: 'network_error', eventType: null, recorded: false })]);
    expect(s.failed).toBe(1);
    expect(s.transitioned).toBe(0);
    // Nothing in the handler turns a transport error into a ledger event.
    const errBranch = handler.slice(handler.indexOf('if (!answer.ok)'), handler.indexOf('const status ='));
    expect(errBranch).not.toContain('record_payment_event');
    expect(errBranch).toContain('continue;');
  });

  it('one failure does not stop the batch', () => {
    expect(handler).toContain('for (const row of rows)');
    // try/catch inside the loop, continuing rather than returning.
    const loop = handler.slice(handler.indexOf('for (const row of rows)'));
    expect(loop).toContain('try {');
    expect(loop).toContain('} catch (err) {');
    expect(loop).not.toMatch(/catch[\s\S]{0,200}res\.status\(5/);
  });

  it('the counts distinguish the four real outcomes', () => {
    const s = tally([
      outcome({ paymentId: 'a', eventType: 'disbursed', recorded: true }),   // transitioned
      outcome({ paymentId: 'b', eventType: 'initiated', recorded: false }),  // asked before
      outcome({ paymentId: 'c', eventType: null, recorded: true }),          // status means nothing yet
      outcome({ paymentId: 'd', error: 'timeout', recorded: false }),        // could not ask
    ]);
    expect(s).toMatchObject({ checked: 4, transitioned: 1, unchanged: 2, failed: 1 });
  });

  it('not configured is reported as such, not as a batch of failures', () => {
    expect(handler).toContain("reason: 'not_configured'");
    expect(handler).toContain('emptySummary()');
  });
});

describe('who may ask', () => {
  it('a scheduler proves itself, by header or by bearer, compared in constant length', () => {
    expect(handler).toContain("req.headers?.['x-groundwork-secret']");
    expect(handler).toContain('given.length === expected.length && given === expected');
    // A hosted cron issues a plain GET and cannot set a custom header, so the bearer
    // convention is accepted too — without assuming which scheduler it is.
    expect(handler).toContain('process.env.CRON_SECRET');
    expect(handler).toContain("req.method !== 'POST' && req.method !== 'GET'");
    // Same shape as the existing internal endpoint.
    expect(src('api/agent-dispatch.ts')).toContain("req.headers['x-agent-secret']");
  });

  it('the cron calls a plain path that rewrites onto the one action', () => {
    const vercel = JSON.parse(src('vercel.json'));
    expect(vercel.crons).toEqual([{ path: '/api/swychr-poll', schedule: '*/5 * * * *' }]);
    expect(vercel.rewrites).toContainEqual({ source: '/api/swychr-poll', destination: '/api/events?action=swychr-poll' });
  });

  it('an admin may refresh one payment with their own session', () => {
    expect(handler).toContain("rpc('is_admin')");
    expect(handler).toContain('byAdmin');
  });

  it('nobody else may make Groundwork ask a payment provider anything', () => {
    expect(handler).toContain('if (!bySchedule && !byAdmin)');
    expect(handler).toContain("res.status(401)");
    // And the check precedes every provider call.
    expect(handler.indexOf('res.status(401)')).toBeLessThan(handler.indexOf('payoutStatus(cfg'));
  });

  it('credentials never reach the browser', () => {
    for (const f of ['src/lib/supabase/payments.ts', 'src/components/admin/workspace/FinancialsTab.tsx']) {
      const app = src(f);
      for (const banned of ['accountpe.com', 'SWYCHR_', 'Api-Key', 'x-groundwork-secret']) {
        expect(app, `${banned} in ${f}`).not.toContain(banned);
      }
    }
  });
});

describe('it costs no Vercel function', () => {
  it('routed through the existing events boundary', () => {
    const events = src('api/events.ts');
    expect(events).toContain("'swychr-poll'");
    expect(events).toContain("from './_handlers/swychr-poll.js'");
  });

  it('the entry-point count is unchanged', () => {
    const { execSync } = require('node:child_process');
    const count = execSync('ls api/*.ts | wc -l', { cwd: ROOT, encoding: 'utf8' }).trim();
    // Well inside Vercel's Hobby cap of 12.
    expect(Number(count)).toBeLessThanOrEqual(12);
  });
});
