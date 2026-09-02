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

  const cfg = await ghlSettings();
  const webhookUrl = cfg.GHL_CONTRACTOR_WEBHOOK_URL.value;

  // Deliberately NOT an early return when the webhook is unset. It used to be, which
  // meant removing the legacy webhook URL would silently stop contractor applications
  // reaching the CRM at all — even with a working API. The API is the primary path now,
  // so the only unconfigured state that matters is both of them being absent, and that
  // is checked once the API result is known.
  if (!webhookUrl) {
    console.warn('[ghl] no contractor webhook configured — using the API only');
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

    const payload = buildContractorPayload({
      ...application,
      applicationId,
      status: row.status,
      documentUrls: await signDocuments(svc, row.uploads),
    });

    // ── The API is the primary path ─────────────────────────────────────────────────
    // It carries what a webhook structurally cannot: a contact id, the full field set,
    // and the documents themselves.
    const { syncContractorToApi } = await import('./_contractor-sync.js');
    const api = await syncContractorToApi(application, applicationId, row.status, svc);

    if (api.ok && api.contactId) {
      // Remember who they are in GHL, so a later event can address the same contact
      // instead of hoping the CRM dedupes.
      await svc.from('contractor_applications')
        .update({ ghl_contact_id: api.contactId })
        .eq('id', applicationId);
    }

    // ── The legacy webhook ──────────────────────────────────────────────────────────
    // Both paths used to run on every application, unconditionally. That is a duplicate
    // factory: Philip's workflow creates a contact from the fields it maps — no email,
    // so GHL cannot dedupe it, and a raw phone that GHL stamps `+1` because the
    // sub-account is in Maryland — and then the API creates the real one. Two records
    // per contractor, which is exactly what the contact list shows.
    //
    // Mode lives in app_config so this can be turned off without a deploy once Philip's
    // workflow is rebuilt on the `groundwork:applied` tag trigger.
    const mode = cfg.GHL_CONTRACTOR_WEBHOOK_MODE.value ?? 'fallback';
    const useWebhook =
      mode === 'always' ? true :
      mode === 'off'    ? false :
      !api.ok;  // 'fallback'

    let hookStatus: number | null = null;
    if (useWebhook && webhookUrl) {
      // Loud on purpose. A fallback record is defective by construction — it is the one
      // with no contact id and nothing to merge on — so it must never happen quietly.
      if (!api.ok) {
        console.error(
          `[ghl] API sync failed for ${applicationId} (${api.reason ?? 'unknown'}) — ` +
          'falling back to the webhook. That record will need reconciling by hand.');
      }
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      hookStatus = response.status;
      if (!response.ok) {
        console.error('[ghl] webhook rejected the application:', response.status);
      }
    }

    // ── The reconciliation queue ────────────────────────────────────────────────────
    // A log line is not a queue: nobody reads Vercel logs at 2am and they age out. This
    // row is countable, survives retention, and can be marked resolved. See 065.
    if (!api.ok && !api.skipped) {
      const { error: qErr } = await svc.from('ghl_sync_failures').insert({
        kind: 'contractor_api_sync',
        application_id: applicationId,
        email: application.email ?? null,
        reason: String(api.reason ?? 'unknown').slice(0, 300),
        fell_back: hookStatus !== null && hookStatus < 400,
      });
      // Best-effort by necessity: if even the queue write fails there is nowhere left to
      // put this, and failing the request would lose the application as well as the note.
      if (qErr) console.error('[ghl] could not record the sync failure:', qErr.message);
    }

    // Only a total failure is an error. The webhook failing while the API succeeded is
    // not: the application reached the CRM, which is the thing the caller asked for.
    if (!api.ok && !(hookStatus && hookStatus < 400)) {
      // Neither path is configured at all — a soft failure, as before: the caller
      // ignores the response and the application is already saved in Supabase.
      if (!webhookUrl && api.skipped) {
        console.warn('[ghl] no CRM configured — application not forwarded');
        res.status(200).json({ ok: false, reason: 'not_configured' });
        return;
      }
      res.status(502).json({ error: 'Could not deliver the application to the CRM' });
      return;
    }

    await markApplicationSynced(applicationId);

    res.status(200).json({
      ok: true,
      api: api.ok ? { contactId: api.contactId, documents: api.documentsUploaded } : api.skipped ?? api.reason,
      webhook: hookStatus === null ? 'skipped' : hookStatus,
    });
  } catch (err) {
    console.error('[ghl] could not forward the application:', err);
    res.status(502).json({ error: 'Could not reach the CRM' });
  }
}
