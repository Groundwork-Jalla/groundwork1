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

export interface WindowStatus {
  open: boolean;
  tone: 'open' | 'expiring' | 'closed';
  hoursLeft: number;
  minutesLeft: number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const EXPIRING_MS = 3 * 60 * 60 * 1000;

/**
 * Meta's 24-hour customer-service window from the contact's last inbound message.
 * Open (>3h left) = green, expiring (<=3h left) = amber, closed/none = template required.
 */
export function whatsappWindowStatus(
  lastInboundAt: string | null | undefined,
  nowMs = Date.now(),
): WindowStatus {
  if (!lastInboundAt) return { open: false, tone: 'closed', hoursLeft: 0, minutesLeft: 0 };
  const ts = Date.parse(lastInboundAt);
  if (!Number.isFinite(ts)) return { open: false, tone: 'closed', hoursLeft: 0, minutesLeft: 0 };
  const remaining = WINDOW_MS - (nowMs - ts);
  if (remaining <= 0) return { open: false, tone: 'closed', hoursLeft: 0, minutesLeft: 0 };
  const totalMinutes = Math.max(1, Math.floor(remaining / 60_000));
  const hoursLeft = Math.floor(totalMinutes / 60);
  const minutesLeft = totalMinutes % 60;
  return {
    open: true,
    tone: remaining <= EXPIRING_MS ? 'expiring' : 'open',
    hoursLeft,
    minutesLeft,
  };
}

/** Extract the BODY text from a synced Meta template definition JSON. */
export function extractTemplateBody(definition: unknown): string {
  if (!definition || typeof definition !== 'object') return '';
  const def = definition as { components?: Array<{ type?: string; text?: string }>; body?: string };
  if (Array.isArray(def.components)) {
    const bodyComp = def.components.find(c => String(c?.type ?? '').toUpperCase() === 'BODY');
    if (typeof bodyComp?.text === 'string') return bodyComp.text;
  }
  return typeof def.body === 'string' ? def.body : '';
}

/** Highest `{{N}}` variable slot inside a Meta template body (clamped 0..10). */
export function templateParamCount(bodyText: string): number {
  let max = 0;
  for (const match of bodyText.matchAll(/\{\{(\d+)\}\}/g)) {
    const idx = Number(match[1]);
    if (Number.isInteger(idx) && idx > max) max = idx;
  }
  return Math.min(max, 10);
}

/** Render a live WhatsApp bubble preview by substituting `{{1}}..{{n}}` slots. */
export function renderTemplatePreview(bodyText: string, params: string[]): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (token, rawIdx) => {
    const idx = Number(rawIdx) - 1;
    const val = params[idx]?.trim();
    return val ? val : token;
  });
}
