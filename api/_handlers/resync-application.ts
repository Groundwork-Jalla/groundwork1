import { buildContractorPayload, markApplicationSynced } from '../ghl/_contractor-payload.js';

/**
 * Send one contractor application to the CRM again.
 *
 * The submission push is fire-and-forget and the browser discards the error, so a CRM
 * outage loses the lead with nothing to show for it: the application is in Supabase, the
 * team never hears about it, and `synced_to_ghl` stays false with no way to act on it.
 * This is the way to act on it.
 *
 * Built from the stored row through the same payload builder the original send uses, so
 * a retry is indistinguishable from a first attempt on the GHL side — the workflow keys
 * off those exact field names.
 *
 * Admin-gated. The submission endpoint has to accept anonymous callers because applicants
 * have no account; this one is a person deciding to retry, so it is gated like the rest of
 * the admin actions.
 */
export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { applicationId } = req.body ?? {};
  if (typeof applicationId !== 'string' || !applicationId) {
    res.status(400).json({ error: 'applicationId is required' });
    return;
  }

  const webhookUrl = process.env.GHL_CONTRACTOR_WEBHOOK_URL;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[ghl] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }
  if (!webhookUrl) {
    // Nothing to retry into. Distinct from a failed send so the admin sees the real
    // reason rather than "try again" for something no retry can fix.
    res.status(503).json({ error: 'The CRM webhook is not configured' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? key;

  // is_admin() reads auth.uid(), so it has to run as the caller, not the service role.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const svc = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: app, error } = await svc
    .from('contractor_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();

  if (error || !app) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildContractorPayload({
        applicationId,
        email:              app.email,
        fullName:           app.full_name,
        phone:              app.phone,
        country:            app.country,
        city:               app.city,
        businessName:       app.business_name,
        role:               app.role,
        roleOther:          app.role_other,
        yearsExperience:    app.years_experience,
        operatesAs:         app.operates_as,
        concurrentProjects: app.concurrent_projects,
        regions:            app.regions,
        portfolioUrl:       app.portfolio_url,
        videoUrl:           app.video_url,
        projectCount:       Array.isArray(app.projects) ? app.projects.length : 0,
        uploadCount:        Array.isArray(app.uploads)  ? app.uploads.length  : 0,
        status:             app.status,
        lang:               app.lang,
      })),
    });

    if (!response.ok) {
      console.error('[ghl] resync rejected:', response.status);
      res.status(502).json({ error: 'The CRM rejected it. Try again shortly.' });
      return;
    }

    await markApplicationSynced(applicationId);
    res.status(200).json({ ok: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[ghl] resync could not reach the CRM:', err);
    res.status(502).json({ error: 'Could not reach the CRM. Try again shortly.' });
  }
}
