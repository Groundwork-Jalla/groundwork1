/**
 * GoHighLevel → Groundwork: what an inbound message webhook is, and what it becomes.
 *
 * ── Pinned to the captured contract (21 Sep 2026) ───────────────────────────────────
 * The field map is taken from the first real Marketplace `InboundMessage` delivery,
 * captured in `ghl_inbound_events` on 21 Sep 2026 (06 §16.13) — not from documentation.
 * It is FLAT, twenty top-level keys, no `data` envelope:
 *
 *   type "InboundMessage" · direction "inbound" · messageType "WhatsApp" ·
 *   messageTypeId (number) · messageTypeString ("TYPE_WHATSAPP" spelling) · messageId ·
 *   conversationId · contactId · locationId · webhookId · dateAdded (message time) ·
 *   timestamp (delivery time) · body · contentType · status · from / to (phone numbers) ·
 *   appId · versionId · userId
 *
 * A text message carries no `attachments` key and no contact name or email. `from` and
 * `to` are transport addresses — personal data — and are never read into anything.
 * The sanitised twin of that payload (same keys and types, fabricated values) is the
 * fixture in `src/lib/ghl/inbound-message.test.ts`; the real one stays in the table.
 *
 * Reading stays tolerant of the other spellings GHL uses elsewhere (snake_case, the
 * `TYPE_` words), because tolerance costs nothing and the validations that matter —
 * a message, inbound, a known channel, an id, a contact, a body — are unchanged.
 *
 * ── Pure ─────────────────────────────────────────────────────────────────────────────
 * No I/O. `parseInboundMessage` decides whether a payload is a client's inbound message
 * we can file and, if so, exactly what to write; `resolvePerson` names the two lookups in
 * the approved order and nothing else. The handler does the I/O; the tests do not need it.
 */

/** 091's channels. SMS is deliberately absent (D1): an SMS event is `channel_disabled`. */
export type Channel = 'jalla' | 'whatsapp' | 'email' | 'call';

export interface InboundMessage {
  ghlMessageId: string;
  ghlContactId: string;
  ghlConversationId: string | null;
  channel: Channel;
  body: string;
  /** What GHL called the sender, when it says; else the channel name. */
  senderName: string;
  /** ISO timestamp GHL supplied, or null (then the row's default `now()` stands). */
  sentAt: string | null;
  attachments: unknown[];
  locationId: string | null;
}

export type ParseOutcome =
  | { ok: true; message: InboundMessage }
  | { ok: false; reason: 'not_a_message' | 'not_inbound' | 'malformed' | 'channel_disabled'; detail?: string };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const first = (o: Rec, ...keys: string[]): string => { for (const k of keys) { const s = str(o[k]); if (s) return s; } return ''; };

/** GHL's message type words → our channel. Anything else is not a channel we file. */
const CHANNEL_OF: Record<string, Channel | 'sms'> = {
  email: 'email', whatsapp: 'whatsapp', sms: 'sms', call: 'call',
  // the `messageTypeString` spellings
  type_email: 'email', type_whatsapp: 'whatsapp', type_sms: 'sms', type_call: 'call', type_phone: 'call',
};

/**
 * GHL's numeric `messageTypeId` → our channel — ONLY the values established by evidence.
 * 19 = WhatsApp: the workflow webhook captured on 18 Sep 2026 carried `message.type: 19`
 * on a WhatsApp message from the same contact (06 §16.1). Nothing else is mapped until a
 * capture shows it; an unmapped number is `malformed`, never a guess.
 */
const CHANNEL_OF_ID: Record<number, Channel | 'sms'> = { 19: 'whatsapp' };

