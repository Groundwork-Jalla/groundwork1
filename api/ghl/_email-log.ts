/**
 * Every email we send, on the recipient's GoHighLevel contact.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────────────
 * Transactional mail goes out through Resend. GHL never hears about it. So the CRM shows
 * a contractor with the right tags and a full set of custom fields, and nothing at all
 * about the acceptance email they were sent on Tuesday — and whoever follows up either
 * repeats it, contradicts it, or has to go and ask a developer. "What have we already
 * said to this person?" is most of what following up *is*.
 *
 * ── Best-effort, always ──────────────────────────────────────────────────────────────
 * Nothing here can fail a send. The email has already gone by the time this runs; the
 * note is bookkeeping, and bookkeeping that can break a password reset is worse than no
 * bookkeeping. Every path returns rather than throws — there is no `catch` for a caller
 * to forget, and the boolean is the whole error channel.
 *
 * ── AWAIT IT. `void logEmailToCrm(...)` DOES NOT WORK HERE ───────────────────────────
 * Every caller is a Vercel serverless function, and Vercel freezes the instance the
 * moment the handler responds and returns. A floating promise is suspended mid-flight:
 * this one needs a Supabase read and one or two GHL round trips, so it never gets to the
 * note. It looks exactly like a CRM that is refusing us — nothing on the timeline, no
 * error anywhere, and the send itself succeeding every time.
 *
 * Awaiting is safe *because* of the paragraph above: this cannot throw and cannot fail a
 * send, it can only make one slower by a few hundred milliseconds. That is the entire
 * cost, and it is the same trade `forwardToGhl` already makes in the decision endpoint.
 *
 * ── It will create the contact if it has to ──────────────────────────────────────────
 * An email to someone GHL has never seen upserts them first. That is deliberate: the
 * alternative is silently dropping exactly the notes about people who are new, which is
 * when follow-up matters most.
 */

import { ghlConfig, upsertContact, addContactNote } from './_client.js';
// The kinds and their labels live under src/ because the browser names them too, when it
// calls /api/send-email. One vocabulary, so a note cannot be labelled one thing on the
// way out and another on arrival.
import { EMAIL_KIND_LABEL as LABEL, type EmailKind } from '../../src/lib/email/email-kind.js';

export type { EmailKind };

/**
 * HTML to something readable in a CRM note.
 *
 * Not a general-purpose converter: these are our own templates, so the shapes are known.
 * Block tags become newlines so the note keeps the email's structure instead of running
 * into one paragraph, and `<a>` keeps its href — a note saying "click the button" with
 * no button in it is worse than useless to someone following up.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
             (_m, href: string, text: string) => {
               const label = text.replace(/<[^>]+>/g, '').trim();
               return label ? `${label} (${href})` : href;
             })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    // Down to single breaks. Our templates lay out label/value pairs as table rows, so
    // `</p></td></tr>` emits three newlines for one line of content — leaving those as
    // paragraph breaks puts a blank line between every field and turns a six-line note
    // into a screenful.
    .replace(/\n{2,}/g, '\n')
    .split('\n').map(l => l.trim()).join('\n')
    .trim();
}

/**
 * How much of the body to keep.
 *
 * Enough to see what was actually said, short of pasting a whole HTML email into a CRM
 * timeline where it would bury every other note on the contact.
 */
const MAX_BODY = 1200;

export function buildNote(opts: {
  kind: EmailKind;
  subject: string;
  html?: string | null;
  sentAt?: Date;
}): string {
  const when = (opts.sentAt ?? new Date()).toISOString().replace('T', ' ').slice(0, 16);
  const head = `📧 ${LABEL[opts.kind] ?? LABEL.other} sent — ${when} UTC\nSubject: ${opts.subject}`;

  if (!opts.html) return head;

  const text = htmlToText(opts.html);
  if (!text) return head;

  const body = text.length > MAX_BODY
    ? `${text.slice(0, MAX_BODY).trimEnd()}…\n[trimmed]`
    : text;

  return `${head}\n\n${body}`;
}

/** Looks for an id we already stored, so the common case costs no GHL call. */
async function knownContactId(email: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Both tables carry the id (050). Profiles first: a homeowner is the commoner case,
    // and a contractor who also has an account resolves to the same GHL contact anyway,
    // because the upsert matches on email.
    const { data: profile } = await db
      .from('profiles').select('ghl_contact_id')
      .ilike('email', email).not('ghl_contact_id', 'is', null).limit(1).maybeSingle();
    if (profile?.ghl_contact_id) return String(profile.ghl_contact_id);

    const { data: app } = await db
      .from('contractor_applications').select('ghl_contact_id')
      .ilike('email', email).not('ghl_contact_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (app?.ghl_contact_id) return String(app.ghl_contact_id);
  } catch {
    // Fall through to the upsert — a lookup failure should cost a round trip, not a note.
  }
  return null;
}

export interface LogEmailOptions {
  to: string;
  subject: string;
  kind: EmailKind;
  /** The email body. Trimmed to a readable excerpt; omit to record only the subject. */
  html?: string | null;
  /** Used only when the contact has to be created. */
  name?: string | null;
}

/**
 * Record an email on the recipient's contact. Never throws.
 *
 * Returns whether a note was written. False is not an error — an unconfigured API, a
 * contact GHL would not create, a rejected note: all of them mean "no timeline entry",
 * and none of them mean the email failed. Callers `await` it and may ignore the answer,
 * but they must not use `void` — see the header.
 */
export async function logEmailToCrm(opts: LogEmailOptions): Promise<boolean> {
  try {
    const email = (opts.to ?? '').trim().toLowerCase();
    if (!email) return false;

    const cfg = await ghlConfig();
    // No API means no contact ids and no notes endpoint — the Phase 1 webhook cannot
    // write to a timeline. Not an error, just the un-upgraded configuration.
    if (!cfg) return false;

    let contactId = await knownContactId(email);
    if (!contactId) {
      const up = await upsertContact(cfg, { email, name: opts.name ?? null });
      if (!up.ok || !up.data) {
        console.warn(`[ghl-email-log] no contact for ${email} (${up.status}) — note skipped`);
        return false;
      }
      contactId = up.data.contactId;
    }

    const r = await addContactNote(cfg, contactId, buildNote(opts));
    if (!r.ok) {
      console.warn(`[ghl-email-log] note rejected for ${email}: ${r.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[ghl-email-log] failed, email was still sent:', err);
    return false;
  }
}
