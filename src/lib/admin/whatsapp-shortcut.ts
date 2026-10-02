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

// ── Who on this project is being messaged ────────────────────────────────────────────
//
// The WhatsApp shortcut used to mean one thing only: the client. But a project has three
// kinds of person an admin needs to reach — the client whose money it is, the general
// contractor who reports progress, and the verifier who checks a finished stage — and each
// is reached the same way, because a conversation is keyed on the PERSON (091), never on a
// role. So the only new question is which person the admin meant.
//
// Kept pure and separate from the handler so the choice can be tested without a database:
// getting it wrong means a message about somebody's build reaching the wrong person.

export type RecipientRole = 'client' | 'contractor' | 'verifier';

/** An accepted contractor on the project. `isPrimary` is the one who gets paid (101). */
export interface RecipientContractor {
  userId: string;
  isPrimary: boolean;
}

/** An active verifier assignment (086). Several disciplines can be assigned at once. */
export interface RecipientVerifier {
  userId: string;
  discipline: string;
}

export interface ProjectPeople {
  clientId: string | null;
  contractors: RecipientContractor[];
  verifiers: RecipientVerifier[];
}

export type RecipientResolution =
  | { kind: 'person'; personId: string }
  /** Nobody of that role is on the project. */
  | { kind: 'none'; role: RecipientRole }
  /**
   * More than one, and no way to tell which was meant. The admin picks; this never picks
   * for them, because the wrong choice sends project details to the wrong professional.
   */
  | { kind: 'choose'; role: RecipientRole; candidates: string[] };

/**
 * Which person an admin meant.
 *
 * `personId` short-circuits everything: when the admin has already chosen from a list, that
 * choice is honoured provided the person really does hold that role on this project — a
 * request naming somebody who does not is refused rather than trusted.
 *
 * Without an explicit choice: the client is unambiguous; a contractor falls back to the
 * primary, since that is already the project's designated point of contact; a verifier never
 * falls back, because "a verifier on this project" is not a person — disciplines are
 * different people doing different checks.
 */
export function resolveRecipient(
  role: RecipientRole,
  people: ProjectPeople,
  personId?: string | null,
): RecipientResolution {
  const holders =
    role === 'client'     ? (people.clientId ? [people.clientId] : [])
    : role === 'contractor' ? people.contractors.map(c => c.userId)
    : people.verifiers.map(v => v.userId);

  if (holders.length === 0) return { kind: 'none', role };

  if (personId) {
    return holders.includes(personId)
      ? { kind: 'person', personId }
      // Not a refusal to be smoothed over: the caller asked to message somebody who is not
      // on this project in that role.
      : { kind: 'none', role };
  }

  if (role === 'client') return { kind: 'person', personId: holders[0] };

  if (role === 'contractor') {
    const primary = people.contractors.find(c => c.isPrimary);
    if (primary) return { kind: 'person', personId: primary.userId };
    if (holders.length === 1) return { kind: 'person', personId: holders[0] };
    return { kind: 'choose', role, candidates: holders };
  }

  // Verifier. One assignment is unambiguous; several disciplines are not.
  if (holders.length === 1) return { kind: 'person', personId: holders[0] };
  return { kind: 'choose', role, candidates: holders };
}
