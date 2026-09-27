import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normaliseReference, attachRefusal, attachEventKey, attachable,
} from '@/lib/payments/payout-reference';

/**
 * Recording a payout Groundwork did not make.
 *
 * SwyChr holds and moves the money; Groundwork keeps the record. Their payout API
 * publishes no webhook and its status endpoint only answers about a transaction id you
 * already hold, so nothing here can discover a transfer on its own. One human supplies
 * the id, once, and the existing poll does the rest.
 *
 * The pins below are about the two ways that can go wrong: filing a reference against a
 * row that is not waiting for one, and filing the same reference twice.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const handler = code('api/_handlers/swychr-attach.ts');
const events  = code('api/events.ts');
const poll    = code('api/swychr/_payout-poll.ts');
const ledger  = code('src/components/admin/FinanceLedger.tsx');

const authorised = { direction: 'out' as const, state: 'release_authorised', providerRef: null };

describe('normaliseReference', () => {
  it('keeps a plausible provider id, trimmed', () => {
    expect(normaliseReference('  TXN-90210-AB  ')).toBe('TXN-90210-AB');
    expect(normaliseReference('a1b2c3d4')).toBe('a1b2c3d4');
  });

  it('refuses what no provider could have issued', () => {
    for (const bad of ['', '   ', 'abc', 'has space', 'x'.repeat(129), null, undefined, 42 as never]) {
      expect(normaliseReference(bad as never), `${String(bad)} should be refused`).toBeNull();
    }
  });

  it('refuses control characters, which belong to injection not to references', () => {
    expect(normaliseReference('TXN\u0000123')).toBeNull();
    expect(normaliseReference('TXN\u007f123')).toBeNull();
    expect(normaliseReference('TXN\u001b[0m')).toBeNull();
  });

  it('does not invent a format the provider never promised', () => {
    // Rejecting a valid reference leaves a real payout unrecordable, which is worse
    // than accepting an odd-looking one that the RPC will simply never match.
    expect(normaliseReference('9f2c1a7e-4d3b-11ef-9c1a-0242ac120002')).not.toBeNull();
    expect(normaliseReference('SWY_2026_0925_000117')).not.toBeNull();
  });
});

describe('attachRefusal', () => {
  it('allows exactly one shape: an outgoing, authorised, unreferenced row', () => {
    expect(attachRefusal(authorised, 'TXN-1')).toBeNull();
  });

  it('refuses an incoming payment', () => {
    // An inbound row is a client funding the project; it has its own webhook.
    expect(attachRefusal({ ...authorised, direction: 'in' }, 'TXN-1')).toBe('not_outgoing');
  });

  it('refuses any state but release_authorised', () => {
    for (const state of ['initiated', 'disbursed', 'failed', 'reconciling', 'expected']) {
      expect(attachRefusal({ ...authorised, state }, 'TXN-1'), state).toBe('not_authorised');
    }
  });

  it('refuses to overwrite a reference that is already filed', () => {
    // Re-pointing a settled record at different money must leave a trace, so the fix is
    // reconciliation, not an edit.
    expect(attachRefusal({ ...authorised, providerRef: 'TXN-OLD' }, 'TXN-NEW')).toBe('already_attached');
  });

  it('refuses a reference that did not survive normalisation', () => {
    expect(attachRefusal(authorised, null)).toBe('bad_reference');
  });

  it('checks the row before the reference, so the reason is the useful one', () => {
    // A disbursed row with a bad reference is not "bad reference" — it is settled.
    expect(attachRefusal({ ...authorised, state: 'disbursed' }, null)).toBe('not_authorised');
  });
});

describe('attachEventKey', () => {
  it('is stable, so the same reference filed twice records once', () => {
    expect(attachEventKey('TXN-1')).toBe(attachEventKey('TXN-1'));
  });

  it('cannot collide with a poll observation about the same transaction', () => {
    // The poll uses `payout:<ref>:<status>`. An attach and a later status report are
    // different events; collapsing them would lose one.
    const key = attachEventKey('TXN-1');
    expect(key).not.toMatch(/^payout:/);
    expect(poll).toContain('`payout:${providerRef}:${(status ?? \'unknown\').toLowerCase()}`');
    expect(key).toBe('payout-attach:TXN-1');
  });
});

describe('attachable', () => {
  it('keeps only the rows an operator could act on', () => {
    const rows = [
      authorised,
      { direction: 'out' as const, state: 'initiated', providerRef: 'TXN-2' },
      { direction: 'in'  as const, state: 'expected',  providerRef: null },
      { direction: 'out' as const, state: 'release_authorised', providerRef: 'TXN-3' },
    ];
    expect(attachable(rows)).toEqual([authorised]);
  });
});

describe('the handler files a record; it never moves money', () => {
  it('is an admin act behind a server-side is_admin check', () => {
    expect(handler).toContain("rpc('is_admin')");
    expect(handler).toContain("res.status(403).json({ error: 'Admins only' })");
    expect(handler).toContain("res.status(401)");
  });

  it('goes through record_payment_event, the only thing that may move a payment', () => {
    expect(handler).toContain("rpc('record_payment_event'");
    expect(handler).toContain("p_event_type: 'initiated'");
    expect(handler).toContain('p_provider_ref: reference');
    // No direct write to the ledger, ever.
    expect(handler).not.toMatch(/from\('payments'\)[\s\S]{0,80}\.(update|insert|upsert|delete)\(/);
  });

  it('never calls the payout endpoint', () => {
    // Groundwork records what SwyChr did. It does not initiate, price or convert.
    for (const banned of ['createPayout', 'payoutCreate', 'amount', 'currency', 'XAF', 'fx']) {
      expect(handler, `${banned} has no business in an attach`).not.toContain(banned);
    }
  });

  it('treats a repeat as success, because the desired state already holds', () => {
    expect(handler).toContain('recorded: eventId !== null');
    expect(handler).toContain('ok: true');
  });

  it('refuses before it records, and says which refusal', () => {
    expect(handler).toContain('const refusal = attachRefusal(');
    expect(handler).toContain('res.status(409).json({ error: refusal');
  });

  it('is reachable without spending a function slot', () => {
    expect(events).toContain("'swychr-attach': swychrAttach");
    expect(handler).not.toContain('export default');
  });
});

describe('the operator only sees the field where it can be used', () => {
  it('the form applies the same refusal rule as the server', () => {
    // Two copies of "when may this be filed" is how they drift. The component asks the
    // shared predicate and renders nothing when it refuses.
    expect(ledger).toContain("from '@/lib/payments/payout-reference'");
    expect(ledger).toContain('attachRefusal({ direction: line.direction, state: line.state, providerRef: line.providerRef }');
    expect(ledger).toContain('return null;');
  });

  it('it is offered on disbursements only', () => {
    expect(ledger).toContain("{direction === 'out' && <AttachReference line={l} onFiled={load} />}");
  });

  it('it reloads from the ledger rather than patching the row it just sent', () => {
    // A screen that shows what it sent, instead of what the database now holds, will
    // eventually show a state the write never reached.
    expect(ledger).toContain('onFiled: () => void');
    expect(ledger).toContain('onFiled();');
  });

  it('the failure is announced, not just coloured', () => {
    expect(ledger).toContain('role="alert"');
  });

  it('the client module never touches the payments table directly', () => {
    const client = code('src/lib/supabase/payout-attach.ts');
    expect(client).toContain("fetch('/api/events?action=swychr-attach'");
    expect(client).not.toContain("from('payments')");
    expect(client).toContain('Bearer ${session.access_token}');
  });
});
