import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyPayinSignature, parsePayinCallback, payinEventType, payoutEventType,
  payinEventKey, PAYIN_STATUS, SWYCHR_EVENT,
} from '../../../api/swychr/_webhook';

/**
 * SwyChr, pinned against the published contract (SwychrPay payin + payout, Sep 2026).
 *
 * This is our transcription of somebody else's API, and the first draft got the signature
 * wrong — it signed the raw body, where they sign `{timestamp}.{raw_body}`. That mistake
 * passes every test you write yourself and fails every real delivery, so the signature
 * cases below build their reference implementation from scratch and check ours agrees.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

const handler = src('api/_handlers/swychr-callback.ts');
const client  = src('api/swychr/_client.ts');
const config  = src('api/swychr/_config.ts');

const SECRET = 'whsec_test';
/** Their Node.js example, transcribed independently of our implementation. */
const theirSignature = (timestamp: string, rawBody: string) =>
  createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

const bodyFor = (status: number, transactionId = 'txn_1') => JSON.stringify({
  event: 'payment_link_status_updated',
  timestamp: '2026-08-03T10:15:00+00:00',
  data: { data: { id: '6682', type: 'payment-links', attributes: {
    id: 6682, name: 'Rahul Sharma', email: 'rahul@example.com',
    amount: 149.5, currency_code: 'XAF', country_code: 'CM',
    transaction_id: transactionId, status,
  } } },
});

describe('the signature is over {timestamp}.{raw_body}', () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = bodyFor(1);

  it('accepts a signature built the way their own example builds it', () => {
    expect(verifyPayinSignature(Buffer.from(raw), ts, theirSignature(ts, raw), SECRET)).toBe(true);
  });

  it('rejects a signature over the body alone — the mistake this test exists for', () => {
    const bodyOnly = createHmac('sha256', SECRET).update(raw).digest('hex');
    expect(verifyPayinSignature(Buffer.from(raw), ts, bodyOnly, SECRET)).toBe(false);
  });

  it('rejects a tampered body, a wrong secret, and a missing signature', () => {
    expect(verifyPayinSignature(Buffer.from(bodyFor(2)), ts, theirSignature(ts, raw), SECRET)).toBe(false);
    expect(verifyPayinSignature(Buffer.from(raw), ts, createHmac('sha256', 'other').update(`${ts}.${raw}`).digest('hex'), SECRET)).toBe(false);
    expect(verifyPayinSignature(Buffer.from(raw), ts, null, SECRET)).toBe(false);
  });

  it('no secret configured is never a pass', () => {
    expect(verifyPayinSignature(Buffer.from(raw), ts, theirSignature(ts, raw), undefined)).toBe(false);
    expect(verifyPayinSignature(Buffer.from(raw), ts, theirSignature(ts, raw), '')).toBe(false);
    expect(handler).toContain("res.status(503)");
  });

  it('rejects a stale delivery, so a captured one cannot be replayed for ever', () => {
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect(verifyPayinSignature(Buffer.from(raw), old, theirSignature(old, raw), SECRET)).toBe(false);
    // Inside their recommended five minutes it is still good.
    const recent = String(Math.floor(Date.now() / 1000) - 60);
    expect(verifyPayinSignature(Buffer.from(raw), recent, theirSignature(recent, raw), SECRET)).toBe(true);
    // A timestamp that is not a number is not a timestamp.
    expect(verifyPayinSignature(Buffer.from(raw), 'soon', theirSignature('soon', raw), SECRET)).toBe(false);
  });

  it('the handler verifies before it reads the payload', () => {
    expect(handler.indexOf('verifyPayinSignature')).toBeLessThan(handler.indexOf('parsePayinCallback'));
    expect(handler).toContain("header('x-webhook-timestamp')");
    expect(handler).toContain('req.rawBody');
  });
});

describe('their status codes, mapped to what the ledger accepts', () => {
  it('the reference table is transcribed exactly', () => {
    expect(PAYIN_STATUS).toEqual({
      0: 'pending', 1: 'successful', 2: 'failed', 3: 'expired',
      4: 'processing', 5: 'declined', 6: 'rejected',
    });
    expect(SWYCHR_EVENT).toBe('payment_link_status_updated');
  });

  it('only 1 means the money arrived', () => {
    expect(payinEventType(1)).toBe('funded');
  });

  it('failed, expired, declined and rejected all mean it is not coming', () => {
    for (const code of [2, 3, 5, 6]) expect(payinEventType(code), String(code)).toBe('failed');
  });

  it('pending and processing are real but are not ledger transitions', () => {
    // 090 has no state for "money on its way in", so these are recorded, applied to
    // nothing — not quietly treated as funded.
    expect(payinEventType(0)).toBeNull();
    expect(payinEventType(4)).toBeNull();
    expect(payinEventType(null)).toBeNull();
    expect(payinEventType(99)).toBeNull();
  });

  it('an unmapped status still reaches the ledger as a recorded unknown', () => {
    expect(handler).toContain("payinEventType(parsed.statusCode) ?? 'unknown'");
  });

  it('a polled payout status maps to the outgoing transitions', () => {
    expect(payoutEventType('pending')).toBe('initiated');
    expect(payoutEventType('successful')).toBe('disbursed');
    expect(payoutEventType('failed')).toBe('failed');
    expect(payoutEventType('something new')).toBeNull();
  });
});

