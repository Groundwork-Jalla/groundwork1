import { supabase } from './client';

/**
 * Make sure the signed-in person has their own WhatsApp thread.
 *
 * A contractor saw a WhatsApp tab in Messages and the client saw only Groundwork, because
 * nothing had ever created the client's thread — it took an admin pressing a button, a
 * message arriving from their phone, or 126's fan-out. Seeing the channel that reaches
 * your own phone should not wait on any of those.
 *
 * ── Attempted once ──────────────────────────────────────────────────────────────────
 * Establishing a thread talks to the provider, so this must not fire on every navigation.
 * One attempt per person per page load is enough: the row persists, and the next load
 * simply finds it.
 */
const attempted = new Set<string>();

export async function ensureMyWhatsApp(userId: string): Promise<boolean> {
  if (attempted.has(userId)) return false;
  attempted.add(userId);

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;

    const r = await fetch('/api/events?action=my-whatsapp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return false;
    const json = await r.json().catch(() => ({}));
    // `created` is the only answer worth a reload: found means it was already in the list,
    // and a refusal (no phone, not configured) means there is nothing to show.
    return json?.ok === true && json?.created === true;
  } catch {
    // Never surfaced. Messages must render whether or not a transport can be established.
    return false;
  }
}
