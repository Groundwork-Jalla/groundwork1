import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { deliver } from '../ghl/_forward.js';

/**
 * Deliver this person's queued email changes to the CRM.
 *
 * The queueing is the database's (migration 095): the moment auth.users.email changes,
 * an `email_changed` row lands in ghl_outbox with the old address, the new one and the
 * contact id if one is known. This is the prompt attempt — the browser calls it from
 * /auth/callback after the confirmation link — and `/admin/crm` retries whatever it
 * could not deliver, so nothing here needs to succeed for the change to be safe.
 *
 * Only the caller's own rows: the token names the person, the outbox names the person,
 * and the two have to agree. Nothing about the addresses comes from the request.
 */
export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[crm-email-sync] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { data: rows, error } = await admin
    .from('ghl_outbox')
    .select('id, email, payload, attempts')
    .eq('event', 'email_changed')
    .eq('payload->>user_id', user.id)
    .neq('status', 'sent')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[crm-email-sync] could not read the outbox:', error.message);
    res.status(500).json({ error: 'Could not read the outbox' });
    return;
  }

  let sent = 0, failed = 0;
  for (const row of rows ?? []) {
    const payload = (row.payload ?? {}) as Record<string, string | null>;
    const result = await deliver('email_changed', row.email, { email: row.email }, {
      user_id:    user.id,
      old_email:  payload.old_email ?? null,
      new_email:  payload.new_email ?? null,
      contact_id: payload.contact_id ?? null,
    });

    if (result.ok) {
      sent++;
      await admin.from('ghl_outbox').update({
        status: 'sent', sent_at: new Date().toISOString(),
        contact_id: result.contactId ?? null, attempts: (row.attempts ?? 0) + 1, last_error: null,
      }).eq('id', row.id);
      // The contact the change landed on is now the person's contact, if none was known.
      if (result.contactId) {
        await admin.from('profiles')
          .update({ ghl_contact_id: result.contactId })
          .eq('id', user.id)
          .is('ghl_contact_id', null);
      }
    } else {
      failed++;
      await admin.from('ghl_outbox').update({
        status: 'failed', attempts: (row.attempts ?? 0) + 1,
        last_error: (result.reason ?? 'unknown').slice(0, 500),
      }).eq('id', row.id);
    }
  }

  res.status(200).json({ ok: failed === 0, sent, failed });
}
