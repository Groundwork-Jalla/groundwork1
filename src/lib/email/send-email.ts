import { supabase } from '../supabase/client';

/**
 * Generic transactional send. Requires a signed-in caller — /api/send-email accepts a
 * recipient and a body verbatim, so it is only safe behind a session. Anonymous flows
 * (the contractor application) use a purpose-built endpoint that derives its recipients
 * from the database instead.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
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
      body: JSON.stringify({ to, subject, html }),
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
