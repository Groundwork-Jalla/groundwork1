import { supabase } from './client';
import type { RecipientRole } from '@/lib/admin/whatsapp-shortcut';

/**
 * "Message someone on this project on WhatsApp."
 *
 * No GoHighLevel call happens here — the browser may not make one. This posts to the
 * existing server boundary, which resolves the person's one canonical thread (or
 * establishes it through the provider) and answers with its id.
 *
 * The recipient is the client, the project's contractor, or one of its verifiers. Where a
 * role is held by several people the server refuses with `choose_person` and the candidates
 * rather than guessing, and the caller asks again naming one.
 */

export type WhatsAppShortcut =
  | { ok: true; conversationId: string; created: boolean }
  | { ok: false; reason: 'no_client' | 'no_contractor' | 'no_verifier' | 'choose_person'
        | 'no_phone' | 'not_configured' | 'contact_failed'
        | 'provider_failed' | 'record_failed' | 'conversations_unavailable' | 'ambiguous' | 'error';
      /** `choose_person`: the people holding that role, for the admin to pick from. */
      candidates?: string[]; role?: RecipientRole;
      conversationIds?: string[]; detail?: string };

export async function openProjectWhatsApp(
  projectId: string,
  recipient: RecipientRole = 'client',
  /** A specific person, when the admin has already chosen from `candidates`. */
  personId?: string | null,
): Promise<WhatsAppShortcut> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not signed in');

  const r = await fetch('/api/events?action=project-whatsapp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, recipient, personId: personId ?? undefined }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, reason: 'error', detail: String(json?.error ?? `http_${r.status}`) };
  return json as WhatsAppShortcut;
}

/** The original call, kept so existing callers do not change meaning. */
export const openClientWhatsApp = (projectId: string): Promise<WhatsAppShortcut> =>
  openProjectWhatsApp(projectId, 'client');
