import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every invitation email reports whether it actually arrived (178).
 *
 * Favour, 9 Nov 2026: "an email invite shouldn't even fail… it's to ensure that every
 * email sent out actually delivers."
 *
 * ── What was already fine ──────────────────────────────────────────────────────────
 *
 * The sending domain. Checked in public DNS the same day: DKIM published on
 * `mail.tryjalla.com`, SPF and an MX on the `send.` bounce subdomain, and
 * `_dmarc.tryjalla.com` at `p=quarantine; adkim=r; aspf=r` with no `sp=`, so relaxed
 * alignment carries the subdomain. DMARC passes on both SPF and DKIM. Misconfigured
 * DNS is the usual reason mail lands in spam and it is not the reason here.
 *
 * ── What was missing ───────────────────────────────────────────────────────────────
 *
 * A 200 from Resend means ACCEPTED, not delivered. Nothing kept the provider's id and
 * nothing subscribed to the receipts, so "did Ada get her invitation?" had no answer
 * for any invitation ever sent. These tests pin the chain that answers it.
 */

const sql      = readFileSync('supabase/migrations/178_every_invitation_reports_its_delivery.sql', 'utf8');
const receipt  = readFileSync('api/_handlers/email-receipt.ts', 'utf8');
const resend   = readFileSync('api/_lib/resend-send.ts', 'utf8');
const invite   = readFileSync('api/send-invite.ts', 'utf8');
const share    = readFileSync('api/_handlers/send-share-invite.ts', 'utf8');
const events   = readFileSync('api/events.ts', 'utf8');

describe('the row can hold a verdict', () => {
  it('every state a message can reach is nameable', () => {
    expect(sql).toMatch(/CREATE TYPE public\.email_delivery_status AS ENUM \(\s*'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'\)/);
  });

  it('both invitation tables carry the id, the status and the reason', () => {
    for (const table of ['contractor_invites', 'project_viewers']) {
      const block = sql.slice(sql.indexOf(`ALTER TABLE public.${table}`));
      for (const col of ['email_message_id', 'email_status', 'email_sent_at',
                         'email_delivered_at', 'email_error', 'email_attempts']) {
        expect(block.slice(0, 700), `${table}.${col}`).toContain(col);
      }
    }
  });

  it('a new invitation starts queued, not sent', () => {
    /**
     * The row is written before the email is attempted, and the attempt is fired from
     * the browser. Defaulting to `sent` would make "we never got as far as sending
     * this" indistinguishable from success — which is the state the whole report was
     * about.
     */
    expect(sql).toMatch(/email_status\s+public\.email_delivery_status NOT NULL DEFAULT 'queued'/);
  });

  it('and a replayed receipt cannot match two rows', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS contractor_invites_message_id/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS project_viewers_message_id/);
  });

  it('existing rows are not left as a false backlog', () => {
    // We have no receipts for them and never will.
    expect(sql).toMatch(/UPDATE public\.contractor_invites[\s\S]{0,300}WHERE email_status = 'queued'/);
  });
});

describe('the send keeps the handle the receipt will quote', () => {
  it('the transport returns the provider id', () => {
    expect(resend).toMatch(/messageId: typeof body\.id === 'string' \? body\.id : undefined/);
  });

  it('and both senders write it onto the invitation', () => {
    for (const [name, src] of [['contractor', invite], ['client', share]] as const) {
      expect(src, name).toMatch(/email_message_id: sent\.messageId \?\? null/);
      expect(src, name).toMatch(/email_status:\s*'sent'/);
    }
  });

  it('a failed send is recorded as still owed, not quietly fine', () => {
    for (const [name, src] of [['contractor', invite], ['client', share]] as const) {
      expect(src, name).toMatch(/email_status:\s*sent\.retryable \? 'queued' : 'failed'/);
      expect(src, name).toMatch(/email_error:\s*sent\.error \?\? 'unknown'/);
    }
  });

  it('and a rate limit is asked again rather than treated as a verdict', () => {
    // 429 and 5xx are "not now". Any other 4xx is an answer, and retrying it only
    // spends the rate limit hearing it twice.
    expect(resend).toMatch(/return status === 429 \|\| status >= 500;/);
  });
});

describe('the receipt is believed only when it is signed', () => {
  it('it verifies the raw bytes, which is what was signed', () => {
    expect(receipt).toMatch(/const raw: Buffer \| undefined = req\.rawBody/);
    expect(receipt).toMatch(/signatureValid\(secret, id, ts, raw, sig\)/);
  });

  it('refuses everything when no secret is configured', () => {
    /**
     * Unverified, this endpoint lets a stranger mark any invitation delivered — or
     * mark a delivered one bounced and have staff chase a client who already joined.
     * An unverified receipt is worse than no receipt.
     */
    expect(receipt).toMatch(/refusing unverified receipts/);
    expect(receipt).toMatch(/res\.status\(503\)/);
  });

  it('and will not replay an old capture', () => {
    expect(receipt).toMatch(/age > SIGNED_WINDOW_SECONDS/);
  });

  it('compares in constant time, without throwing on a length mismatch', () => {
    // timingSafeEqual throws when the lengths differ, which would read as a 500.
    expect(receipt).toMatch(/got\.length === expected\.length && timingSafeEqual\(got, expected\)/);
  });
});

describe('what the receipt does to the row', () => {
  it('maps every Resend outcome', () => {
    for (const ev of ['email.sent', 'email.delivered', 'email.bounced',
                      'email.complained', 'email.failed', 'email.delivery_delayed']) {
      expect(receipt).toContain(`'${ev}'`);
    }
  });

  it('a delay is not delivery', () => {
    // Recorded as `sent` so the row never claims an arrival it has not had.
    expect(receipt).toMatch(/'email\.delivery_delayed': 'sent'/);
  });

  it('delivered is terminal, because receipts can arrive out of order', () => {
    expect(receipt).toMatch(/if \(status === 'sent'\) q = q\.neq\('email_status', 'delivered'\)/);
  });

  it('an unmodelled event is a 200, not a retry loop', () => {
    expect(receipt).toMatch(/res\.status\(200\)\.json\(\{ ok: true, ignored: true \}\)/);
  });

  it('and it is reachable without spending a serverless function', () => {
    // The Hobby plan caps this project at twelve; the dispatcher is how new endpoints
    // arrive. See api/README.md.
    expect(events).toMatch(/'email-receipt': emailReceipt/);
  });
});
