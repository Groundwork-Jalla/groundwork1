/**
 * SwyChr settings — `app_config` first, the environment second.
 *
 * Same resolution order and the same reason as `../ghl/_config.ts`: a value changed in
 * the database takes effect without a deploy, and a value that only exists in Vercel
 * still works. `app_config` is unreadable from any browser (058: RLS on, no policies), so
 * credentials live there and nowhere a client session can reach.
 *
 * ── Two APIs, one vendor ─────────────────────────────────────────────────────────────
 * SwyChr's payin (collect from a client) and payout (pay a contractor) are separate
 * services under one host, each with its own `/admin/auth`. Both are represented here
 * because Groundwork needs both legs to watch money move.
 */

export const SWYCHR_KEYS = [
  /** Base host. `https://api.accountpe.com` in production. */
  'SWYCHR_BASE_URL',
  /**
   * The account the JWT is minted for. `POST /admin/auth` takes email + password and
   * returns a bearer token; there is no client-credentials flow in the published contract.
   */
  'SWYCHR_EMAIL',
  'SWYCHR_PASSWORD',
  /**
   * The long-lived key the Direct payin API accepts instead of a JWT
   * (`Api-Key: <key>`). Preferred for server-to-server: no login round trip and no token
   * to refresh. Payout publishes no equivalent, so it uses the JWT.
   */
  'SWYCHR_API_KEY',
  /**
   * Shared secret for `X-Webhook-Signature` on the payin callback. Until it is set the
   * webhook cannot be verified, and an unverified financial webhook is refused rather
   * than trusted.
   */
  'SWYCHR_WEBHOOK_SECRET',
  /**
   * Where SwyChr should call back. Sent as `callback_url` when a payment is created, so
   * it has to be the deployed origin rather than anything derived at request time.
   */
  'SWYCHR_CALLBACK_URL',
] as const;

export type SwychrKey = (typeof SWYCHR_KEYS)[number];

/** `SWYCHR_API_KEY` → `swychr_api_key`. One rule, so a new key needs no lookup table. */
export const dbKeyFor = (k: SwychrKey): string => k.toLowerCase();

export type ConfigSource = 'database' | 'environment' | 'unset';
export interface Resolved { value: string | undefined; source: ConfigSource }
export type SwychrSettings = Record<SwychrKey, Resolved>;

const TTL_MS = 60_000;
let cache: { at: number; settings: SwychrSettings } | null = null;

export function invalidateSwychrSettings(): void { cache = null; }

async function loadFromDatabase(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return out;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const wanted = SWYCHR_KEYS.map(dbKeyFor);
    const { data, error } = await db.from('app_config').select('key, value').in('key', wanted);
    if (error) throw error;
    for (const row of (data ?? []) as { key: string; value: string }[]) {
      if (row.value?.trim()) out.set(row.key, row.value.trim());
    }
  } catch (err) {
    // Unreadable config is not a reason to stop: the environment may carry everything.
    console.warn('[swychr-config] app_config unreadable, using environment only:', err);
  }
  return out;
}

export async function swychrSettings(): Promise<SwychrSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.settings;
  const fromDb = await loadFromDatabase();
  const settings = Object.fromEntries(SWYCHR_KEYS.map(k => {
    const db = fromDb.get(dbKeyFor(k));
    const env = process.env[k]?.trim() || undefined;
    const value = db ?? env;
    return [k, { value, source: db ? 'database' : env ? 'environment' : 'unset' }];
  })) as SwychrSettings;
  cache = { at: Date.now(), settings };
  return settings;
}

export interface SwychrConfig {
  baseUrl: string;
  email?: string;
  password?: string;
  apiKey?: string;
  callbackUrl?: string;
}

/**
 * The configuration, or `null` when nothing usable is set.
 *
 * Usable means a base URL plus at least one way to authenticate — the API key, or the
 * email/password pair the JWT is minted from. Half a credential is not configuration, and
 * returning it would turn a setup mistake into a 401 at the worst possible moment.
 */
export async function swychrConfig(): Promise<SwychrConfig | null> {
  const s = await swychrSettings();
  const baseUrl = (s.SWYCHR_BASE_URL.value ?? 'https://api.accountpe.com').replace(/\/+$/, '');
  const apiKey = s.SWYCHR_API_KEY.value;
  const email = s.SWYCHR_EMAIL.value;
  const password = s.SWYCHR_PASSWORD.value;
  if (!apiKey && !(email && password)) return null;
  return { baseUrl, email, password, apiKey, callbackUrl: s.SWYCHR_CALLBACK_URL.value };
}
