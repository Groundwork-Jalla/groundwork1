/**
 * The Marketplace app's OAuth token: obtaining it, storing it, keeping it alive.
 *
 * ── Read `067_ghl_oauth_tokens.sql` first ────────────────────────────────────────────
 * The short version: every ordinary call authenticates with a Private Integration Token.
 * `/conversations/messages/inbound` will not accept one, because it posts *as a
 * conversation provider* and a provider belongs to the Marketplace app. So that one call
 * needs the app's own OAuth access token, which expires and must be refreshed.
 *
 * ── Never fatal ──────────────────────────────────────────────────────────────────────
 * Everything here returns null rather than throwing. A missing or unrefreshable token
 * means the email log writes a note instead of a thread — the behaviour before any of
 * this existed. Losing a record of an email because a credential expired overnight
 * would be a far worse trade than losing the prettier surface it lands on.
 */

import { ghlSettings } from './_config.js';

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

/**
 * Refresh this far before the token actually expires.
 *
 * GHL issues roughly 24 hours. Ten minutes of margin covers clock skew between us and
 * them, and a slow request that starts valid and arrives expired — which fails as a 401
 * and is indistinguishable from a scope problem, as this integration has already
 * demonstrated twice.
 */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

async function db() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  locationId?: string;
  userType?: string;
}

/** Stores a token response. Returns the location it was stored for, or null. */
async function store(t: TokenResponse, fallbackLocation?: string): Promise<string | null> {
  const locationId = (t.locationId ?? fallbackLocation ?? '').trim();
  if (!locationId || !t.access_token || !t.refresh_token) {
    console.error('[ghl-oauth] token response missing location or tokens');
    return null;
  }

  const client = await db();
  if (!client) return null;

  // `expires_in` is only meaningful at the moment of issue, so it is resolved to an
  // absolute instant here rather than stored as a duration nobody can interpret later.
  const expiresAt = new Date(Date.now() + (t.expires_in ?? 86400) * 1000).toISOString();

  const { error } = await client.from('ghl_oauth_tokens').upsert({
    location_id:   locationId,
    access_token:  t.access_token,
    refresh_token: t.refresh_token,
    expires_at:    expiresAt,
    scope:         t.scope ?? null,
    user_type:     t.userType ?? null,
    updated_at:    new Date().toISOString(),
  }, { onConflict: 'location_id' });

  if (error) {
    console.error('[ghl-oauth] could not store the token:', error.message);
    return null;
  }
  return locationId;
}

async function callTokenEndpoint(body: Record<string, string>): Promise<TokenResponse | null> {
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      // Form-encoded, not JSON. GHL's token endpoint rejects a JSON body, the same way
      // /medias/upload-file rejected one — worth stating, because the rest of this
      // integration speaks JSON and the inconsistency is not obvious.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error('[ghl-oauth] token endpoint refused:', r.status, text.slice(0, 300));
      return null;
    }
    return JSON.parse(text) as TokenResponse;
  } catch (err) {
    console.error('[ghl-oauth] token endpoint unreachable:', err);
    return null;
  }
}

/**
 * Exchange an install's authorisation code for tokens, and store them.
 *
 * Called once per install, from the OAuth redirect. Returns the location id on success.
 */
export async function exchangeCode(code: string): Promise<string | null> {
  const cfg = await ghlSettings();
  const clientId = cfg.GHL_CLIENT_ID.value;
  const clientSecret = cfg.GHL_CLIENT_SECRET.value;
  if (!clientId || !clientSecret) {
    console.error('[ghl-oauth] client id/secret not configured — cannot exchange the code');
    return null;
  }

  const t = await callTokenEndpoint({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'authorization_code',
    code,
    user_type:     'Location',
  });
  if (!t) return null;

  return store(t, cfg.GHL_LOCATION_ID.value);
}

/**
 * A valid access token for this location, refreshing it if it is close to expiry.
 *
 * Null means "no thread this time" — the caller writes a note instead.
 */
export async function accessToken(): Promise<string | null> {
  const cfg = await ghlSettings();
  const locationId = cfg.GHL_LOCATION_ID.value;
  if (!locationId) return null;

  const client = await db();
  if (!client) return null;

  const { data: row, error } = await client
    .from('ghl_oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('location_id', locationId)
    .maybeSingle();

  if (error || !row) {
    // Not an error worth shouting about: it just means the app has never been installed
    // through the OAuth flow on this location.
    return null;
  }

  const expiresAt = new Date(String(row.expires_at)).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return String(row.access_token);
  }

  // ── Refresh ──
  const clientId = cfg.GHL_CLIENT_ID.value;
  const clientSecret = cfg.GHL_CLIENT_SECRET.value;
  if (!clientId || !clientSecret) {
    console.error('[ghl-oauth] token needs refreshing but client id/secret are not set');
    return null;
  }

  const t = await callTokenEndpoint({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'refresh_token',
    refresh_token: String(row.refresh_token),
    user_type:     'Location',
  });
  if (!t?.access_token) return null;

  // GHL may or may not rotate the refresh token. Keep the old one when it does not,
  // otherwise the next refresh has nothing to present and the install has to be redone.
  await store({ ...t, refresh_token: t.refresh_token ?? String(row.refresh_token) }, locationId);
  return t.access_token;
}

/** Whether a token exists and is currently usable. For /admin/crm. */
export async function oauthStatus(): Promise<{ present: boolean; expiresAt: string | null }> {
  const cfg = await ghlSettings();
  const locationId = cfg.GHL_LOCATION_ID.value;
  const client = await db();
  if (!locationId || !client) return { present: false, expiresAt: null };

  const { data } = await client
    .from('ghl_oauth_tokens')
    .select('expires_at')
    .eq('location_id', locationId)
    .maybeSingle();

  return { present: !!data, expiresAt: data ? String(data.expires_at) : null };
}
