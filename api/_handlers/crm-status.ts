/**
 * Is the CRM actually configured?
 *
 * Setting this up means pasting six or seven values into Vercel, and every one of them
 * fails *silently* when it is missing — the forwarder logs a warning nobody reads and
 * carries on, because a CRM outage must never break a signup. So there is no way to tell
 * "working" from "quietly doing nothing" without this.
 *
 * **Booleans only. No values ever leave here.** A token, a webhook URL and a location id
 * are all credentials: the webhook URL alone lets anyone inject contacts into the CRM.
 * The answer is whether each one is set, never what it is. Stage keys are listed because
 * they are ids the admin chose and needs to check against their own pipeline.
 */
export async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? key;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error } = await asCaller.rpc('is_admin');
  if (error || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  let stageKeys: string[] = [];
  let stageMapValid = true;
  const rawMap = process.env.GHL_STAGE_MAP;
  if (rawMap) {
    try {
      const parsed = JSON.parse(rawMap) as Record<string, string>;
      stageKeys = Object.keys(parsed);
    } catch {
      // Worth surfacing: a typo here disables every pipeline move and looks exactly
      // like "not set up yet".
      stageMapValid = false;
    }
  }

  res.status(200).json({
    // Phase 1 — the webhooks
    contractorWebhook: !!process.env.GHL_CONTRACTOR_WEBHOOK_URL,
    eventWebhook:      !!process.env.GHL_EVENT_WEBHOOK_URL,
    // Phase 2 — the API. Both are needed; one alone does nothing.
    apiToken:          !!process.env.GHL_API_TOKEN,
    locationId:        !!process.env.GHL_LOCATION_ID,
    // Pipeline moves
    pipelineId:        !!process.env.GHL_PIPELINE_ID,
    stageMapValid,
    stageKeys,
    // Inbound
    inboundSecret:     !!process.env.GHL_INBOUND_SECRET,
    // Which path events are taking right now
    mode: process.env.GHL_API_TOKEN && process.env.GHL_LOCATION_ID
      ? 'api'
      : process.env.GHL_EVENT_WEBHOOK_URL ? 'webhook' : 'off',
  });
}
