import { ghlConfig, upsertContact, addContactTags, moveToStage } from './_client.js';
import { tagsFor, stageFor } from './_pipeline.js';

/**
 * One way in to GoHighLevel.
 *
 * Every lifecycle event the product wants the CRM to know about goes through here, so
 * there is a single place that knows the envelope, the failure behaviour and the
 * bookkeeping. `api/ghl/contractor.ts` predates this and keeps its own webhook — it
 * works, it is the one path Philip has already built a workflow against, and changing
 * it to prove a point would risk the only integration currently running.
 *
 * ── Two ways out, in order of preference ─────────────────────────────────────────────
 *   1. **The v2 API**, when GHL_API_TOKEN and GHL_LOCATION_ID are set. Upserts the
 *      contact by email, so a person who signs up, then applies, then subscribes is one
 *      record with a history instead of three. Returns a contact id, which is what makes
 *      tags and pipeline moves possible at all.
 *   2. **The inbound webhook**, when they are not. Phase 1's behaviour, kept so setting
 *      up the API is a switch rather than a cutover — nothing breaks while the token is
 *      still a to-do, and nothing needs redeploying when it arrives.
 *
 * ── Never throws ─────────────────────────────────────────────────────────────────────
 * Every caller is mirroring something already committed to Supabase: a signup that
 * happened, a payment that cleared, a decision an admin made. A CRM outage must not turn
 * any of those into a visible failure. Callers get a result they can record and ignore.
 *
 * ── The outbox ───────────────────────────────────────────────────────────────────────
 * The intent is written down *before* the attempt. An outage used to lose the event with
 * nothing to show for it; now it leaves a row that `api/ghl/retry.ts` can pick up. The
 * outbox is best-effort itself — if even that write fails, the send still goes ahead,
 * because losing the bookkeeping is better than losing the event.
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
  city?: string | null;
  lang?: string | null;
}

export interface GhlForwardOptions {
  /**
   * Distinguishes meanings within one event — 'accepted' vs 'rejected', 'active' vs
   * 'canceled'. Drives the extra tag and the pipeline stage.
   */
  variant?: string;
  /**
   * Makes a repeat a no-op. Two pushes for the same real-world fact — a double click, a
   * Stripe retry, a browser firing on every session — collapse to one outbox row.
   * Defaults to event + email, which is right for once-per-person events and wrong for
   * anything repeatable, so those callers pass their own.
   */
  dedupeKey?: string;
  /** Already-known GHL contact id, saving a lookup. */
  contactId?: string | null;
}

