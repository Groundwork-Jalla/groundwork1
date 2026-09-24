import { supabase } from './client';

/**
 * Product settings, through the server.
 *
 * `app_config` is unreadable from the browser by design (058: RLS on, no policies,
 * REVOKE ALL) because the same table holds the Resend key and the dispatch secret. So
 * there is no query here — only a call to `api/events?action=admin-settings`, which
 * checks `is_admin()` server-side and answers with an allowlisted subset.
 *
 * The browser never sends a config key. It sends a setting `id` from the server's own
 * list, so no request can name `resend_api_key` however it is spelled.
 */

export type SettingId = 'notifyEmail' | 'unansweredHours' | 'unansweredBands';

export interface Setting {
  id: SettingId;
  type: 'email' | 'hours' | 'bands';
  editable: boolean;
  /** `null` when no row exists — "not set", which is not the same as the reader's default. */
  value: string | null;
  updatedAt: string | null;
}

async function call(body: Record<string, unknown>): Promise<Setting[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not signed in');

  const r = await fetch('/api/events?action=admin-settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json?.ok !== true) throw new Error(String(json?.error ?? `http_${r.status}`));
  return (json.settings ?? []) as Setting[];
}

export const loadSettings = (): Promise<Setting[]> => call({});

/**
 * Write one setting and return what the database now holds.
 *
 * The response is a fresh read, so the page never shows a value it merely sent. A
 * rejected value throws with the server's reason code — `not_an_email`, `out_of_range`,
 * `bands_not_ascending` — and nothing is stored.
 */
export const saveSetting = (id: SettingId, value: string): Promise<Setting[]> => call({ id, value });