describe('the envelope is read the way they nest it', () => {
  it('pulls the attributes out of data.data.attributes', () => {
    const parsed = parsePayinCallback(JSON.parse(bodyFor(1, 'pay_42')));
    expect(parsed.transactionId).toBe('pay_42');
    expect(parsed.statusCode).toBe(1);
    expect(parsed.statusWord).toBe('successful');
    expect(parsed.amount).toBe(149.5);
    expect(parsed.currency).toBe('XAF');
    expect(parsed.providerRef).toBe('6682');
  });

  it('a shape it has never seen yields nulls rather than throwing', () => {
    for (const junk of [{}, { data: {} }, { data: { data: {} } }, null, 'nonsense']) {
      expect(() => parsePayinCallback(junk)).not.toThrow();
    }
    expect(parsePayinCallback({}).transactionId).toBeNull();
  });
});

describe('a repeat is free, a real change is not lost', () => {
  it('the key is the transaction AND the status it reports', () => {
    // Their guidance is to deduplicate on transaction_id, but a link legitimately reports
    // pending and then successful; keying on the id alone would lose the second one.
    expect(payinEventKey('pay_1', 0)).toBe('pay_1:0');
    expect(payinEventKey('pay_1', 1)).toBe('pay_1:1');
    expect(payinEventKey('pay_1', 1)).toBe(payinEventKey('pay_1', 1));
    expect(payinEventKey('pay_1', null)).toBe('pay_1:unknown');
  });

  it('090 makes that key idempotent', () => {
    expect(src('supabase/migrations/090_payments_ledger.sql'))
      .toContain('CONSTRAINT payment_events_provider_event_key UNIQUE (provider, provider_event_id)');
  });

  it('a delivery with no transaction id is refused a key rather than given a guess', () => {
    expect(handler).toContain("reason: 'no_transaction_id'");
    expect(handler).toContain('res.status(200)');
  });
});

describe('it writes through the ledger, never around it', () => {
  it('record_payment_event is the only writer it calls', () => {
    expect(handler).toContain("db.rpc('record_payment_event'");
    for (const banned of ["from('payments').update", "from('payments').insert", "from('payment_events').insert"]) {
      expect(handler, `${banned} would bypass 090's guards`).not.toContain(banned);
    }
  });

  it('an unmatched transaction is recorded, not acted on', () => {
    expect(handler).toContain('const paymentId = (match?.id as string | null) ?? null;');
    expect(handler).toContain('p_payment: paymentId');
  });

  it('only a failure to record asks them to send it again', () => {
    // Their retry is up to five times, so a 500 must mean "we genuinely did not keep
    // this": the server being unconfigured, the RPC refusing, or an unexpected throw.
    // Everything else — unverified, unusable, unmatched — answers 2xx so they stop.
    expect((handler.match(/res\.status\(500\)/g) ?? []).length).toBe(3);
    expect(handler).toContain('Could not record event');
    expect(handler).toContain("res.status(401)");
    expect(handler).toContain("reason: 'no_transaction_id'");
  });
});

describe('credentials stay on the server', () => {
  it('nothing in the browser bundle reaches SwyChr', () => {
    const app = ['src/lib/supabase/payments.ts', 'src/components/admin/workspace/FinancialsTab.tsx']
      .map(f => src(f)).join('\n');
    for (const banned of ['accountpe.com', 'swychrconnect', 'SWYCHR_API_KEY', 'Api-Key']) {
      expect(app, `${banned} must not be in the browser`).not.toContain(banned);
    }
  });

  it('config resolves from app_config first, which no browser can read', () => {
    expect(config).toContain("from('app_config')");
    expect(config).toContain('SUPABASE_SERVICE_ROLE_KEY');
    // 058: RLS on, no policies.
    expect(src('supabase/migrations/058_app_config.sql')).toContain('ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;');
  });

  it('half a credential is not configuration', () => {
    expect(config).toContain('if (!apiKey && !(email && password)) return null;');
  });

  it('the endpoints match the published contract', () => {
    expect(client).toContain("payinDirect:    '/api/payin/create_payment_request'");
    expect(client).toContain("payoutCreate:   '/api/payout/create_transaction'");
    expect(client).toContain("payoutStatus:   '/api/payout/transaction_status'");
    expect(client).toContain("payoutMethods:  '/api/payout/payout_methods'");
    // The Direct API takes a long-lived key; payout publishes no equivalent.
    expect(client).toContain("headers['Api-Key'] = cfg.apiKey");
    expect(client).toContain("auth: 'payout'");
  });

  it('a retry cannot create a second payment link', () => {
    expect(client).toContain("'Idempotency-Key': req.transactionId");
  });
});
