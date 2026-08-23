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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const webhookUrl = process.env.GHL_CONTRACTOR_WEBHOOK_URL;
  if (!webhookUrl) {
    // Not configured yet. Report it, but as a soft failure — the caller ignores the
    // response either way and the application is already saved.
    console.warn('[ghl] GHL_CONTRACTOR_WEBHOOK_URL is not set — application not forwarded');
    res.status(200).json({ ok: false, reason: 'not_configured' });
    return;
  }

  const b = req.body ?? {};

  if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email)) {
    res.status(400).json({ error: 'A valid email is required' });
    return;
  }
  if (typeof b.applicationId !== 'string' || !b.applicationId) {
    res.status(400).json({ error: 'applicationId is required' });
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Shared with the admin resync so both send the identical shape — Philip's
      // workflow maps these exact field names.
      body: JSON.stringify(buildContractorPayload({
        applicationId: b.applicationId,
        email: b.email,
        fullName: b.fullName, phone: b.phone, country: b.country, city: b.city,
        businessName: b.businessName, role: b.role, roleOther: b.roleOther,
        yearsExperience: b.yearsExperience, operatesAs: b.operatesAs,
        concurrentProjects: b.concurrentProjects, regions: b.regions,
        portfolioUrl: b.portfolioUrl, videoUrl: b.videoUrl,
        projectCount: b.projectCount, uploadCount: b.uploadCount,
        status: b.status, lang: b.lang,
      })),
    });

    if (!response.ok) {
      console.error('[ghl] webhook rejected the application:', response.status);
      // Deliberately no upstream body in the response — it can carry account detail,
      // and the browser has no use for it.
      res.status(502).json({ error: 'Upstream rejected the application' });
      return;
    }

    await markApplicationSynced(b.applicationId);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[ghl] webhook unreachable:', err);
    res.status(502).json({ error: 'Upstream unreachable' });
  }
}
