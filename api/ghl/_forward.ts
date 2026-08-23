/**
 * One way in to GoHighLevel.
 *
 * Every lifecycle event the product wants the CRM to know about goes through here, so
 * there is a single place that knows the envelope, the failure behaviour and the
 * bookkeeping. `api/ghl/contractor.ts` predates this and keeps its own webhook — it
 * works, it is the one path Philip has already built a workflow against, and changing
 * it to prove a point would risk the only integration currently running.
 *
 * **One webhook for everything else.** Each new event could have its own inbound webhook,
 * but every one of those is a URL Philip has to create and a workflow he has to maintain.
 * Instead they share `GHL_EVENT_WEBHOOK_URL` and carry an `event` field to branch on, so
 * adding an event here costs nothing on the GHL side until someone wants to act on it.
 *
 * **Never throws.** Every caller is mirroring something already committed to Supabase —
 * a signup that happened, a payment that cleared, a decision an admin made. A CRM outage
 * must not turn any of those into a visible failure. Callers get a result they can record
 * and ignore.
 */

/** Events the CRM can be told about. Adding one here is the whole change on our side. */
export type GhlEvent =
  | 'user_signup'
  | 'application_decision'
  | 'subscription_changed'
  | 'project_created';

export interface GhlContact {
  email: string;
  fullName?: string | null;
  phone?: string | null;
  country?: string | null;
  lang?: string | null;
}

export interface GhlForwardResult {
  ok: boolean;
  /** 'not_configured' is a soft miss, not a fault — see the note on the env var below. */
  reason?: 'not_configured' | 'no_email' | 'rejected' | 'unreachable';
  status?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split a display name the way the existing contractor payload does, so both streams
 * map onto the same GHL fields. Naive on purpose: GHL wants two boxes, people have all
 * sorts of names, and the full string is sent alongside for anything that matters.
 */
function splitName(full: string | null | undefined): { first: string; last: string } {
  const name = (full ?? '').trim();
  if (!name) return { first: '', last: '' };
  const i = name.indexOf(' ');
  return i === -1
    ? { first: name, last: '' }
    : { first: name.slice(0, i), last: name.slice(i + 1).trim() };
}

/**
 * Send one event. Returns whether GHL accepted it; never rejects.
 *
 * `fields` is merged into the envelope for event-specific detail — keep it flat, because
 * GHL custom fields are flat and a nested object arrives as unusable JSON text.
 */
export async function forwardToGhl(
  event: GhlEvent,
  contact: GhlContact,
  fields: Record<string, string | number | boolean | null> = {},
): Promise<GhlForwardResult> {
  const webhookUrl = process.env.GHL_EVENT_WEBHOOK_URL;
  if (!webhookUrl) {
    // Soft: an unconfigured deploy should not fail requests or fill logs with errors.
    // It is reported so `synced_to_ghl` stays false and the backlog is visible.
    console.warn(`[ghl] GHL_EVENT_WEBHOOK_URL is not set — "${event}" not forwarded`);
    return { ok: false, reason: 'not_configured' };
  }

  const email = (contact.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    console.warn(`[ghl] "${event}" has no usable email — not forwarded`);
    return { ok: false, reason: 'no_email' };
  }

  const { first, last } = splitName(contact.fullName);

  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Same envelope the contractor payload uses, so one field mapping covers both.
        event,
        email,
        full_name:  (contact.fullName ?? '').trim(),
        first_name: first,
        last_name:  last,
        phone:      contact.phone ?? null,
        country:    contact.country ?? null,
        lang:       contact.lang === 'fr' ? 'fr' : 'en',
        source:     `groundwork_${event}`,
        submitted_at: new Date().toISOString(),
        ...fields,
      }),
    });

    if (!r.ok) {
      // The upstream body is deliberately not returned to callers — same as
      // api/ghl/contractor.ts. It can carry account detail we do not want in a response.
      console.error(`[ghl] "${event}" rejected:`, r.status, await r.text().catch(() => ''));
      return { ok: false, reason: 'rejected', status: r.status };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[ghl] "${event}" could not reach GHL:`, err);
    return { ok: false, reason: 'unreachable' };
  }
}
