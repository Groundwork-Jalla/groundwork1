import { supabase } from './client';

/**
 * "Message this project's client on WhatsApp."
 *
 * No GoHighLevel call happens here — the browser may not make one. This posts to the
 * existing server boundary, which resolves the person's one canonical thread (or
 * establishes it through the provider) and answers with its id.
 */

export type WhatsAppShortcut =
  | { ok: true; conversationId: string; created: boolean }
  | { ok: false; reason: 'no_client' | 'no_phone' | 'not_configured' | 'contact_failed'
        | 'provider_failed' | 'record_failed' | 'conversations_unavailable' | 'ambiguous' | 'error';
      conversationIds?: string[]; detail?: string };

export async function openClientWhatsApp(projectId: string): Promise<WhatsAppShortcut> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not signed in');

  const r = await fetch('/api/events?action=project-whatsapp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, reason: 'error', detail: String(json?.error ?? `http_${r.status}`) };
  return json as WhatsAppShortcut;
}
