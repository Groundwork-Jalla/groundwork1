/**
 * Where GoHighLevel's settings come from.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * Every one of these values used to be read straight from `process.env`, which has two
 * problems that only show up once someone other than a developer is doing the setup:
 *
 *   1. **Vercel's free plan has a ceiling on environment variables**, and this project is
 *      at it. Migration 058 hit the same wall for the notification secrets and solved it
 *      by putting them in a table; there is no reason for the CRM to solve it differently.
 *   2. **Every change needs a redeploy.** Vercel does not apply a new value to a running
 *      deployment, and docs/GHL-SETUP.md has to warn about this twice because it is the
 *      single most common reason a tick stays a cross after someone "already added it".
 *      Rotating a leaked token should not be a deploy.
 *
 * So values are read from `app_config` (058) first and fall back to the environment.
 *
 * ── The database wins, deliberately ──────────────────────────────────────────────────
 * When a key is in both places the table wins. The environment is the deployment's
 * default; the table is the operator's override, and an override that loses to the thing
 * it is overriding is not one. The cost is that "I changed the env var and nothing
 * happened" becomes possible — so `/admin/crm` now prints the source of every value
 * beside it, which turns that from a mystery into a line of text.
 *
 * ── Reading it is safe ───────────────────────────────────────────────────────────────
 * `app_config` has RLS on with no policies (058), so no browser session can read it
 * whatever role it holds. These functions run in Vercel with the service role, which
 * bypasses RLS. Nothing here ever returns a value to a client: `/admin/crm` gets
 * booleans and a source label, never the secret itself.
 */

const TABLE = 'app_config';

export const GHL_KEYS = [
  'GHL_API_TOKEN',
  'GHL_LOCATION_ID',
  'GHL_EVENT_WEBHOOK_URL',
  'GHL_CONTRACTOR_WEBHOOK_URL',
  'GHL_PIPELINE_ID',
  'GHL_STAGE_MAP',
  'GHL_INBOUND_SECRET',
  /**
   * What to do with the legacy contractor webhook now that the API works.
   *
   *   'off'      — API only. The end state, once Philip's workflow is rebuilt on the
   *                `groundwork:applied` tag trigger.
   *   'fallback' — API first; the webhook runs only if the API sync fails. The default,
   *                because it stops new duplicates immediately.
   *   'always'   — both, every time. The old behaviour, and a duplicate factory.
   *
   * Here rather than in code so it can be changed with one UPDATE and no deploy — the
   * decision depends on what Philip's workflow does, which is not knowable from here.
   */
  'GHL_CONTRACTOR_WEBHOOK_MODE',
  /**
   * The Marketplace app id that lets us write onto a contact's Conversations thread.
   *
   * Without it, an email we send is recorded as a *note* — visible, searchable, and on
   * the wrong surface: you cannot reply from a note, and the Conversations pane is where
   * follow-up actually happens. With it, the email appears in the thread like any other,
   * with its subject and body, and the reply box underneath.
   *
   * Configuration rather than code because provider ids come from a Marketplace app of
   * type Email — they cannot be created from sub-account settings and cannot be derived
   * from the location. See docs/GHL-SETUP.md, step 8.
   */
  'GHL_CONVERSATION_PROVIDER_ID',
] as const;

export type GhlKey = (typeof GHL_KEYS)[number];

/** `GHL_API_TOKEN` → `ghl_api_token`. One rule, so a new key needs no lookup table. */
export const dbKeyFor = (k: GhlKey): string => k.toLowerCase();

export type ConfigSource = 'database' | 'environment' | 'unset';

export interface Resolved {
  value: string | undefined;
  source: ConfigSource;
}

export type GhlSettings = Record<GhlKey, Resolved>;

/**
 * Cached for a minute.
 *
 * Serverless containers are short-lived, so this mostly saves a query per request within
 * one warm instance rather than per cold start. A minute is the compromise: long enough
 * that a busy signup burst does not query `app_config` on every event, short enough that
 * changing a value in Supabase takes effect while the person who changed it is still
 * looking at the screen. Compare a redeploy, which is what this replaces.
 */
const TTL_MS = 60_000;
let cache: { at: number; rows: Map<string, string> } | null = null;
let warnedUnreadable = false;

/** Drops the cache. Called after a write so the next read sees it immediately. */
export function invalidateGhlSettings(): void {
  cache = null;
}

async function loadFromDatabase(): Promise<Map<string, string>> {
  const fresh = cache && Date.now() - cache.at < TTL_MS;
  if (fresh) return cache!.rows;

  const rows = new Map<string, string>();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const db = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await db
        .from(TABLE)
        .select('key, value')
        .in('key', GHL_KEYS.map(dbKeyFor));

      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const v = String((row as { value: unknown }).value ?? '').trim();
        if (v) rows.set(String((row as { key: unknown }).key), v);
      }
    } catch (err) {
      // Never fatal. A CRM that cannot read its overrides falls back to the environment,
      // which is exactly how it behaved before this file existed. Warned once per cold
      // start rather than per event, so a persistent problem is visible without burying
      // the log.
      if (!warnedUnreadable) {
        console.warn('[ghl-config] app_config unreadable, using environment only:', err);
        warnedUnreadable = true;
      }
    }
  }

  cache = { at: Date.now(), rows };
  return rows;
}

/** Every setting, with where it came from. */
export async function ghlSettings(): Promise<GhlSettings> {
  const rows = await loadFromDatabase();
  const out = {} as GhlSettings;

  for (const k of GHL_KEYS) {
    const fromDb = rows.get(dbKeyFor(k));
    const fromEnv = process.env[k]?.trim() || undefined;
    out[k] = fromDb
      ? { value: fromDb, source: 'database' }
      : fromEnv
        ? { value: fromEnv, source: 'environment' }
        : { value: undefined, source: 'unset' };
  }
  return out;
}

/** One setting's value, or undefined. The common case. */
export async function ghlSetting(key: GhlKey): Promise<string | undefined> {
  return (await ghlSettings())[key].value;
}