export interface GhlForwardResult {
  ok: boolean;
  /** 'not_configured' is a soft miss, not a fault. */
  reason?: 'not_configured' | 'no_email' | 'rejected' | 'unreachable';
  status?: number;
  /** Present when the API path ran — store it, it is the point of Phase 2. */
  contactId?: string;
  via?: 'api' | 'webhook';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split a display name the way the contractor payload does, so both streams map onto the
 * same GHL fields. Naive on purpose: GHL wants two boxes, people have all sorts of names,
 * and the full string is sent alongside for anything that matters.
 */
function splitName(full: string | null | undefined): { first: string; last: string } {
  const name = (full ?? '').trim();
  if (!name) return { first: '', last: '' };
  const i = name.indexOf(' ');
  return i === -1
    ? { first: name, last: '' }
    : { first: name.slice(0, i), last: name.slice(i + 1).trim() };
}

async function admin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Record the intent. Returns the row id, or null if the outbox is unavailable — in which
 * case the send still proceeds unrecorded, because the event matters more than the log.
 * A duplicate key means this exact fact is already recorded; the caller stops.
 */
async function claimOutbox(
  event: GhlEvent, email: string, payload: Record<string, unknown>, dedupeKey: string,
): Promise<{ id: string | null; alreadySent: boolean; contactId?: string }> {
  const db = await admin();
  if (!db) return { id: null, alreadySent: false };

  const { data, error } = await db
    .from('ghl_outbox')
    .insert({ event, email, payload, dedupe_key: dedupeKey })
    .select('id')
    .single();

  if (!error) return { id: data?.id ?? null, alreadySent: false };

  if (error.code !== '23505') {
    console.warn('[ghl] could not record outbox intent:', error.message);
    return { id: null, alreadySent: false };
  }

  // A row for this exact fact already exists — but "exists" is not "delivered". An
  // earlier attempt that failed leaves one behind, and treating that as done would let
  // the caller mark somebody synced who never reached the CRM. Only a sent row short
  // -circuits; anything else is retried against the same row.
  const { data: existing } = await db
    .from('ghl_outbox')
    .select('id, status, contact_id')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();

  return existing?.status === 'sent'
    ? { id: existing.id as string, alreadySent: true, contactId: (existing.contact_id as string | null) ?? undefined }
    : { id: (existing?.id as string | null) ?? null, alreadySent: false };
}

async function settleOutbox(
  id: string | null, ok: boolean, contactId?: string, err?: string,
): Promise<void> {
  if (!id) return;
  const db = await admin();
  if (!db) return;

  // Read-then-write rather than a counter expression: attempts is for a human reading
  // the backlog, and a lost increment matters far less than an extra round trip here.
  const { data: row } = await db.from('ghl_outbox').select('attempts').eq('id', id).maybeSingle();
  const attempts = ((row?.attempts as number | null) ?? 0) + 1;

  await db.from('ghl_outbox').update(
    ok
      ? { status: 'sent', sent_at: new Date().toISOString(), contact_id: contactId ?? null,
          attempts, last_error: null }
      : { status: 'failed', attempts, last_error: (err ?? 'unknown').slice(0, 500) },
  ).eq('id', id);
}

/**
 * Send one event. Returns whether GHL accepted it; never rejects.
 *
 * `fields` is merged into the payload for event-specific detail — keep it flat, because
 * GHL custom fields are flat and a nested object arrives as unusable JSON text.
 */
export async function forwardToGhl(
  event: GhlEvent,
  contact: GhlContact,
  fields: Record<string, string | number | boolean | null> = {},
  opts: GhlForwardOptions = {},
): Promise<GhlForwardResult> {
  const email = (contact.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    console.warn(`[ghl] "${event}" has no usable email — not forwarded`);
    return { ok: false, reason: 'no_email' };
  }

  const dedupeKey = opts.dedupeKey ?? `${event}:${email}`;
  const claim = await claimOutbox(event, email, { ...fields, ...contact }, dedupeKey);
  if (claim.alreadySent) return { ok: true, contactId: claim.contactId };

  const result = await deliver(event, email, contact, fields, opts);
  await settleOutbox(claim.id, result.ok, result.contactId, result.reason);
  return result;
}

/** The attempt itself, with no bookkeeping — shared with the retry job. */
export async function deliver(
  event: GhlEvent,
  email: string,
  contact: GhlContact,
  fields: Record<string, string | number | boolean | null>,
  opts: GhlForwardOptions = {},
): Promise<GhlForwardResult> {
  const cfg = ghlConfig();
  return cfg
    ? deliverViaApi(cfg, event, email, contact, fields, opts)
    : deliverViaWebhook(event, email, contact, fields, opts.variant);
}

async function deliverViaApi(
  cfg: NonNullable<ReturnType<typeof ghlConfig>>,
  event: GhlEvent,
  email: string,
  contact: GhlContact,
  fields: Record<string, string | number | boolean | null>,
  opts: GhlForwardOptions,
): Promise<GhlForwardResult> {
  const { first, last } = splitName(contact.fullName);
  const tags = tagsFor(event, opts.variant, contact.lang);

  const up = await upsertContact(cfg, {
    email,
    firstName: first || null,
    lastName:  last  || null,
    name:      (contact.fullName ?? '').trim() || null,
    phone:     contact.phone ?? null,
    country:   contact.country ?? null,
    city:      contact.city ?? null,
    tags,
    customFields: { ...fields, lang: contact.lang === 'fr' ? 'fr' : 'en' },
    source: `groundwork_${event}`,
  });

  if (!up.ok || !up.data) {
    return { ok: false, reason: up.status === 0 ? 'unreachable' : 'rejected', status: up.status, via: 'api' };
  }
  const contactId = up.data.contactId;

  // Tags again, separately: the upsert accepts them but has been observed to replace
  // rather than merge on some accounts, and losing an earlier tag would quietly shrink
  // an audience someone is sending to. This call is additive by definition.
  await addContactTags(cfg, contactId, tags);

  const stage = stageFor(event, opts.variant);
  if (stage) {
    await moveToStage(cfg, {
      contactId,
      pipelineId: stage.pipelineId,
      stageId: stage.stageId,
      name: (contact.fullName ?? '').trim() || email,
    });
    // A failed stage move is deliberately not a failed event: the contact is in the CRM
    // with the right tags, which is most of the value, and the board can be corrected.
  }

  return { ok: true, contactId, via: 'api' };
}

async function deliverViaWebhook(
  event: GhlEvent,
  email: string,
  contact: GhlContact,
  fields: Record<string, string | number | boolean | null>,
  variant?: string,
): Promise<GhlForwardResult> {
  const webhookUrl = process.env.GHL_EVENT_WEBHOOK_URL;
  if (!webhookUrl) {
    // Soft: an unconfigured deploy should not fail requests or fill logs with errors.
    // The outbox row stays unsent, so the backlog is visible either way.
    console.warn(`[ghl] no API token and no GHL_EVENT_WEBHOOK_URL — "${event}" not forwarded`);
    return { ok: false, reason: 'not_configured' };
  }

  const { first, last } = splitName(contact.fullName);
  const tags = tagsFor(event, variant, contact.lang);

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
        // Tags travel with the payload so the workflow can apply them without a rule
        // per event. `tags_csv` exists because GHL's "Add Tag" action takes a single
        // text value — an array arrives as unusable JSON there.
        tags,
        tags_csv:   tags.join(','),
        submitted_at: new Date().toISOString(),
        ...fields,
      }),
    });

    if (!r.ok) {
      // The upstream body is deliberately not returned to callers — it can carry account
      // detail we do not want in a response.
      console.error(`[ghl] "${event}" rejected:`, r.status, await r.text().catch(() => ''));
      return { ok: false, reason: 'rejected', status: r.status, via: 'webhook' };
    }
    return { ok: true, via: 'webhook' };
  } catch (err) {
    console.error(`[ghl] "${event}" could not reach GHL:`, err);
    return { ok: false, reason: 'unreachable', via: 'webhook' };
  }
}
