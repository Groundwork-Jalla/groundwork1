import { supabase } from '../supabase/client';
import type { CallerEmailKind } from './email-kind';

/**
 * Generic transactional send. Requires a signed-in caller — /api/send-email accepts a
 * recipient and a body verbatim, so it is only safe behind a session. Anonymous flows
 * (the contractor application) use a purpose-built endpoint that derives its recipients
 * from the database instead.
 *
 * `kind` is what the note on the recipient's GoHighLevel contact will be headed. It
 * matters more than it looks: this endpoint is the one that cannot work out what it just
 * sent, so without it every stage approval and rework request lands on the timeline as
 * an unlabelled "Email" and someone following up has to open each one to find out which
 * is which. Narrow by design — see `callerEmailKind`.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  kind: CallerEmailKind = 'other',
): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.error('[email] not signed in — refusing to send');
      return false;
    }
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ to, subject, html, kind }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('[email] send failed:', body);
    }
    return res.ok;
  } catch (err) {
    console.error('[email] send error:', err);
    return false;
  }
}
