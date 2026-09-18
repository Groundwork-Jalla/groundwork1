import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inboundMessageRow, parseInboundMessage, resolvePerson } from '../../../api/ghl/_inbound-message';

/**
 * Phase 6.2 — the inbound pipe, proven without a webhook.
 *
 * THE FIXTURE IS SANITISED, NOT CAPTURED. Production has never received an inbound-message
 * event, so this shape is GoHighLevel's documented `InboundMessage` with placeholder values.
 * When the first real payload is captured it is inspected in `ghl_inbound_events`, the
 * parser is corrected against it, and THIS fixture is replaced by a redacted copy — same
 * keys, no personal data. It is never presented as a production event.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Documented shape, sanitised. PROVISIONAL until a captured payload replaces it. */
const documented = (over: Record<string, unknown> = {}) => ({
  type: 'InboundMessage', locationId: 'loc_placeholder', contactId: 'ct_placeholder', conversationId: 'cv_placeholder',
  messageId: 'msg_placeholder_1', messageType: 'WhatsApp', direction: 'inbound', body: 'Hello, is the foundation done?',
  dateAdded: '2026-09-18T10:00:00.000Z', attachments: [], ...over,
});

describe('parseInboundMessage — what is a client message we may file', () => {
  it('accepts the documented WhatsApp shape and maps it onto 091', () => {
    const r = parseInboundMessage(documented());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toEqual({
      ghlMessageId: 'msg_placeholder_1', ghlContactId: 'ct_placeholder', ghlConversationId: 'cv_placeholder',
      channel: 'whatsapp', body: 'Hello, is the foundation done?', senderName: 'whatsapp',
      sentAt: '2026-09-18T10:00:00.000Z', attachments: [], locationId: 'loc_placeholder',
    });
  });

  it('accepts email, snake_case keys, a contact name, and TYPE_ spellings', () => {
    const r = parseInboundMessage({ type: 'InboundMessage', message_type: 'TYPE_EMAIL', contact_id: 'c', message_id: 'm', body: 'hi',
      contact: { firstName: 'Ada', lastName: 'Lovelace' }, conversation_id: 'v' });
    expect(r).toMatchObject({ ok: true, message: { channel: 'email', senderName: 'Ada Lovelace', ghlConversationId: 'v' } });
  });

  it('SMS is recorded but never filed — channel_disabled (D1), no enum change', () => {
    expect(parseInboundMessage(documented({ messageType: 'SMS' }))).toEqual({ ok: false, reason: 'channel_disabled', detail: 'sms' });
  });

  it('an outbound event is not ours — crm-delivery files staff replies', () => {
    expect(parseInboundMessage(documented({ type: 'OutboundMessage', direction: 'outbound' }))).toMatchObject({ ok: false, reason: 'not_inbound' });
    expect(parseInboundMessage(documented({ direction: 'outbound' }))).toMatchObject({ ok: false, reason: 'not_inbound' });
  });

  it('anything that is not a message is not a message', () => {
    for (const type of ['AppointmentCreate', 'ContactTagUpdate', 'OpportunityStageUpdate', 'ContactCreate']) {
      expect(parseInboundMessage(documented({ type })), type).toMatchObject({ ok: false, reason: 'not_a_message' });
    }
  });

  it('malformed: missing id, contact, body, type, or an unknown channel word', () => {
    expect(parseInboundMessage(documented({ messageId: '' }))).toMatchObject({ ok: false, reason: 'malformed', detail: 'no message id' });
    expect(parseInboundMessage(documented({ contactId: undefined }))).toMatchObject({ ok: false, reason: 'malformed', detail: 'no contact id' });
    expect(parseInboundMessage(documented({ body: '   ' }))).toMatchObject({ ok: false, reason: 'malformed', detail: 'empty body' });
    expect(parseInboundMessage({})).toMatchObject({ ok: false, reason: 'malformed', detail: 'no type' });
    expect(parseInboundMessage(documented({ messageType: 'Carrier pigeon' }))).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseInboundMessage('not an object')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseInboundMessage(null)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('keeps attachments as sent, and drops an unparseable date rather than inventing one', () => {
    const r = parseInboundMessage(documented({ attachments: [{ url: 'x' }], dateAdded: 'yesterday-ish' }));
    expect(r).toMatchObject({ ok: true, message: { attachments: [{ url: 'x' }], sentAt: null } });
  });
});

describe('resolvePerson — exactly two lookups, in order, nothing inferred', () => {
  it('contact id first; the email lookup is never made when it hits', async () => {
    const byGhlContactId = vi.fn(async () => 'person-1'), byEmail = vi.fn(async () => 'person-2');
    expect(await resolvePerson({ byGhlContactId, byEmail }, 'ct', 'a@b.c')).toBe('person-1');
    expect(byEmail).not.toHaveBeenCalled();
  });
  it('email second, only when the payload carried one', async () => {
    const byGhlContactId = vi.fn(async () => null), byEmail = vi.fn(async () => 'person-2');
    expect(await resolvePerson({ byGhlContactId, byEmail }, 'ct', 'a@b.c')).toBe('person-2');
    expect(await resolvePerson({ byGhlContactId, byEmail }, 'ct', null)).toBeNull();
    expect(byEmail).toHaveBeenCalledTimes(1);
  });
  it('no match → null; no guess, no applicant, no anonymous person', async () => {
    expect(await resolvePerson({ byGhlContactId: async () => null, byEmail: async () => null }, 'ct', 'a@b.c')).toBeNull();
    expect(code('api/_handlers/inbound.ts')).not.toContain('contractor_applications');
  });
});

describe('the row 6.2 writes', () => {
  it('sets direction = inbound explicitly, origin ghl, no sender id, GHL id for idempotency, GHL time for order', () => {
    const r = parseInboundMessage(documented());
    if (!r.ok) throw new Error('fixture');
    expect(inboundMessageRow('conv-1', r.message)).toMatchObject({
      conversation_id: 'conv-1', sender_id: null, origin: 'ghl', direction: 'inbound', channel: 'whatsapp',
      ghl_message_id: 'msg_placeholder_1', created_at: '2026-09-18T10:00:00.000Z', attachments: null,
    });
  });
  it('HARD INVARIANT: the literal direction: ‘inbound’ is in the module, and the handler uses that row and nothing hand-built', () => {
    expect(code('api/ghl/_inbound-message.ts')).toMatch(/direction:\s+'inbound'/);
    const h = code('api/_handlers/inbound.ts');
    expect(h).toContain('inboundMessageRow(thread.data as string, m)');
    expect(h).not.toMatch(/direction:\s*'(outbound|internal)'/);
  });
});

describe('the handler (static) — order, gates, and what it never touches', () => {
  const h = code('api/_handlers/inbound.ts');
  const at = (s: string) => { const i = h.indexOf(s); expect(i, `missing: ${s}`).toBeGreaterThan(-1); return i; };

  it('records the event first, then gates on GHL_INBOUND_ACT === on (capture is the default)', () => {
    expect(at(".from('ghl_inbound_events').insert(")).toBeLessThan(at("GHL_INBOUND_ACT.value === 'on'"));
    expect(at("GHL_INBOUND_ACT.value === 'on'")).toBeLessThan(at('parseInboundMessage(body)'));
    expect(h).toContain("reason: 'capture'");
  });

  it('parse → person → thread → upsert → handled_at, in that order, and handled_at only after the upsert returned', () => {
    const order = ['parseInboundMessage(body)', 'resolvePerson(', "rpc('ensure_inbound_conversation'", ".from('project_messages')", "onConflict: 'ghl_message_id', ignoreDuplicates: true", 'handled_at: new Date().toISOString()'];
    let last = -1;
    for (const s of order) { const i = at(s); expect(i, s).toBeGreaterThan(last); last = i; }
    // The failure branch between upsert and stamp returns before the stamp.
    const between = h.slice(at("onConflict: 'ghl_message_id'"), at('handled_at: new Date().toISOString()'));
    expect(between).toContain("reason: 'insert_failed'");
    expect(between).toContain('return;');
  });

  it('never updates a conversation, a notification or the Action Center — 091 does', () => {
    expect(h).not.toMatch(/from\('conversations'\)|from\('notifications'\)|last_message_at|waiting_on_us/);
  });

  it('every acting branch answers 200 — only "could not record" is a retryable 500', () => {
    // Between the gate and the catch (a throw is still GHL's retry, and the replay is idempotent).
    const acting = h.slice(at("GHL_INBOUND_ACT.value === 'on'"), at('} catch (err)'));
    expect(acting).not.toMatch(/status\(5\d\d\)/);
    expect(h.slice(0, at("GHL_INBOUND_ACT.value === 'on'"))).toMatch(/status\(500\)/);
  });

  it('the setting exists with capture as its documented default, and crm-status reports capture / acting', () => {
    expect(src('api/ghl/_config.ts')).toContain("'GHL_INBOUND_ACT'");
    const status = code('api/_handlers/crm-status.ts');
    expect(status).toContain("cfg.GHL_INBOUND_ACT.value === 'on' ? 'acting' : 'capture'");
  });

  it('no locationId check is enforced before a captured payload shows GHL supplies one', () => {
    expect(h).not.toMatch(/locationId\s*!==|GHL_LOCATION_ID/);
  });

  it('is still the existing crm-inbound action — no new serverless function', () => {
    expect(src('api/events.ts')).toContain("'crm-inbound'");
    expect(src('api/events.ts')).not.toContain('inbound-message');
  });
});
