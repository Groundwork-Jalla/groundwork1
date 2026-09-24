import { supabase } from './client';
import { normalisePhone, isE164 } from '@/lib/phone';

/**
 * The client's own contact number — canonical in `profiles.phone`.
 *
 * ── The bug this exists to close ─────────────────────────────────────────────────────
 * The profile form saved the phone to `auth.users.user_metadata` and nowhere else.
 * `profiles.phone` has existed since migration 001 and NOTHING wrote it, so every
 * product feature that reads it — the WhatsApp shortcut most of all — saw NULL for every
 * account, while the client saw "Saved" and believed they had given us their number.
 *
 * `profiles.phone` is authoritative from here. `user_metadata.phone` is kept aligned
 * because other account UI still reads it, but it is a copy, never the source.
 *
 * ── Stored canonical, not as typed ───────────────────────────────────────────────────
 * People in Cameroon write their number the way they say it: `670 00 00 00`. GoHighLevel
 * addresses a contact by E.164, so a contact stored as typed has a phone field that looks
 * filled in and cannot be messaged. Normalisation happens HERE, at the write, so what is
 * stored is what can be sent.
 */

export type PhoneProblem = 'invalid';

/** What the form should show: the canonical value, or a legacy one it can rescue. */
export interface ClientContact {
  /** `profiles.phone` — the real one. */
  phone: string | null;
  /**
   * A number the client typed before this was fixed, still sitting in `user_metadata`.
   * Offered as the form's starting value so they do not have to remember it again; it
   * becomes canonical the moment they save.
   */
  legacyPhone: string | null;
  country: string | null;
}

export async function loadClientContact(userId: string, metadata: Record<string, unknown> | undefined): Promise<ClientContact> {
  const { data } = await supabase.from('profiles').select('phone, country').eq('id', userId).maybeSingle();
  const phone = (data?.phone as string | null) ?? null;
  const legacy = typeof metadata?.phone === 'string' ? metadata.phone.trim() : '';
  return {
    phone,
    // Only when there is nothing canonical: a stored number always wins over a copy.
    legacyPhone: phone ? null : (legacy || null),
    country: (data?.country as string | null) ?? null,
  };
}

/**
 * Save the number the client gave us.
 *
 * An empty value is legitimate and clears the field — not everyone wants to be reached
 * this way, and a blank is honest. Anything that is not blank must be messageable, or it
 * is refused rather than stored as provider-ready data that is not.
 */
export async function saveClientPhone(
  userId: string,
  raw: string,
  country: string | null,
): Promise<{ ok: true; phone: string | null } | { ok: false; problem: PhoneProblem }> {
  const typed = raw.trim();
  let canonical: string | null = null;

  if (typed) {
    canonical = normalisePhone(typed, country);
    if (!isE164(canonical)) return { ok: false, problem: 'invalid' };
  }

  // RLS (001) allows a person to update their own row and no other.
  const { error } = await supabase.from('profiles').update({ phone: canonical }).eq('id', userId);
  if (error) throw error;

  return { ok: true, phone: canonical };
}

/**
 * Tell the CRM the number changed.
 *
 * Through the server, never the browser — and deliberately separate from the save: a CRM
 * that is down or unconfigured must not stop a client recording their own phone number.
 * The caller treats a failure here as "not mirrored yet", not as "not saved".
 */
export async function syncPhoneToCrm(): Promise<{ ok: boolean; reason?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: 'not_signed_in' };
  try {
    const r = await fetch('/api/events?action=crm-user', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncPhone: true }),
    });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok && json?.ok !== false, reason: json?.reason };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
