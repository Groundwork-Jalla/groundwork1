import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WhatsApp sends from Groundwork, whether or not GoHighLevel knows about the person.
 *
 * Sending was wired straight into GHL, which sends to a CONTACT RECORD rather than a
 * number. Live testing died on exactly that: Groundwork held +237… and the contact it
 * had to send through held nothing, so every message failed with
 * CONVERSATIONS_MSG_NO_PHONE. The number was never the problem — the record in between
 * was.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const send    = read('api/_lib/whatsapp-send.ts');
const fanout  = read('api/_handlers/message-fanout.ts');

describe('the transport is chosen, not assumed', () => {
  it('Meta is used where configured, because it sends to the number', () => {
    expect(send).toMatch(/if \(meta && target\.phone\) return metaSend/);
    expect(send).toMatch(/graph\.facebook\.com/);
  });

  it('GoHighLevel is the fallback, not the dependency', () => {
    expect(send).toMatch(/const cfg = await ghlConfig\(\);/);
    expect(send).toMatch(/provider: 'ghl'/);
  });

  it('and the fan-out no longer reaches for GHL before it has to', () => {
    // It used to fetch GHL config and an OAuth token up front, which made GHL look
    // required even on a path that never touches it.
    expect(fanout).toMatch(/await sendWhatsApp\(svc, \{/);
    expect(fanout).not.toMatch(/const bearerToken/);
  });

  it('with nothing configured it says so plainly', () => {
    expect(send).toMatch(/not_configured: neither Meta nor GoHighLevel is set up/);
  });
});

describe('credentials can be added without a redeploy', () => {
  it('app_config is read first, the environment second', () => {
    /**
     * Adding a row is a SQL statement; adding an environment variable is a redeploy —
     * which has blocked this project twice. RLS keeps app_config unreadable from the
     * browser (058).
     */
    expect(send).toMatch(/from\('app_config'\)\.select\('key, value'\)\.in\('key', keys\)/);
    expect(send).toMatch(/row\.whatsapp_phone_number_id \|\| process\.env\.WHATSAPP_PHONE_NUMBER_ID/);
    expect(send).toMatch(/row\.whatsapp_token\s+\|\| process\.env\.WHATSAPP_TOKEN/);
  });
});

describe('WhatsApp\'s 24-hour rule is handled, not hidden', () => {
  it('the out-of-window refusal is recognised by its code', () => {
    // Meta only accepts free text within 24 hours of the person's last message. Outside
    // it, a business-initiated message must be an approved template. That is WhatsApp's
    // rule and cannot be coded around.
    expect(send).toMatch(/code === 131047 \|\| code === 131051/);
  });

  it('a configured template is sent instead', () => {
    expect(send).toMatch(/type: 'template'/);
    expect(send).toMatch(/name: cfg\.template, language: \{ code: cfg\.lang \}/);
  });

  it('and with no template the reason names the operational fix', () => {
    // "failed" would send somebody looking for a bug; the fix is to get a template
    // approved at Meta.
    expect(send).toMatch(/outside_24h_window: a message template is required and none is configured/);
  });
});

describe('the GHL contact repair survives, on the path that needs it', () => {
  it('only when GoHighLevel was the transport', () => {
    // Meta never needs a contact, so repairing one there would be noise.
    expect(fanout).toMatch(/sent\.provider === 'ghl'/);
    expect(fanout).toMatch(/updateContactPhone\(cfg, thread\.contactId, phone as string\)/);
  });
});

describe('the ledger records which transport carried it', () => {
  it('so a failure can be read without guessing', () => {
    expect(fanout).toMatch(/await finish\('sent', sent\.provider, sent\.providerMessageId \?\? undefined\)/);
    expect(fanout).toMatch(/`\$\{sent\.provider\}: \$\{sent\.error\}`/);
  });
});
