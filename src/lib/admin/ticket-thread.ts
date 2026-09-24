import type { Conversation } from '@/lib/supabase/conversations';

// =========================================================
// Which conversation a support ticket should open (01 §3 SUPPORT) — pure.
//
// The first version of this picked the person's newest thread. That is a guess, and the
// cost of getting it wrong is an operator answering the wrong customer in a thread the
// customer is already reading. A person with a WhatsApp thread about their foundation
// and a platform thread about their invoice has two conversations and no newest-wins
// rule that is correct for both.
//
// So: an explicit link is a statement and wins. Exactly one thread is not a guess. More
// than one and nothing linked is a question for a person, never an answer from a sort
// order. Nothing here creates a conversation — a ticket with nowhere to go says so.
// =========================================================

export type TicketThread =
  /** 091 is not applied, or conversations could not be read at all. */
  | { kind: 'unavailable' }
  /** `support_tickets.conversation_id` — somebody linked this ticket to this thread. */
  | { kind: 'linked'; conversation: Conversation }
  /** Linked to a thread this admin cannot read. Named, not openable — say so. */
  | { kind: 'linkedMissing'; conversationId: string }
  /** The person has exactly one. Not a choice, so not a question. */
  | { kind: 'single'; conversation: Conversation }
  /** Several, none linked. The operator picks; Groundwork does not. */
  | { kind: 'choose'; conversations: Conversation[] }
  /** No account, or an account that has never written in. */
  | { kind: 'none' };

/** Newest first — for showing a list to a person, never for choosing one for them. */
export function byRecency(rows: Conversation[]): Conversation[] {
  return [...rows].sort((a, b) =>
    (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
}

export function ticketThread(
  ticket: { user_id: string | null; conversation_id?: string | null },
  byPerson: Map<string, Conversation[]> | null,
  byId: Map<string, Conversation>,
): TicketThread {
  if (byPerson === null) return { kind: 'unavailable' };

  const linkedId = ticket.conversation_id ?? null;
  if (linkedId) {
    const found = byId.get(linkedId);
    return found ? { kind: 'linked', conversation: found } : { kind: 'linkedMissing', conversationId: linkedId };
  }

  // The account was closed, or the ticket came from the public form. Either way there is
  // no person to hold a thread, and matching on the email address would be a guess.
  if (!ticket.user_id) return { kind: 'none' };

  const owned = byPerson.get(ticket.user_id) ?? [];
  if (owned.length === 0) return { kind: 'none' };
  if (owned.length === 1) return { kind: 'single', conversation: owned[0] };
  return { kind: 'choose', conversations: byRecency(owned) };
}
