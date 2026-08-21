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

import { siteUrl } from '../../src/lib/site-url.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Flag the application as forwarded, so `WHERE NOT synced_to_ghl` can find anything that
 * missed the CRM during an outage. Never throws — the lead is already in GHL by the time
 * this runs, and losing the bookkeeping is not worth failing the request over.
 */
async function markSynced(applicationId: string): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      .from('contractor_applications')
      .update({ synced_to_ghl: true, synced_to_ghl_at: new Date().toISOString() })
      .eq('id', applicationId);
  } catch (err) {
    console.warn('[ghl] application forwarded but could not be marked synced:', err);
  }
}

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

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  // PUBLIC_SITE_URL is the documented name (.env.example) and what api/_lib/stripe.ts
  // reads. PUBLIC_APP_URL is accepted too so an existing deployment that set the old
  // name keeps working — otherwise this silently falls back to the default and every
  // CRM deep link points at the wrong host.
  // PUBLIC_APP_URL is a legacy alias only this handler still accepts.
  const appUrl = process.env.PUBLIC_APP_URL && !process.env.PUBLIC_SITE_URL
    ? process.env.PUBLIC_APP_URL.replace(/\/+$/, '')
    : siteUrl();

  // GHL stores first and last name separately, so send both alongside the full
  // string. The form asks for one "Full name" field on purpose — splitting on the
  // first space is a heuristic, not a truth: many names do not divide that way.
  // `full_name` therefore stays authoritative and is what the CRM should display.
  const fullName = str(b.fullName) ?? '';
  const spaceAt  = fullName.indexOf(' ');
  const firstName = spaceAt === -1 ? fullName : fullName.slice(0, spaceAt);
  const lastName  = spaceAt === -1 ? ''       : fullName.slice(spaceAt + 1).trim();

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Standard contact fields. `first_name`/`last_name` exist because GHL stores
        // them separately; `full_name` is the authoritative one to display.
        full_name:  fullName || null,
        first_name: firstName || null,
        last_name:  lastName  || null,
        email:      b.email,
        phone:      str(b.phone),
        country:    str(b.country),
        city:       str(b.city),

        // Custom fields — create these once in GHL and map them in the workflow.
        business_name:       str(b.businessName),
        role:                str(b.role),
        role_other:          str(b.roleOther),
        years_experience:    str(b.yearsExperience),
        operates_as:         str(b.operatesAs),
        concurrent_projects: str(b.concurrentProjects),
        regions:             str(b.regions),
        portfolio_url:       str(b.portfolioUrl),
        video_url:           str(b.videoUrl),
        project_count:       typeof b.projectCount === 'number' ? b.projectCount : 0,
        upload_count:        typeof b.uploadCount  === 'number' ? b.uploadCount  : 0,

        // "disqualified" means they answered No to a Section 6 standard. Branch the
        // workflow on this so screened-out applicants do not enter the main pipeline.
        status: b.status === 'disqualified' ? 'disqualified' : 'pending',
        lang:   b.lang === 'fr' ? 'fr' : 'en',

        // Deep link back to the full application — the part GHL deliberately does not hold.
        application_id:  b.applicationId,
        application_url: `${appUrl}/admin/applications/${b.applicationId}`,

        source: 'groundwork_contractor_application',
        submitted_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error('[ghl] webhook rejected the application:', response.status);
      // Deliberately no upstream body in the response — it can carry account detail,
      // and the browser has no use for it.
      res.status(502).json({ error: 'Upstream rejected the application' });
      return;
    }

    await markSynced(b.applicationId);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[ghl] webhook unreachable:', err);
    res.status(502).json({ error: 'Upstream unreachable' });
  }
}
