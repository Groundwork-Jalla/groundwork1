import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The welcome sequence starts from the `user_signup` event, and the browser is what
// raises it (api/events?action=crm-user) once a session exists. These tests pin the
// 16 November failure: a second account on the same browser never raised it.
const h = vi.hoisted(() => ({ session: null as any, fetch: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: h.session } }) } } }));
import { recordCrmContact, crmSyncedKey } from './record-crm-contact';
import { recordSignupCountry, geoStampedKey } from './record-signup-country';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, keys: () => [...m.keys()] };
}
let storage: ReturnType<typeof memoryStorage>;
const signedIn = (id: string) => { h.session = { access_token: `tok-${id}`, user: { id } }; };

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('fetch', h.fetch);
  h.fetch.mockReset();
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  h.session = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('the signup event is raised once per account, not once per browser', () => {
  it('announces a brand-new account even when another account already synced on this browser', async () => {
    signedIn('admin-favour');
    await recordCrmContact();
    expect(h.fetch).toHaveBeenCalledTimes(1);

    // Same browser, now signed in as the test client created on the call.
    signedIn('test-client');
    await recordCrmContact();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.fetch.mock.calls[1][0]).toBe('/api/events?action=crm-user');
    expect(h.fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok-test-client' } });
  });

  it('still fires only once per account once the server has accepted it', async () => {
    signedIn('test-client');
    await recordCrmContact();
    await recordCrmContact();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(storage.getItem(crmSyncedKey('test-client'))).toBe('1');
  });

  it('ignores the old browser-wide flag, which an earlier account may have left behind', async () => {
    storage.setItem('gw:crmSynced', '1');
    signedIn('test-client');
    await recordCrmContact();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not remember a miss, so an outage is retried on the next session', async () => {
    h.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: false, reason: 'unreachable' }) });
    signedIn('test-client');
    await recordCrmContact();
    expect(storage.getItem(crmSyncedKey('test-client'))).toBeNull();
    await recordCrmContact();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache sync when welcome email delivery reported an error', async () => {
    h.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, welcomeError: 'resend_503' }) });
    signedIn('test-client');
    await recordCrmContact();
    expect(storage.getItem(crmSyncedKey('test-client'))).toBeNull();
  });

  it('does nothing without a session', async () => {
    await recordCrmContact();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('the signup country stamp follows the same per-account rule', () => {
  it('stamps a second account on the same browser', async () => {
    signedIn('first');
    await recordSignupCountry();
    signedIn('second');
    await recordSignupCountry();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(storage.getItem(geoStampedKey('first'))).toBe('1');
    expect(storage.getItem(geoStampedKey('second'))).toBe('1');
  });
});
