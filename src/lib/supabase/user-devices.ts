import { supabase } from './client';

// =========================================================
// Where this person is signed in.
//
// The Profile screen shows "Signed in on · 2 devices". Supabase does not hand a
// browser the list of a user's sessions, so the browser records its own device
// instead — migration 168.
//
// This is a RECORD, not a session list. Forgetting a device here does not sign it
// out; `auth.signOut({ scope: 'global' })` does that, and the page offers both
// separately rather than letting one look like the other.
//
// What is stored is deliberately thin: a random per-browser key, a readable label,
// and a timestamp. No raw user agent (a fingerprint) and no IP address.
// =========================================================

const KEY = 'gw:device';

/** A per-browser id. Clearing site data makes this machine look new — honestly so. */
function deviceKey(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const made = crypto.randomUUID();
    localStorage.setItem(KEY, made);
    return made;
  } catch {
    // Private mode, or storage blocked. A per-tab key means the row is not
    // reused, which is better than throwing on the way into the app.
    return crypto.randomUUID();
  }
}

/**
 * A label a person will recognise, from the coarse hints the browser offers.
 *
 * `navigator.userAgent` is not stored — only this. "Chrome on Android" tells
 * somebody which device they are looking at; the full string would be a
 * fingerprint we have no use for.
 */
function describeThisDevice(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'Browser';
  const platform = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iPhone'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return platform ? `${browser} on ${platform}` : browser;
}

export interface UserDevice {
  id: string;
  label: string;
  lastSeenAt: string;
  /** Whether this row is the browser asking. */
  isThisOne: boolean;
}

/**
 * Note that this device is in use. Safe to call on every sign-in.
 *
 * Fire-and-forget by design: a failure here must never stand between somebody
 * and their dashboard, and 168 may not be applied yet.
 */
export async function rememberThisDevice(userId: string): Promise<void> {
  const key = deviceKey();
  await supabase.from('user_devices').upsert({
    user_id: userId,
    device_key: key,
    label: describeThisDevice(),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'user_id,device_key' });
}

/** Every device on this account, most recently used first. */
export async function fetchMyDevices(): Promise<UserDevice[] | null> {
  const { data, error } = await supabase
    .from('user_devices')
    .select('id, device_key, label, last_seen_at')
    .order('last_seen_at', { ascending: false });
  // Null, not []: a deployment without 168 has not told us there are no devices.
  // The card says nothing rather than claiming a count it cannot support.
  if (error) return null;

  const mine = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  return (data ?? []).map(r => ({
    id: String(r.id),
    label: String(r.label),
    lastSeenAt: String(r.last_seen_at),
    isThisOne: String(r.device_key) === mine,
  }));
}

/** Forget a device. Does not end its session — the caller must not imply it does. */
export async function forgetDevice(id: string): Promise<void> {
  const { error } = await supabase.from('user_devices').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
