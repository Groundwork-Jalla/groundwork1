// Relative and extensioned: this module is reached from `api/`, where no `@/*`
// alias exists to expand. See api-import-graph.test.ts.
import { isE164 } from '../phone.js';

// =========================================================
// Which WhatsApp thread is *the* client's (06 §22) — pure.
//
// ── One client, one WhatsApp chat ────────────────────────────────────────────────────
// A WhatsApp conversation belongs to the PERSON, not to a project. GoHighLevel agrees:
// `ensureConversation(cfg, contactId)` searches by contact alone and has no channel or
// project dimension, and `conversations.ghl_conversation_id` is UNIQUE — so exactly one
// Groundwork row can ever carry a given provider thread.
//
// The WhatsApp button in a Project Workspace is therefore a shortcut meaning "message
// this project's client", not "start a conversation for this project". Mary with two
// projects has one chat, reached from either. Clicking from Project B never creates a
// second thread and never re-points Mary's existing one away from Project A.
//
// ── Why "newest wins" is not allowed here ────────────────────────────────────────────
// Historical data may hold more than one local WhatsApp row for one person. Only one of
// them can be the provider's thread, and `ghl_conversation_id` is what says which. So the
// row carrying provider identity wins outright; two rows carrying DIFFERENT provider ids
// for the same person is a real inconsistency in the data and is reported, because
// picking one would silently strand half the person's history.
// =========================================================

export interface WhatsAppRow {
  id: string;
  personId: string | null;
  projectId: string | null;
  channel: string;
  ghlConversationId: string | null;
  ghlContactId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export type Resolution =
  /** Exactly one canonical thread. Open it; change nothing about it. */
  | { kind: 'found'; conversationId: string }
  /** No WhatsApp thread for this person yet — the caller may establish one. */
  | { kind: 'none' }
  /** Several rows claim different provider threads. A person cannot have two. */
  | { kind: 'ambiguous'; conversationIds: string[] };

/**
 * The person's canonical WhatsApp thread.
 *
 * Provider identity decides. A row with a `ghl_conversation_id` IS the provider's thread;
 * a row without one is a local shell that has never carried a message across the
 * boundary, and it loses to a row that has.
 */
export function resolveWhatsAppThread(rows: WhatsAppRow[], personId: string): Resolution {
  const mine = rows.filter(r => r.personId === personId && r.channel === 'whatsapp');
  if (mine.length === 0) return { kind: 'none' };

  const withProvider = mine.filter(r => !!r.ghlConversationId);
  if (withProvider.length === 1) return { kind: 'found', conversationId: withProvider[0].id };
  if (withProvider.length > 1) {
    // Two rows naming the same provider thread cannot exist — the unique index forbids
    // it — so more than one here means genuinely different threads for one person.
    return { kind: 'ambiguous', conversationIds: withProvider.map(r => r.id).sort() };
  }

  // None has provider identity. One shell is unambiguous; several is a mess somebody
  // made, and creating a third would not improve it.
  if (mine.length === 1) return { kind: 'found', conversationId: mine[0].id };
  return { kind: 'ambiguous', conversationIds: mine.map(r => r.id).sort() };
}

/**
 * Is this a number WhatsApp could actually reach?
 *
 * One implementation, shared with the profile form that stores the number and the GHL
 * layer that sends to it — a number accepted at the keyboard and rejected at the provider
 * would be the worst of both.
 */
export const isDeliverablePhone = isE164;

/** Where the Inbox opens a thread. One addressing pattern, shared with the rest of admin. */
export const inboxHref = (conversationId: string): string =>
  `/admin/inbox?channel=whatsapp&conversation=${conversationId}`;