export function parseInboundMessage(payload: unknown): ParseOutcome {
  const p = rec(payload);
  const type = first(p, 'type', 'event', 'eventType').toLowerCase();
  if (!type) return { ok: false, reason: 'malformed', detail: 'no type' };
  // Only a message. Appointments, tags, opportunities and the rest are for other steps.
  if (!/message$/.test(type)) {
    return { ok: false, reason: 'not_a_message', detail: type };
  }
  // Only inbound. An OutboundMessage — a staff reply — is crm-delivery's, never ours: filing
  // it here would create a second copy of something staff said, and with a direction of
  // our choosing. The word "inbound"/"outbound" in the type stands in for the direction
  // when GHL sends no separate field.
  const direction = first(p, 'direction').toLowerCase() || (/inbound/.test(type) ? 'inbound' : /outbound/.test(type) ? 'outbound' : '');
  if (direction !== 'inbound') return { ok: false, reason: 'not_inbound', detail: direction || 'no direction' };

  // Channel: the word (`messageType`), else the TYPE_ spelling (`messageTypeString`), else
  // the number (`messageTypeId`) when — and only when — that number has been seen.
  const rawType = first(p, 'messageType', 'message_type', 'messageTypeString', 'channel').toLowerCase().replace(/[\s-]+/g, '_');
  const typeId = typeof p.messageTypeId === 'number' ? p.messageTypeId : NaN;
  const channel = CHANNEL_OF[rawType] ?? CHANNEL_OF_ID[typeId];
  if (!channel) return { ok: false, reason: 'malformed', detail: `unknown messageType: ${rawType || (Number.isNaN(typeId) ? 'none' : `id ${typeId}`)}` };
  if (channel === 'sms') return { ok: false, reason: 'channel_disabled', detail: 'sms' };

  const ghlMessageId = first(p, 'messageId', 'message_id', 'id');
  const ghlContactId = first(p, 'contactId', 'contact_id');
  const body = first(p, 'body', 'message', 'text', 'content');
  if (!ghlMessageId) return { ok: false, reason: 'malformed', detail: 'no message id' };
  if (!ghlContactId) return { ok: false, reason: 'malformed', detail: 'no contact id' };
  if (!body) return { ok: false, reason: 'malformed', detail: 'empty body' };

  // A name, when GHL sends one; otherwise the channel word. NEVER `from` / `to` — those are
  // phone numbers or addresses, and a client's number must not become a display name.
  const contact = rec(p.contact);
  const senderName = first(p, 'fromName', 'from_name', 'contactName', 'userName') || first(contact, 'name', 'fullName')
    || [first(contact, 'firstName', 'first_name'), first(contact, 'lastName', 'last_name')].filter(Boolean).join(' ')
    || channel;
  const dateRaw = first(p, 'dateAdded', 'date_added', 'timestamp', 'createdAt');
  const sentAt = dateRaw && !Number.isNaN(new Date(dateRaw).getTime()) ? new Date(dateRaw).toISOString() : null;

  return {
    ok: true,
    message: {
      ghlMessageId, ghlContactId,
      ghlConversationId: first(p, 'conversationId', 'conversation_id') || null,
      channel, body, senderName, sentAt,
      attachments: Array.isArray(p.attachments) ? p.attachments : [],
      locationId: first(p, 'locationId', 'location_id') || null,
    },
  };
}

/** The two lookups the handler may make, in the approved order, and nothing else. */
export interface PersonLookup {
  byGhlContactId(contactId: string): Promise<string | null>;
  byEmail(email: string): Promise<string | null>;
}

/**
 * Identify the person (06 §14.3): `profiles.ghl_contact_id`, then `profiles.email` ILIKE
 * when the payload carries an email. Never `contractor_applications`, never a guess.
 */
export async function resolvePerson(lookup: PersonLookup, contactId: string, email: string | null): Promise<string | null> {
  const byContact = await lookup.byGhlContactId(contactId);
  if (byContact) return byContact;
  if (email) return lookup.byEmail(email);
  return null;
}

/**
 * The exact row written for an inbound message. `direction: 'inbound'` is set here, once,
 * explicitly: the BEFORE trigger derives a direction only when the writer left it NULL, and
 * for `origin = 'ghl'` with no session its default is OUTBOUND (a staff reply typed in GHL).
 * Leaving it out would record a client's words as something staff said.
 */
export function inboundMessageRow(conversationId: string, m: InboundMessage) {
  return {
    conversation_id: conversationId,
    sender_id:       null,
    sender_name:     m.senderName,
    content:         m.body,
    origin:          'ghl',
    direction:       'inbound',
    channel:         m.channel,
    attachments:     m.attachments.length ? m.attachments : null,
    ghl_message_id:  m.ghlMessageId,
    ghl_synced_at:   new Date().toISOString(),
    ...(m.sentAt ? { created_at: m.sentAt } : {}),
  } as const;
}
