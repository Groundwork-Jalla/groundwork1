import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inboundMessageRow, parseInboundMessage, resolvePerson } from '../../../api/ghl/_inbound-message';

/**
 * Phase 6.2 — the inbound pipe, proven against the captured contract.
 *
 * THE FIXTURE IS THE SANITISED TWIN OF A REAL EVENT. On 21 Sep 2026 the first Marketplace
 * `InboundMessage` was captured in `ghl_inbound_events` (06 §16.13). `real()` below has
 * exactly its twenty top-level keys and their types; every value is fabricated (ids,
 * phone numbers, body). The real row stays in the table and is never copied here.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The captured InboundMessage shape — flat, 20 keys — with placeholder values. */
const REAL_KEYS = ['appId', 'body', 'contactId', 'contentType', 'conversationId', 'dateAdded', 'direction', 'from', 'locationId',
  'messageId', 'messageType', 'messageTypeId', 'messageTypeString', 'status', 'timestamp', 'to', 'type', 'userId', 'versionId', 'webhookId'] as const;
const real = (over: Record<string, unknown> = {}) => ({
  appId: 'app_placeholder_00000000', body: 'Hello?', contactId: 'ct_placeholder_0000', contentType: 'text/plain',
  conversationId: 'cv_placeholder_0000', dateAdded: '2026-09-21T10:30:40.477Z', direction: 'inbound', from: '+10000000000',
  locationId: 'loc_placeholder_0000', messageId: 'msg_placeholder_0000', messageType: 'WhatsApp', messageTypeId: 19,
  messageTypeString: 'TYPE_WHATSAPP', status: 'delivered', timestamp: '2026-09-21T10:30:41.508Z', to: '+10000000001',
  type: 'InboundMessage', userId: '', versionId: 'ver_placeholder_00000000', webhookId: '00000000-0000-4000-8000-000000000000', ...over,
});
/** The old documented guess, kept only as "another spelling GHL uses" input. */
const documented = (over: Record<string, unknown> = {}) => ({
  type: 'InboundMessage', locationId: 'loc_placeholder', contactId: 'ct_placeholder', conversationId: 'cv_placeholder',
  messageId: 'msg_placeholder_1', messageType: 'WhatsApp', direction: 'inbound', body: 'Hello, is the foundation done?',
  dateAdded: '2026-09-18T10:00:00.000Z', attachments: [], ...over,
});

describe('the fixture is the captured contract, sanitised', () => {
  it('has exactly the twenty keys and the types of the 21 Sep 2026 capture, and no real value', () => {
    const r = real();
    expect(Object.keys(r).sort()).toEqual([...REAL_KEYS].sort());
    for (const k of REAL_KEYS) expect(typeof r[k], k).toBe(k === 'messageTypeId' ? 'number' : 'string');
    expect(r).not.toHaveProperty('attachments');
    expect(r).not.toHaveProperty('data');
    // Nothing that looks like a real GHL id (20 alnum chars) or a real phone appears in this file.
    const me = src('src/lib/ghl/inbound-message.test.ts');
    expect(me).not.toMatch(/['"][A-Za-z0-9]{20}['"]/);
    expect(me).not.toMatch(/\+237\d{8,}|\+44\d{9,}|\+1[2-9]\d{9}/);
  });
});

describe('parseInboundMessage — what is a client message we may file', () => {
  it('accepts the REAL WhatsApp shape and maps it onto 085/091 exactly', () => {
    const r = parseInboundMessage(real());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toEqual({
      ghlMessageId: 'msg_placeholder_0000',          // → project_messages.ghl_message_id (085)
      ghlContactId: 'ct_placeholder_0000',           // → ensure_inbound_conversation(p_ghl_contact_id)
      ghlConversationId: 'cv_placeholder_0000',      // → ensure_inbound_conversation(p_ghl_conversation_id)
      channel: 'whatsapp', body: 'Hello?', senderName: 'whatsapp',
      sentAt: '2026-09-21T10:30:40.477Z',            // dateAdded — the message time, not the delivery `timestamp`
      attachments: [], locationId: 'loc_placeholder_0000',
    });
  });
  it('from / to are transport addresses: never sender_name, never anywhere in the row', () => {
    const r = parseInboundMessage(real({ from: '+10000000099', to: '+10000000098' }));
    if (!r.ok) throw new Error('fixture');
    expect(r.message.senderName).toBe('whatsapp');
    expect(JSON.stringify(inboundMessageRow('c', r.message))).not.toMatch(/\+1000000009[89]/);
    expect(code('api/ghl/_inbound-message.ts')).not.toMatch(/first\(p,[^)]*'(from|to)'/);
  });
  it('channel from the word, else the TYPE_ string, else the number — and the number only when established', () => {
    expect(parseInboundMessage(real({ messageType: undefined }))).toMatchObject({ ok: true, message: { channel: 'whatsapp' } });                          // messageTypeString
    expect(parseInboundMessage(real({ messageType: undefined, messageTypeString: undefined }))).toMatchObject({ ok: true, message: { channel: 'whatsapp' } }); // messageTypeId 19
    expect(parseInboundMessage(real({ messageType: undefined, messageTypeString: undefined, messageTypeId: 3 }))).toMatchObject({ ok: false, reason: 'malformed', detail: 'unknown messageType: id 3' });
    expect(parseInboundMessage(real({ messageType: undefined, messageTypeString: undefined, messageTypeId: '19' }))).toMatchObject({ ok: false, reason: 'malformed' });   // a string is not the established number
    expect(code('api/ghl/_inbound-message.ts')).toMatch(/CHANNEL_OF_ID[^=]*=\s*\{\s*19:\s*'whatsapp'\s*\}/);   // exactly one established mapping
  });
  it('the documented shape is still read (another spelling), so are snake_case keys', () => {
    expect(parseInboundMessage(documented())).toMatchObject({ ok: true, message: { channel: 'whatsapp', ghlMessageId: 'msg_placeholder_1' } });
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

  it('location authority: after parse, before the person lookup; absent / mismatch / unconfigured are told apart; nothing filed', () => {
    expect(at('parseInboundMessage(body)')).toBeLessThan(at("reason: 'wrong_location'"));
    expect(at("reason: 'wrong_location'")).toBeLessThan(at('resolvePerson('));
    expect(h).toContain("!expectedLocation ? 'unconfigured' : !m.locationId ? 'absent' : m.locationId !== expectedLocation ? 'mismatch' : null");
    expect(h).toContain('settings.GHL_LOCATION_ID.value');
    const refusal = h.slice(at("const locationDetail"), at('resolvePerson('));
    expect(refusal).toContain('return;');
    expect(refusal).not.toMatch(/project_messages|ensure_inbound_conversation|handled_at/);
  });

  it('is still the existing crm-inbound action — no new serverless function', () => {
    expect(src('api/events.ts')).toContain("'crm-inbound'");
    expect(src('api/events.ts')).not.toContain('inbound-message');
  });
});
