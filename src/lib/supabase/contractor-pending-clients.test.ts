import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('./client', () => ({ supabase: { auth: { getSession: mock.getSession } } }));

import { fetchPendingClients, InviteClientFailed } from './contractor-clients';

const CLIENT = {
  clientId: 'client-1',
  fullName: 'Ada Client',
  email: 'ada@example.com',
  invitedAt: '2026-10-20T01:00:00Z',
};

beforeEach(() => {
  mock.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'contractor-token' } } });
  mock.fetch.mockReset();
  vi.stubGlobal('fetch', mock.fetch);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchPendingClients', () => {
  it('requires the contractor session before requesting client identities', async () => {
    mock.getSession.mockResolvedValue({ data: { session: null } });
    await expect(fetchPendingClients()).rejects.toMatchObject({ code: 'not_signed_in' });
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('uses an uncached authenticated GET and returns only resumable client fields', async () => {
    mock.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ clients: [{ ...CLIENT, access_token: 'never-return-this' }] }),
    });
    await expect(fetchPendingClients()).resolves.toEqual([CLIENT]);
    expect(mock.fetch).toHaveBeenCalledWith('/api/events?action=contractor-invite-client', {
      method: 'GET',
      headers: { Authorization: 'Bearer contractor-token' },
      cache: 'no-store',
    });
  });

  it('returns an empty list only when the server reports one successfully', async () => {
    mock.fetch.mockResolvedValue({ ok: true, json: async () => ({ clients: [] }) });
    await expect(fetchPendingClients()).resolves.toEqual([]);
  });

  it('preserves server errors so a failed read is distinguishable from no clients', async () => {
    mock.fetch.mockResolvedValue({
      ok: false, status: 500,
      json: async () => ({ error: 'pending_clients_failed' }),
    });
    await expect(fetchPendingClients()).rejects.toBeInstanceOf(InviteClientFailed);
    await expect(fetchPendingClients()).rejects.toMatchObject({ code: 'pending_clients_failed' });
  });

  it('reports an HTTP failure when the server response is not JSON', async () => {
    mock.fetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('Invalid JSON'); } });
    await expect(fetchPendingClients()).rejects.toMatchObject({ code: 'http_502' });
  });

  it.each([{}, { clients: null }, { clients: [null] }, { clients: [{ ...CLIENT, clientId: '' }] }, { clients: [{ ...CLIENT, email: null }] }])(
    'rejects malformed success payloads instead of treating them as no clients', async payload => {
      mock.fetch.mockResolvedValue({ ok: true, json: async () => payload });
      await expect(fetchPendingClients()).rejects.toMatchObject({ code: 'pending_clients_failed' });
    },
  );
});
