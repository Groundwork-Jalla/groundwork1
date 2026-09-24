/**
 * Read and write the handful of `app_config` rows that are product settings.
 *
 * ── Why this is a server handler and not a query ─────────────────────────────────────
 * `app_config` has RLS on and NO POLICIES (058), plus `REVOKE ALL ... FROM authenticated`.
 * That is deliberate: the same table holds `resend_api_key` and `agent_dispatch_secret`,
 * and a policy permissive enough for an admin to read the thresholds would be permissive
 * enough for a compromised admin session to read the secrets. So the table stays shut and
 * this endpoint is the only door — service role, behind a server-side `is_admin()` check.
 *
 * ── The allowlist is the whole security model ────────────────────────────────────────
 * `SETTINGS` below is an exhaustive list of keys that may leave the server, and
 * separately of keys that may be written. The browser never names a column, a table or a
 * raw config key: it sends an id from this file's own list, and anything else is a 400
 * before a database client is even created. Adding a key here is a deliberate act with a
 * code review attached — which is the point.
 *
 * Nothing in this file reads a key that is not in the list, so a secret cannot be
 * returned by a bug in the value-shaping code: it never enters the query.
 */

export type SettingType = 'email' | 'hours' | 'bands';

interface SettingDef {
  /** The `app_config.key`. Never accepted from the browser — only looked up from here. */
  key: string;
  type: SettingType;
  editable: boolean;
}

/**
 * Every product setting, and only those.
 *
 * Deliberately absent, with the reason:
 *   resend_api_key, agent_dispatch_secret   — credentials. Never leave the server.
 *   agent_dispatch_url                      — an endpoint that is only safe because the
 *                                             secret beside it is; it is internal
 *                                             plumbing, not a product setting.
 *   ghl_*                                   — provider configuration. System → Integrations
 *                                             owns those, and duplicating them here would
 *                                             create two places that disagree.
 */
const SETTINGS: Record<string, SettingDef> = {
  notifyEmail:      { key: 'notify_email',                   type: 'email', editable: true },
  unansweredHours:  { key: 'unanswered_conversation_hours',  type: 'hours', editable: true },
  unansweredBands:  { key: 'unanswered_bands',               type: 'bands', editable: true },
};

const BAND_NAMES = ['medium', 'high', 'critical'] as const;

/** Reject before the database, not after. Returns the value to persist, or an error code. */
export function validate(type: SettingType, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'not_a_string' };
  const v = raw.trim();

  if (type === 'email') {
    // Deliberately loose — one @, no spaces, a dot in the domain. A stricter pattern
    // rejects real addresses, and this value only ever becomes a Resend recipient.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, error: 'not_an_email' };
    if (v.length > 254) return { ok: false, error: 'too_long' };
    return { ok: true, value: v };
  }

  if (type === 'hours') {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'not_an_integer' };
    // 1 hour is the tightest useful alert; a week is well past "nobody answered".
    if (n < 1 || n > 168) return { ok: false, error: 'out_of_range' };
    return { ok: true, value: String(n) };
  }

  // The bands are read as jsonb by unanswered_conversations() and cast with ->>'x'::int,
  // so a malformed value would break the Action Center rather than this page. Every name
  // must be present, every value an integer, and they must ascend — a critical band
  // below the high one would silently classify everything as critical.
  let parsed: unknown;
  try { parsed = JSON.parse(v); } catch { return { ok: false, error: 'not_json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'not_an_object' };
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length !== BAND_NAMES.length) return { ok: false, error: 'unexpected_keys' };
  const nums: number[] = [];
  for (const name of BAND_NAMES) {
    const n = obj[name];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 168) return { ok: false, error: `bad_band:${name}` };
    nums.push(n);
  }
  if (!(nums[0] < nums[1] && nums[1] < nums[2])) return { ok: false, error: 'bands_not_ascending' };
  return { ok: true, value: JSON.stringify(Object.fromEntries(BAND_NAMES.map((n, i) => [n, nums[i]]))) };
}

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? serviceKey;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Write, if one was asked for ────────────────────────────────────────────────────
  // `id` is an index into SETTINGS. A raw `key` is never honoured, so no request can
  // name `resend_api_key` however it is spelled.
  const id = typeof req.body?.id === 'string' ? req.body.id : null;
  if (id !== null) {
    const def = Object.prototype.hasOwnProperty.call(SETTINGS, id) ? SETTINGS[id] : undefined;
    if (!def)          { res.status(400).json({ error: 'unknown_setting' }); return; }
    if (!def.editable) { res.status(400).json({ error: 'not_editable' }); return; }

    const checked = validate(def.type, req.body?.value);
    if (!checked.ok) { res.status(400).json({ error: checked.error }); return; }

    const { error } = await admin.from('app_config')
      .upsert({ key: def.key, value: checked.value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) {
      console.error('[admin-settings] write failed:', error.message);
      res.status(500).json({ error: 'write_failed' });
      return;
    }
  }

  // ── Read back, always ──────────────────────────────────────────────────────────────
  // Including after a write: the response is what the database now holds, not what the
  // browser sent. A trigger or a concurrent change shows up here rather than being
  // papered over by optimistic state.
  const keys = Object.values(SETTINGS).map(s => s.key);
  const { data, error } = await admin.from('app_config').select('key, value, updated_at').in('key', keys);
  if (error) {
    console.error('[admin-settings] read failed:', error.message);
    res.status(500).json({ error: 'read_failed' });
    return;
  }

  const byKey = new Map((data ?? []).map((r: any) => [r.key, r]));
  const settings = Object.entries(SETTINGS).map(([settingId, def]) => {
    const row = byKey.get(def.key);
    return {
      id: settingId,
      type: def.type,
      editable: def.editable,
      // `null` means the row does not exist. The page must render that as "not set",
      // never as the default the reader would fall back to — the two are different facts
      // and only one of them means somebody chose it.
      value: row ? String(row.value) : null,
      updatedAt: row?.updated_at ?? null,
    };
  });

  res.status(200).json({ ok: true, settings });
}
