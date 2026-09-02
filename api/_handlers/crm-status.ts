import { ghlSettings, type ConfigSource } from '../ghl/_config.js';
import { ghlConfig, ghlFetch } from '../ghl/_client.js';

/**
 * Is the CRM actually configured?
 *
 * Setting this up means supplying six or seven values, and every one of them fails
 * *silently* when it is missing — the forwarder logs a warning nobody reads and carries
 * on, because a CRM outage must never break a signup. So there is no way to tell
 * "working" from "quietly doing nothing" without this.
 *
 * ── Set is not the same as accepted ──────────────────────────────────────────────────
 * This page used to answer only "is there a value?", which put a green tick beside a
 * token GoHighLevel was refusing. On 31 Aug 2026 that tick sat above a 401 for an hour.
 * So `tokenAccepted` asks GHL itself with one cheap authenticated call, and the answer
 * is a third state — accepted, rejected, or not applicable — never a tick.
 *
 * ── Where each value came from ───────────────────────────────────────────────────────
 * Settings now resolve from `app_config` before the environment, so "I changed it and
 * nothing happened" is a real possibility. Each row carries its source, which turns that
 * from a mystery into a word on the screen.
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

  const cfg = await ghlSettings();
  const has = (k: keyof typeof cfg) => !!cfg[k].value;
  const src = (k: keyof typeof cfg): ConfigSource => cfg[k].source;

  let stageKeys: string[] = [];
  let stageMapValid = true;
  const rawMap = cfg.GHL_STAGE_MAP.value;
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

  // Ask GoHighLevel whether it accepts the token, rather than assuming a set variable is
  // a working one. `/contacts/upsert` would create data, so this reads the location's
  // custom fields — authenticated, harmless, and the same call the fields button makes,
  // which means a 401 here reproduces the fields button's 401 for the same reason.
  let tokenAccepted: boolean | null = null;
  let tokenError: string | null = null;
  const api = await ghlConfig();
  if (api) {
    const probe = await ghlFetch(api, `/locations/${api.locationId}/customFields`, { method: 'GET' });
    tokenAccepted = probe.ok;
    if (!probe.ok) {
      // The status is the whole diagnosis: 401/403 is the token or its scopes, 404 is the
      // location id, anything else is GHL having a bad day.
      tokenError = probe.status === 401 || probe.status === 403
        ? 'rejected'
        : probe.status === 404 ? 'location_not_found'
        : probe.status === 0   ? 'unreachable'
        : `http_${probe.status}`;
    }
  }

  res.status(200).json({
    // Phase 1 — the webhooks
    contractorWebhook: has('GHL_CONTRACTOR_WEBHOOK_URL'),
    eventWebhook:      has('GHL_EVENT_WEBHOOK_URL'),
    // Phase 2 — the API. Both are needed; one alone does nothing.
    apiToken:          has('GHL_API_TOKEN'),
    locationId:        has('GHL_LOCATION_ID'),
    // Pipeline moves
    pipelineId:        has('GHL_PIPELINE_ID'),
    stageMapValid,
    stageKeys,
    // Inbound
    inboundSecret:     has('GHL_INBOUND_SECRET'),
    /**
     * Without this, emails are recorded as notes instead of on the Conversations thread.
     * A note cannot be replied to, so follow-up leaves GHL — which is the whole thing
     * this integration exists to avoid. Surfaced as its own row because it is the one
     * setting whose absence is invisible: everything still "works".
     */
    conversationProvider: has('GHL_CONVERSATION_PROVIDER_ID'),

    /** Does GHL actually accept the token? null = no API configured, so not asked. */
    tokenAccepted,
    tokenError,

    /**
     * Is there an API token and location id at all — regardless of whether GHL accepts
     * them. Distinct from `mode`, which says where events are actually going.
     *
     * The admin page gates its diagnostic tools on this rather than on `mode`. Gating
     * them on `mode` hid the upload test and the field checker the moment a token was
     * rejected, which is the one moment they are needed.
     */
    apiConfigured: !!api,

    /**
     * Where each value resolved from. Never the value itself — a webhook URL alone lets
     * anyone inject contacts, and the token is a credential.
     */
    sources: {
      contractorWebhook: src('GHL_CONTRACTOR_WEBHOOK_URL'),
      eventWebhook:      src('GHL_EVENT_WEBHOOK_URL'),
      apiToken:          src('GHL_API_TOKEN'),
      locationId:        src('GHL_LOCATION_ID'),
      pipelineId:        src('GHL_PIPELINE_ID'),
      stageMap:          src('GHL_STAGE_MAP'),
      inboundSecret:     src('GHL_INBOUND_SECRET'),
      conversationProvider: src('GHL_CONVERSATION_PROVIDER_ID'),
    },

    // Which path events are taking right now. A rejected token reads as 'webhook',
    // because that is now genuinely where events go — see the fallback in _forward.ts.
    mode: api && tokenAccepted !== false
      ? 'api'
      : has('GHL_EVENT_WEBHOOK_URL') ? 'webhook' : 'off',
  });
}
