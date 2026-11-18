import type { Conversation } from '@/lib/supabase/conversations';

// =========================================================
// The WhatsApp CRM's small decisions, kept out of the component so they can be tested.
// =========================================================

export type ChatRole = 'homeowner' | 'contractor' | 'verifier' | 'staff' | 'new';
export type ChatFilter = 'all' | 'needsReply' | 'mine' | 'newNumbers';

/**
 * What a chat partner is, from their account roles. No account at all is a number that
 * wrote in and has not been matched to anybody yet: a new number, not a homeowner.
 */
export function chatRole(personId: string | null, roles: string | undefined): ChatRole {
  if (!personId) return 'new';
  const list = (roles ?? '').split(',').map(role => role.trim());
  if (list.includes('admin')) return 'staff';
  if (list.includes('verifier')) return 'verifier';
  if (list.includes('contractor')) return 'contractor';
  return 'homeowner';
}

/**
 * Needs reply is `waiting_on_us` and nothing else (091 sets it when the person writes and
 * clears it when staff answer). Mine is the chats assigned to this admin. A search matches
 * the name shown and the last message.
 */
export function filterChats(rows: Conversation[], options: { filter: ChatFilter; query: string; me: string | null;
  title: (conversation: Conversation) => string; preview: (id: string) => string }): Conversation[] {
  const q = options.query.trim().toLowerCase();
  return rows.filter(row =>
    (options.filter === 'all'
      || (options.filter === 'needsReply' && row.status === 'waiting_on_us')
      || (options.filter === 'mine' && !!options.me && row.assignedTo === options.me)
      || (options.filter === 'newNumbers' && !row.personId))
    && (!q || `${options.title(row)} ${options.preview(row.id)}`.toLowerCase().includes(q)));
}

/**
 * The ways to reach a number from this device. WhatsApp's own calling is not connected to
 * Groundwork, so "Call" is the phone's dialer and "Open in WhatsApp" opens the chat in the
 * WhatsApp app, where a call is one tap. Null without a usable international number.
 */
export function phoneLinks(phone: string | null | undefined): { tel: string; whatsapp: string } | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  const bare = digits.replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(bare)) return null;
  return { tel: `tel:+${bare}`, whatsapp: `https://wa.me/${bare}` };
}
