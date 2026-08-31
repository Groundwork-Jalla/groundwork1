/**
 * Contractor application → GoHighLevel.
 *
 * Server-side proxy for a GHL inbound-webhook workflow.
 * The webhook URL is the only secret involved and it stays on the server — anything
 * named `VITE_*` is compiled into the browser bundle, so a public URL would let anyone
 * inject contacts into the CRM.
 *
 * This is a MIRROR, not the source of truth. The full application (all nine sections,
 * project history, uploaded credentials) is already in Supabase before this is called.
 * GHL deliberately receives a LEAD SUMMARY only: GHL custom fields are flat, and the
 * repeatable project history and file attachments do not belong in them. The payload
 * carries an application id so the workflow can deep-link back to the full record.
 *
 * The GHL workflow attached to this webhook is what creates the contact and sends the
 * "new contractor applied" notifications (in-app + email).
 */

import { buildContractorPayload, markApplicationSynced } from './_contractor-payload.js';
import { ghlSettings } from './_config.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const webhookUrl = (await ghlSettings()).GHL_CONTRACTOR_WEBHOOK_URL.value;
  if (!webhookUrl) {
    // Not configured yet. Report it, but as a soft failure — the caller ignores the
    // response either way and the application is already saved.
    console.warn('[ghl] GHL_CONTRACTOR_WEBHOOK_URL is not set — application not forwarded');
    res.status(200).json({ ok: false, reason: 'not_configured' });
    return;
  }

  const applicationId = req.body?.applicationId;
  if (typeof applicationId !== 'string' || !applicationId) {
    res.status(400).json({ error: 'applicationId is required' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[ghl] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  // Read the whole application rather than taking fields from the request.
  //
  // This used to build the payload from the browser's body, which meant GHL only ever
  // saw the dozen fields the client bothered to send — no project history, no
  // credentials, no documents. It also meant the browser decided what the CRM believed
  // about an applicant. Reading the row fixes both, and makes this identical to the
  // admin resync, so a retry cannot drift from the original send.
  const { createClient } = await import('@supabase/supabase-js');
  const svc = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: row, error } = await svc
    .from('contractor_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();

  if (error || !row) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  try {
    const { applicationFromRow } = await import('../../src/lib/contractor/application-types.js');
    const { signDocuments } = await import('./_documents.js');
    const application = applicationFromRow(row);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildContractorPayload({
        ...application,
        applicationId,
        status: row.status,
        documentUrls: await signDocuments(svc, row.uploads),
      })),
    });

    if (!response.ok) {
      console.error('[ghl] webhook rejected the application:', response.status);
      // Deliberately no upstream body in the response — it can carry account detail,
      // and the browser has no use for it.
      res.status(502).json({ error: 'Upstream rejected the application' });
      return;
    }

    await markApplicationSynced(applicationId);

    // The webhook kept Philip's existing workflow running. This adds what a webhook
    // structurally cannot: a contact id, the full field set, and the documents
    // themselves. Skipped silently when the API is not configured.
    const { syncContractorToApi } = await import('./_contractor-sync.js');
    const api = await syncContractorToApi(application, applicationId, row.status, svc);

    if (api.ok && api.contactId) {
      // Remember who they are in GHL, so a later event can address the same contact
      // instead of hoping the CRM dedupes.
      await svc.from('contractor_applications')
        .update({ ghl_contact_id: api.contactId })
        .eq('id', applicationId);
    }

    res.status(200).json({
      ok: true,
      api: api.ok ? { contactId: api.contactId, documents: api.documentsUploaded } : api.skipped ?? api.reason,
    });
  } catch (err) {
    console.error('[ghl] could not forward the application:', err);
    res.status(502).json({ error: 'Could not reach the CRM' });
  }
}
