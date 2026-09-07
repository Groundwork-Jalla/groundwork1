import { supabase } from './client';

/**
 * Support tickets.
 *
 * ── Why this module exists ───────────────────────────────────────────────────────────
 * Two screens wrote to `support_tickets` directly and disagreed about its shape —
 * `help.tsx` sent `message`, `profile.tsx` sent `body` — against a table that had never
 * been created. Both caught the resulting error and told the user it had worked, so every
 * support message and every account-deletion request since launch was discarded silently.
 *
 * The table exists now (migration 074). This module is what stops the two screens drifting
 * apart again: one shape, one insert, and errors that are thrown rather than swallowed.
 *
 * ── The rule for callers ─────────────────────────────────────────────────────────────
 * These throw. A caller that catches must show the person a failure — never a success
 * message, and never silence. If we cannot store what someone told us, the one thing we
 * must not do is tell them we did.
 */

export type TicketKind   = 'support' | 'account_deletion';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface SupportTicket {
  id: string;
  user_id: string | null;
  kind: TicketKind;
  name: string | null;
  email: string;
  subject: string;
  message: string;
  status: TicketStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewTicket {
  /** Required. RLS enforces `user_id = auth.uid()`, so an unattributed ticket is refused. */
  userId: string;
  email: string;
  subject: string;
  message: string;
  kind?: TicketKind;
  name?: string | null;
}

/**
 * File a ticket. Throws if it does not land.
 *
 * The insert alone is the whole client responsibility: the admin email and the in-app
 * notification are fired by a trigger on the table (074), so they cannot be forgotten by
 * a new caller and cannot be skipped by one that fails half-way.
 */
export async function createSupportTicket(t: NewTicket): Promise<void> {
  const { error } = await supabase.from('support_tickets').insert({
    user_id: t.userId,
    kind:    t.kind ?? 'support',
    name:    t.name ?? null,
    email:   t.email,
    subject: t.subject,
    message: t.message,
  });

  if (error) {
    // Deliberately loud. The previous version of this code treated "relation does not
    // exist" as success, which is how the table's absence went unnoticed for a whole beta.
    console.error('[support] ticket insert failed:', error);
    throw new Error(error.message);
  }
}

/** The admin queue, newest first. RLS returns only your own rows unless you are an admin. */
export async function listSupportTickets(limit = 200): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SupportTicket[];
}

/**
 * Move a ticket through the queue. Admin only, enforced by RLS.
 *
 * `subject`, `message`, `email`, `kind` and `user_id` cannot be changed here or anywhere
 * else — a BEFORE UPDATE trigger pins them. The ticket is the record of what was actually
 * said to us; corrections belong in `admin_notes`.
 */
export async function updateSupportTicket(
  id: string,
  patch: { status?: TicketStatus; admin_notes?: string | null },
): Promise<void> {
  const { error } = await supabase.from('support_tickets').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
