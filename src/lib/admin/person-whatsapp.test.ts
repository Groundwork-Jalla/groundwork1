import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `person-whatsapp` (18 Nov): New chat → Users / Contractors. Admins only, a real person,
 * and the same one-thread-per-person rule the project path uses.
 */
const h = vi.hoisted(() => ({ isAdmin: true as unknown, profile: { id: 'x' } as unknown, thread: vi.fn(), clients: [] as string[] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    h.clients.push(key);
    const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: h.profile, error: null }) };
    return { rpc: async () => ({ data: h.isAdmin, error: null }), from: () => chain };
  },
}));
vi.mock('../../../api/_lib/whatsapp-thread.js', () => ({ resolveOrEstablishWhatsApp: h.thread }));
import { handler } from '../../../api/_handlers/person-whatsapp';

const PERSON = '6f1c2a8e-4b1d-4c55-9f2a-0d8e7b6a5c41';
function call(body: unknown, headers: Record<string, string> = { authorization: 'Bearer token' }, method = 'POST') {
  const res: any = { code: 0, body: null, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  return handler({ method, body, headers }, res).then(() => res);
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; process.env.VITE_SUPABASE_ANON_KEY = 'anon';
  h.isAdmin = true; h.profile = { id: PERSON }; h.clients = [];
  h.thread.mockReset().mockResolvedValue({ ok: true, conversationId: 'conv', created: true, contactId: null, ghlConversationId: null });
});

describe('message any person on WhatsApp, no project needed', () => {
  it('opens or finds the person\'s one thread', async () => {
    const res = await call({ personId: PERSON });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ ok: true, conversationId: 'conv', created: true });
    expect(h.thread).toHaveBeenCalledWith(expect.anything(), PERSON);
  });

  it('proves the caller is an admin with their own token before the service key is used', async () => {
    h.isAdmin = false;
    const res = await call({ personId: PERSON });
    expect(res.code).toBe(403);
    expect(h.clients).toEqual(['anon']);
    expect(h.thread).not.toHaveBeenCalled();
  });

  it('refuses without sign-in, without a valid person, for an unknown person, and for GET', async () => {
    expect((await call({ personId: PERSON }, {})).code).toBe(401);
    expect((await call({ personId: 'not-a-uuid' })).code).toBe(400);
    h.profile = null;
    expect((await call({ personId: PERSON })).code).toBe(404);
    expect((await call({ personId: PERSON }, undefined, 'GET')).code).toBe(405);
    expect(h.thread).not.toHaveBeenCalled();
  });

  it('passes a provider refusal through as its reason, creating nothing', async () => {
    h.thread.mockResolvedValue({ ok: false, reason: 'no_phone' });
    const res = await call({ personId: PERSON });
    expect(res.body).toEqual({ ok: false, reason: 'no_phone' });
  });
});
